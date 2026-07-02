// Simulation: advances a sim-time clock through the commit list and mutates
// the tree, users and beams. Two clocks by design — simTime (unix seconds)
// drives history, wallTime (seconds) drives every animation, so visuals look
// identical at any playback speed.

import { Tree, FILE_RING_BASE, FILE_RING_STEP } from './tree.js';
import { Layout } from './layout.js';
import { UserEntity, Beam, updateUsers, expireBeams, USER_IDLE_S } from './users.js';
import { extColor } from './colors.js';

export const FILE_FLASH_S = 1.0;
export const FILE_DEATH_S = 2.5;
export const ACTIVE_WINDOW_S = 8.0;
const MAX_COMMITS_PER_FRAME = 50;
const TARGET_PLAYBACK_S = 120;

export class Sim {
  constructor(commits) {
    this.commits = commits;
    this.minTime = commits.length ? commits[0].time : 0;
    this.maxTime = commits.length ? commits[commits.length - 1].time : 0;
    const span = this.maxTime - this.minTime;
    this.baseRate = span > 0 ? span / TARGET_PLAYBACK_S : 1;
    this.speed = 1;
    this.simTime = this.minTime;
    this.cursor = 0;
    this.playing = true;
    this.ended = false;
    this.tree = new Tree();
    this.layout = new Layout(this.tree);
    this.users = new Map();
    this.beams = [];
    this.excluded = new Set(); // author keys whose commits are skipped
  }

  commitKey(commit) {
    return (commit.authorEmail || commit.authorName).toLowerCase();
  }

  rate() {
    return this.baseRate * this.speed;
  }

  progress() {
    const span = this.maxTime - this.minTime;
    return span > 0 ? (this.simTime - this.minTime) / span : 1;
  }

  togglePlay() {
    if (this.ended && !this.playing) {
      // Play pressed at the end: restart from the beginning.
      this.seek(this.minTime, performance.now() / 1000);
      this.ended = false;
    }
    this.playing = !this.playing;
    return this.playing;
  }

  setSpeed(multiplier) {
    this.speed = multiplier;
  }

  fileWorldPos(file) {
    const r = FILE_RING_BASE + file.slotRing * FILE_RING_STEP;
    file.x = file.dir.x + Math.cos(file.slotAngle) * r;
    file.y = file.dir.y + Math.sin(file.slotAngle) * r;
    return file;
  }

  getUser(commit) {
    const key = this.commitKey(commit);
    let u = this.users.get(key);
    if (!u) {
      u = new UserEntity(key, commit.authorName, commit.authorEmail);
      this.users.set(key, u);
    }
    return u;
  }

  /** Returns false when the commit was skipped (excluded author). */
  applyCommit(commit, wallNow, silent = false) {
    if (this.excluded.has(this.commitKey(commit))) return false;
    const user = this.getUser(commit);
    user.lastCommitSimTime = commit.time;

    let cx = 0, cy = 0, n = 0;
    for (const change of commit.changes) {
      const file = this.tree.applyChange(change.action, change.path, wallNow, silent);
      if (!file) continue;
      this.layout.wake(file.dir, wallNow);
      this.fileWorldPos(file);
      cx += file.x;
      cy += file.y;
      n++;
      if (!silent) {
        this.beams.push(new Beam(user, file, extColor(file.ext), wallNow));
      }
    }
    if (n > 0) {
      user.setTarget(cx / n, cy / n);
    } else if (!user.hasPosition) {
      user.setTarget(this.tree.root.x, this.tree.root.y);
    }
    if (!silent) {
      user.lastCommitWall = wallNow;
    }
    return true;
  }

