// Composition root: wires parser, sim, camera, renderer and UI together and
// owns the requestAnimationFrame loop plus canvas input (zoom/pan/follow).

import { parseLog } from './parser.js';
import { Sim } from './sim.js';
import { Camera } from './camera.js';
import { Renderer } from './renderer.js';
import { extColor } from './colors.js';
import { initUI } from './ui.js';

const LEGEND_MAX = 12;
const HUD_INTERVAL_S = 0.25;
const LEGEND_INTERVAL_S = 2;
const SEEK_DEBOUNCE_MS = 100;

const canvas = document.getElementById('viz');
const camera = new Camera();
const renderer = new Renderer(canvas, camera);

let sim = null;
let seekTimer = null;
let authorsTimer = null;

const ui = initUI({
  onFile: loadFile,
  onPlayPause() {
    if (sim) ui.setPlaying(sim.togglePlay());
  },
  onSpeed(multiplier) {
    if (sim) sim.setSpeed(multiplier);
  },
  onSeek(fraction) {
    if (!sim) return;
    clearTimeout(seekTimer);
    seekTimer = setTimeout(() => {
      const t = sim.minTime + fraction * (sim.maxTime - sim.minTime);
      sim.seek(t);
    }, SEEK_DEBOUNCE_MS);
  },
  onFollow() {
    camera.follow();
    ui.setFollowMode(true);
  },
  onAuthorsChange(excludedKeys) {
    if (!sim) return;
    // Debounced: each change rebuilds the tree at the current position.
    clearTimeout(authorsTimer);
    authorsTimer = setTimeout(() => {
      sim.setExcluded(excludedKeys);
      if (excludedKeys.length > 0) {
        ui.toast(`Skipping commits from ${excludedKeys.length} author${excludedKeys.length > 1 ? 's' : ''}`);
      }
    }, 250);
  },
});

async function loadFile(file) {
  ui.showEmptyState(true);
  ui.setParseProgress(0);
  try {
    const text = await file.text();
    const parsed = await parseLog(text, (f) => ui.setParseProgress(f));
    ui.setParseProgress(null);
    if (parsed.commits.length === 0) {
      ui.toast('No commits found — is this the output of the git log command above?');
      return;
    }
    sim = new Sim(parsed.commits);
    const authorMap = new Map();
    for (const c of parsed.commits) {
      const key = (c.authorEmail || c.authorName).toLowerCase();
      const entry = authorMap.get(key);
      if (entry) entry.count++;
      else authorMap.set(key, { key, name: c.authorName, count: 1 });
    }
    ui.setAuthors([...authorMap.values()].sort((a, b) => b.count - a.count));
    camera.follow();
    ui.showEmptyState(false);
    ui.setPlaying(true);
    ui.setFollowMode(true);
    if (parsed.skippedLines > 0) {
      ui.toast(`Loaded ${parsed.commits.length.toLocaleString()} commits ` +
        `(${parsed.skippedLines.toLocaleString()} unrecognized lines skipped)`);
    } else {
      ui.toast(`Loaded ${parsed.commits.length.toLocaleString()} commits (${parsed.format} format)`);
    }
    if (sim.tree && parsed.commits.length > 0) {
      // Warn on pathological repos (see layout.js PERF note).
      const dirEstimate = new Set(
        parsed.commits.flatMap(c => c.changes.map(ch => ch.path.split('/').slice(0, -1).join('/')))
      ).size;
      if (dirEstimate > 4000) {
        ui.toast(`Large repo (~${dirEstimate} directories) — layout may be slow`, 6000);
      }
    }
  } catch (err) {
    ui.setParseProgress(null);
    ui.toast(`Failed to load file: ${err.message}`);
  }
}

// ---- canvas input: wheel zoom, drag pan, double-click to re-follow ----
canvas.addEventListener('wheel', (e) => {
  if (!sim) return;
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  camera.zoomAt(e.offsetX, e.offsetY, factor);
  ui.setFollowMode(false);
}, { passive: false });

let dragging = false, lastX = 0, lastY = 0, moved = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (!sim) return;
  dragging = true;
  moved = 0;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  moved += Math.abs(dx) + Math.abs(dy);
  if (moved > 3) {
    camera.panBy(dx, dy);
    ui.setFollowMode(false);
  }
  lastX = e.clientX;
  lastY = e.clientY;
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('dblclick', () => {
  camera.follow();
  ui.setFollowMode(true);
});

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && sim && e.target === document.body) {
    e.preventDefault();
    ui.setPlaying(sim.togglePlay());
  }
});

window.addEventListener('resize', () => renderer.resize());

// ---- main loop ----
let prevWall = performance.now() / 1000;
let hudAt = 0;
let legendAt = 0;

function tick() {
  const wallNow = performance.now() / 1000;
  const wallDt = Math.min(0.05, Math.max(0, wallNow - prevWall)); // tab-restore guard
  prevWall = wallNow;

  if (sim) {
    sim.update(wallDt);
    // Animations (and the camera's target bounds) run on the sim's animation
    // clock, which freezes while paused — the frame goes fully static.
    camera.update(wallDt, sim.activeBounds(sim.animNow));
    renderer.draw(sim, sim.animNow);

    if (wallNow - hudAt > HUD_INTERVAL_S) {
      hudAt = wallNow;
      ui.setDate(sim.simTime);
      ui.setCounts(sim.tree.fileCount, sim.users.size);
      ui.setSeek(sim.progress());
      ui.setPlaying(sim.playing);
      ui.setFollowMode(camera.mode === 'auto');
    }
    if (wallNow - legendAt > LEGEND_INTERVAL_S) {
      legendAt = wallNow;
      const ranked = [...sim.tree.extCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, LEGEND_MAX)
        .map(([ext, count]) => ({ ext: ext || '(none)', color: extColor(ext), count }));
      ui.setLegend(ranked);
    }
  }
  requestAnimationFrame(tick);
}

ui.showEmptyState(true);
requestAnimationFrame(tick);
