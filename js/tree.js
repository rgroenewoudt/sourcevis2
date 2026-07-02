// Mutable directory-tree model driven by parsed git changes.
// Owns node lifecycle (create on A, dying/reap on D, dir auto-create/prune)
// and live counters for the HUD/legend. Layout physics lives in layout.js;
// this module only seeds initial positions for new directories.

import { hashString } from './colors.js';

export const FILE_RING_BASE = 14;
export const FILE_RING_STEP = 11;

export class FileNode {
  constructor(name, dir) {
    this.name = name;
    this.dir = dir;
    const dot = name.lastIndexOf('.');
    this.ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
    this.slotRing = 0;
    this.slotAngle = 0;
    this.x = 0; // world position, cached each frame by the renderer
    this.y = 0;
    this.state = 'alive'; // 'alive' | 'dying'
    this.lastAction = 'A';
    this.lastActionWall = -Infinity;
  }
}

export class DirNode {
  constructor(name, parent) {
    this.name = name;
    this.parent = parent;
    this.dirs = new Map();
    this.files = new Map();
    this.depth = parent ? parent.depth + 1 : 0;
    this.path = parent ? (parent.path ? parent.path + '/' + name : name) : '';
    this.spinPhase = (hashString(this.path) % 628) / 100; // 0..2π, stable per path
    this.radius = 10;         // radius of this dir's own file rings
    this.subtreeRadius = 10;  // radius including all descendants (updated by layout)
    this.touchWall = -Infinity;
    this.settled = false;
    this.settleCount = 0;
    this.vx = 0;
    this.vy = 0;
    if (parent) {
      // Seed outward: continue the grandparent->parent direction with a
      // stable hash-based fan-out, so a freshly rebuilt tree starts roughly
      // tree-shaped instead of bunched at the origin (which would degenerate
      // the layout's spatial hash into O(n²)).
      let a;
      if (parent.parent) {
        const base = Math.atan2(parent.y - parent.parent.y, parent.x - parent.parent.x);
        a = base + (this.spinPhase / (Math.PI * 2) - 0.5) * Math.PI * 0.8;
      } else {
        a = this.spinPhase; // children of root: spread over the full circle
      }
      const d = parent.radius + 40;
      this.x = parent.x + Math.cos(a) * d;
      this.y = parent.y + Math.sin(a) * d;
    } else {
      this.x = 0;
      this.y = 0;
    }
  }
}

function reflowFiles(dir) {
  let ring = 0, slot = 0, cap = 8;
  for (const file of dir.files.values()) {
    file.slotRing = ring;
    file.slotAngle = (slot / cap) * Math.PI * 2 + dir.spinPhase;
    if (++slot >= cap) {
      ring++;
      slot = 0;
      cap = 8 * (ring + 1);
    }
  }
  const rings = ring + (slot > 0 ? 1 : 0);
  dir.radius = rings > 0 ? FILE_RING_BASE + (rings - 1) * FILE_RING_STEP + 6 : 10;
}

export class Tree {
  /**
   * @param {Map<string, {x: number, y: number}>} [posHints] previous dir
   * positions (path -> pos) so a rebuilt tree starts near-solved and keeps
   * visual continuity across seeks/filter changes.
   */
  constructor(posHints = null) {
    this.posHints = posHints;
    this.root = new DirNode('', null);
    this.allDirs = new Set([this.root]);
    this.pathMap = new Map(); // full path -> FileNode
    this.dying = new Set();
    this.fileCount = 0;
    this.extCounts = new Map();
    this.version = 0; // bumped on dir add/remove so layout can rebuild its array
  }

  getOrCreateDir(parts) {
    let dir = this.root;
    for (const part of parts) {
      let child = dir.dirs.get(part);
      if (!child) {
        child = new DirNode(part, dir);
        const hint = this.posHints?.get(child.path);
        if (hint) {
          child.x = hint.x;
          child.y = hint.y;
        }
        dir.dirs.set(part, child);
        this.allDirs.add(child);
        this.version++;
      }
      dir = child;
    }
    return dir;
  }

  bumpExt(ext, delta) {
    const n = (this.extCounts.get(ext) || 0) + delta;
    if (n <= 0) this.extCounts.delete(ext);
    else this.extCounts.set(ext, n);
  }

  /**
   * Apply one change. Returns the affected FileNode (or null if a delete
   * targeted an unknown path). With silent=true, deletes remove immediately
   * and no flash timestamps are set (used for seek fast-forward).
   */
  applyChange(action, path, wallNow, silent = false) {
    let file = this.pathMap.get(path);

    if (action === 'D') {
      if (!file) return null;
      if (file.state === 'alive') {
        this.fileCount--;
        this.bumpExt(file.ext, -1);
      }
      if (silent) {
        this.removeFile(file, path);
        return null;
      }
      file.state = 'dying';
      file.lastAction = 'D';
      file.lastActionWall = wallNow;
      this.dying.add(file);
      file.dir.touchWall = wallNow;
      return file;
    }

    // A and M converge: M on an unknown path (partial history) acts as A,
    // A on an existing path acts as M, A on a dying file revives it.
    if (!file) {
      const parts = path.split('/');
      const name = parts.pop();
      const dir = this.getOrCreateDir(parts);
      file = new FileNode(name, dir);
      dir.files.set(name, file);
      this.pathMap.set(path, file);
      reflowFiles(dir);
      this.fileCount++;
      this.bumpExt(file.ext, 1);
    } else if (file.state === 'dying') {
      file.state = 'alive';
      this.dying.delete(file);
      this.fileCount++;
      this.bumpExt(file.ext, 1);
    }
    file.lastAction = action;
    file.lastActionWall = silent ? -Infinity : wallNow;
    if (!silent) file.dir.touchWall = wallNow;
    return file;
  }

  removeFile(file, path) {
    let dir = file.dir;
    dir.files.delete(file.name);
    this.pathMap.delete(path);
    this.dying.delete(file);
    reflowFiles(dir);
    // Prune now-empty directories upward.
    while (dir !== this.root && dir.files.size === 0 && dir.dirs.size === 0) {
      const parent = dir.parent;
      parent.dirs.delete(dir.name);
      this.allDirs.delete(dir);
      this.version++;
      dir = parent;
    }
  }

  /** Remove dying files whose death animation has finished. */
  reap(wallNow, deathSeconds) {
    if (this.dying.size === 0) return;
    for (const file of [...this.dying]) {
      if (wallNow - file.lastActionWall > deathSeconds) {
        // Reconstruct the full path from the node chain.
        const segs = [file.name];
        for (let d = file.dir; d && d.parent; d = d.parent) segs.unshift(d.name);
        this.removeFile(file, segs.join('/'));
      }
    }
  }
}