  update(wallDt, wallNow) {
    if (this.playing && !this.ended) {
      this.simTime += this.rate() * wallDt;
      let applied = 0;
      while (
        this.cursor < this.commits.length &&
        this.commits[this.cursor].time <= this.simTime
      ) {
        const commit = this.commits[this.cursor++];
        if (!this.applyCommit(commit, wallNow)) continue; // excluded author
        if (++applied >= MAX_COMMITS_PER_FRAME) {
          // Dense burst: hold the clock back so playback stretches instead
          // of stuttering.
          this.simTime = commit.time;
          break;
        }
      }
      if (this.cursor >= this.commits.length && this.simTime >= this.maxTime) {
        this.simTime = this.maxTime;
        this.playing = false;
        this.ended = true;
      }
    }
    this.tree.reap(wallNow, FILE_DEATH_S);
    this.layout.step();
    if (wallNow < this.layout.boostUntil) this.layout.step(); // faster convergence after changes
    updateUsers(this.users, wallNow, wallDt);
    expireBeams(this.beams, wallNow);
  }

  /**
   * Jump to an absolute sim time. Forward: silent fast-forward. Backward:
   * rebuild the tree from scratch and silent-replay (a change is a few Map
   * ops, so even 100k changes replay in well under 100ms).
   */
  seek(targetTime, wallNow, forceRebuild = false) {
    targetTime = Math.max(this.minTime, Math.min(this.maxTime, targetTime));
    if (targetTime < this.simTime || forceRebuild) {
      // Warm-start the rebuilt tree with current dir positions: the layout
      // relax converges far faster and the tree keeps visual continuity.
      const hints = new Map();
      for (const d of this.tree.allDirs) hints.set(d.path, { x: d.x, y: d.y });
      this.tree = new Tree(hints);
      this.layout = new Layout(this.tree);
      this.cursor = 0;
      // Users are recreated by the replay; avatars persist in avatars.js.
      this.users.clear();
    }
    while (
      this.cursor < this.commits.length &&
      this.commits[this.cursor].time <= targetTime
    ) {
      this.applyCommit(this.commits[this.cursor], wallNow, true);
      this.cursor++;
    }
    this.simTime = targetTime;
    this.beams.length = 0;
    this.ended = this.cursor >= this.commits.length && targetTime >= this.maxTime;

    // Users whose last commit falls inside the idle window (in sim terms)
    // reappear at the equivalent point of their fade cycle; everyone else
    // stays hidden until their next commit.
    const rate = this.rate();
    for (const u of this.users.values()) {
      const elapsedSim = targetTime - u.lastCommitSimTime;
      if (u.hasPosition && elapsedSim >= 0 && elapsedSim <= rate * USER_IDLE_S) {
        u.alpha = 1;
        u.lastCommitWall = wallNow - elapsedSim / rate;
        u.x = u.targetX;
        u.y = u.targetY;
        u.vx = u.vy = 0;
      } else {
        u.alpha = 0;
        u.lastCommitWall = -Infinity;
      }
    }
    this.layout.relaxAll(150);
  }

  /**
   * Replace the excluded-author set and rebuild the tree at the current
   * position, as if the excluded commits never existed.
   */
  setExcluded(keys, wallNow) {
    this.excluded = new Set(keys);
    this.seek(this.simTime, wallNow, true);
  }

  /** World AABB of recently-active nodes + visible users (for the auto camera). */
  activeBounds(wallNow) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let any = false;
    for (const dir of this.tree.allDirs) {
      if (wallNow - dir.touchWall > ACTIVE_WINDOW_S) continue;
      any = true;
      minX = Math.min(minX, dir.x - dir.radius);
      maxX = Math.max(maxX, dir.x + dir.radius);
      minY = Math.min(minY, dir.y - dir.radius);
      maxY = Math.max(maxY, dir.y + dir.radius);
    }
    for (const u of this.users.values()) {
      if (u.alpha < 0.05) continue;
      any = true;
      minX = Math.min(minX, u.x - 60);
      maxX = Math.max(maxX, u.x + 60);
      minY = Math.min(minY, u.y - 60);
      maxY = Math.max(maxY, u.y + 60);
    }
    if (!any) {
      const root = this.tree.root;
      const r = Math.max(100, root.subtreeRadius);
      return { minX: root.x - r, maxX: root.x + r, minY: root.y - r, maxY: root.y + r };
    }
    return { minX, minY, maxX, maxY };
  }
}
