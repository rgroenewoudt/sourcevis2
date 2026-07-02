# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SourceVis: an HTML5 alternative to Gource — animated radial-tree visualization of git history. Plain ES modules + Canvas 2D, zero dependencies, no build step, no tests, no linter.

## Running

Serve the directory statically (ES modules don't load over `file://`):

```
python -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000 and load a log exported with:

```
git log --pretty=format:"%at|%an|%ae" --name-status --reverse > gitlog.txt
```

Gource's own custom log format is auto-detected too. This repo's own history works as a small test input. Verification is manual — load a log in the browser and watch (Playwright screenshots have been used for this; `.playwright-cli/` is gitignored).

## Architecture

`js/main.js` is the composition root: it owns the rAF loop and wires `parser → Sim → Camera/Renderer/UI`. `Sim` (js/sim.js) owns all mutable state: the `Tree`, `Layout`, user entities, and beams. The renderer only reads. Per-file responsibilities are listed in README.md's Architecture table.

### The two-clock convention (load-bearing)

Everything runs on two separate clocks:

- **sim time** — unix seconds from commit timestamps; advances at `baseRate × speed` (full history targets 120 s at 1×). Drives which commits have been applied.
- **wall time** — `performance.now()/1000`; drives every animation (file flashes, death fades, beams, user fade, camera easing, layout boost).

This is why visuals look identical at any playback speed. Animated state stores *wall* timestamps (`file.lastActionWall`, `dir.touchWall`, `user.lastCommitWall`) while history logic uses *sim* time (`commit.time`, `user.lastCommitSimTime`). Don't mix them; when converting between them (see the user-fade restore in `Sim.seek`), divide/multiply by `sim.rate()`.

### Seeking = deterministic rebuild

Backward seeks (and author-filter changes, via `setExcluded`'s forced rebuild) throw the tree away and silently replay commits from index 0. The `silent` flag threads through `applyCommit → tree.applyChange`: silent deletes remove immediately, no flash timestamps, no beams. Two things make the rebuild look continuous and stay fast:

- position hints — old directory positions are passed into `new Tree(hints)` so the rebuilt tree starts near-solved, then `layout.relaxAll(150)` settles it synchronously;
- everything is deterministic — directory seed angles use hash-based `spinPhase`, file slots are computed by insertion order. **No `Math.random()` anywhere**; adding randomness would break seek reproducibility.

Forward seeks are the same silent replay without the rebuild.

### Layout physics

Only directories participate in physics (js/layout.js); files sit on deterministic orbital rings around their directory, computed in `tree.js`'s `reflowFiles` and turned into world coordinates by `Sim.fileWorldPos`. Key mechanics:

- Separation runs in two passes: pairwise among siblings (using `subtreeRadius`) and a spatial-hash global pass (using own `radius`) — this keeps cost near-linear; ~4000+ directories is the known pain threshold (main.js warns).
- Directories **settle** (freeze) after 30 slow steps; `layout.wake(dir)` un-settles a dir, its ancestors, and their siblings after any structural change, and sets `boostUntil` (sim runs a second `step()` per frame while boosted). If you mutate tree structure or positions, you must wake the affected dirs or the layout won't respond.
- `tree.version` is bumped on dir add/remove; `Layout.syncDirs()` rebuilds its flat array only when the version changes.

### Tree model quirks

- A and M converge: M on an unknown path acts as A (partial-history tolerance), A on an existing path acts as M, A on a dying file revives it. D on an unknown path is a no-op.
- Deleted files enter a `dying` state for a fade animation and are reaped later (`Tree.reap`); counters (`fileCount`, `extCounts`) are decremented at D time, not reap time.
- Empty directories are pruned upward immediately on file removal.

### Authors

Author identity key is `(email || name).toLowerCase()` — used consistently in `Sim.commitKey`, the UI author list, and avatar caching. Avatars (Gravatar SHA-256, initials-disc fallback) are cached in `avatars.js` and survive the user-map reset that happens on rebuild.
