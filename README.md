# SourceVis

An HTML5 alternative to [Gource](https://github.com/acaudwell/Gource): upload a git log export and watch your repository's history unfold as an animated radial tree. Directories branch out from the root, files are leaf dots colored by extension, and authors fly between the files they touch, firing beams at each change. Author avatars are loaded from Gravatar.

Zero dependencies, no build step — plain ES modules and Canvas 2D.

## Quick start

1. Export your repository's history:

   ```
   git log --pretty=format:"%at|%an|%ae" --name-status --reverse > gitlog.txt
   ```

   To shrink the file, you can exclude commits from specific authors (e.g. bots and build-service accounts) at export time with a negative-lookahead author match:

   ```
   git log --perl-regexp --author='^(?!.*(dependabot|renovate|build-service)).*$' \
     --pretty=format:"%at|%an|%ae" --name-status --reverse > gitlog.txt
   ```

   The pattern matches against `Name <email>`, so any name or email fragment works. (Excluded authors can also be toggled later in the **Authors** panel without re-exporting.)

   To start the history at a given date instead of the first commit, add `--since` (also combinable with the author filter above):

   ```
   git log --since=2024-01-01 --pretty=format:"%at|%an|%ae" --name-status --reverse > gitlog.txt
   ```

   Note that files created before that date will only appear in the visualization once a later commit touches them.

2. Serve this directory with any static file server (ES modules don't load over `file://`):

   ```
   python -m http.server 8000
   # or: npx serve .
   ```

3. Open http://localhost:8000, then choose or drag-drop `gitlog.txt` onto the page.

Gource's own custom log format (`timestamp|user|A/M/D|/path`) is also accepted (auto-detected). It has no email addresses, so avatars fall back to initials discs.

## Controls

- **Play/pause** button or Space bar
- **Speed** 0.25×–8× (the full history targets ~8 minutes at 1×)
- **Timeline** slider seeks anywhere in the history (backward seeks rebuild deterministically)
- **Mouse wheel** zooms, **drag** pans — this switches the camera to manual; click **Follow** (or double-click the canvas) to return to auto-follow
- **Authors** opens a panel listing every author by commit count; unchecking an author skips their commits entirely — the tree is rebuilt at the current position as if those commits never existed (handy for hiding bots and build-service accounts). Authors are identified by email, so the same person may appear once per email address they committed with.
- The legend (top right) shows the top 12 live file extensions

## Notes & limitations

- Avatars use Gravatar's SHA-256 endpoint with `d=404`; authors without a Gravatar get a colored initials disc. Hashing requires a secure context (localhost is fine).
- File counts can exceed `git ls-files` at HEAD: `--name-status` logs don't record deletions that only happen in merge resolutions, and git may skip rename detection on very large commits (it then reports A+D pairs or nothing). Gource has the same limitation.
- Dense commit bursts are capped at 50 commits per frame — playback stretches slightly instead of stuttering, so high speed multipliers on very dense histories are effectively throttled.
- Tested with a 51k-commit / 496k-line log: parsing ~300 ms, backward seek ~0.5 s, layout ~1 ms/frame at 1,600 directories.

## Architecture

| File | Responsibility |
|---|---|
| `js/main.js` | Composition root, rAF loop, canvas input (zoom/pan) |
| `js/parser.js` | Tolerant chunked parsing of both log formats |
| `js/tree.js` | Directory/file model, file lifecycle, live counters |
| `js/layout.js` | Spring/collision physics for directories; files use deterministic orbital slots |
| `js/sim.js` | Simulation clock, commit application, seek (forward fast-forward / backward rebuild) |
| `js/users.js` | Author entities and beams |
| `js/camera.js` | Auto-fit camera with manual override |
| `js/renderer.js` | Canvas 2D pipeline: batched draws, culling, label budget |
| `js/avatars.js` | Gravatar cache with initials fallback |
| `js/colors.js` | Extension/author color palettes |
| `js/ui.js` | Controls, HUD, legend, empty state, drag-drop |

Two clocks drive everything: *sim time* advances the history at the chosen rate, while *wall time* drives all animation (flashes, beams, fades), so visuals look identical at every playback speed.
