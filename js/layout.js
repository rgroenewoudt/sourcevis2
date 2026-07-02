// Layout engine. Hybrid approach: files sit on deterministic orbital rings
// around their directory (computed in tree.js, zero physics), and only
// directories participate in a spring/collision embedder.
//
// Separation is split into two passes so cost stays near-linear even on
// repos with thousands of directories:
//  - sibling pass: pairwise within each parent's children, using a fraction
//    of the subtree radii (branches stay clustered, some overlap allowed);
//  - global pass: a uniform spatial hash grid over own file-ring radii,
//    catching unrelated subtrees that drift into each other.

const SPRING_K = 6.0;
const SIBLING_PUSH = 8.0;
const GLOBAL_PUSH = 4.0;
const DIR_PADDING = 12;
const CLUSTER = 0.3; // fraction of subtree extent kept in the spring rest length
const DAMPING = 0.85;
const MAX_SPEED = 600;
const SETTLE_SPEED = 0.6;
const SETTLE_STEPS = 30;
const DT = 1 / 60;

export class Layout {
  constructor(tree) {
    this.tree = tree;
    this.dirs = [];
    this.version = -1;
    this.boostUntil = 0;
  }

  syncDirs() {
    if (this.version !== this.tree.version) {
      this.dirs = [...this.tree.allDirs];
      this.version = this.tree.version;
    }
  }

  /** Wake a dir, its ancestor chain, and its siblings after a structural change. */
  wake(dir, wallNow = 0) {
    for (let d = dir; d; d = d.parent) {
      d.settled = false;
      d.settleCount = 0;
      if (d.parent) {
        for (const sib of d.parent.dirs.values()) {
          sib.settled = false;
          sib.settleCount = 0;
        }
      }
    }
    this.boostUntil = wallNow + 3;
  }

  computeSubtreeRadii(dir) {
    let r = dir.radius;
    for (const child of dir.dirs.values()) {
      const cr = this.computeSubtreeRadii(child);
      const ddx = child.x - dir.x;
      const ddy = child.y - dir.y;
      const d = Math.sqrt(ddx * ddx + ddy * ddy) + cr;
      if (d > r) r = d;
    }
    dir.subtreeRadius = r;
    return r;
  }

  separate(a, b, minDist, push) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= minDist * minDist) return;
    let dist = Math.sqrt(d2);
    if (dist < 1) dist = 1;
    const f = (minDist - dist) * push * DT;
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;
    if (!a.settled) { a.vx -= fx; a.vy -= fy; }
    if (!b.settled) { b.vx += fx; b.vy += fy; }
  }

  step(damping = DAMPING) {
    this.syncDirs();
    const dirs = this.dirs;
    this.computeSubtreeRadii(this.tree.root);

    // Parent springs. Rest length clears the two file rings plus only a
    // fraction of the child's subtree extent — subtrees mostly grow outward,
    // so full bounding-circle clearance would exile deep branches far from
    // their parent (long edges, even spread). The global pass still prevents
    // hard file-ring overlaps.
    for (const d of dirs) {
      if (!d.parent || d.settled) continue;
      const dx = d.x - d.parent.x;
      const dy = d.y - d.parent.y;
      let dist = Math.sqrt((dx) * (dx) + (dy) * (dy));
      if (dist < 1) dist = 1;
      const rest = d.parent.radius + d.radius + DIR_PADDING
        + CLUSTER * (d.subtreeRadius - d.radius);
      const f = SPRING_K * (rest - dist);
      d.vx += (dx / dist) * f * DT;
      d.vy += (dy / dist) * f * DT;
    }

    // Sibling separation: subtrees under the same parent must clear each other.
    for (const d of dirs) {
      if (d.dirs.size < 2) continue;
      const kids = [...d.dirs.values()];
      for (let i = 0; i < kids.length; i++) {
        const a = kids[i];
        for (let j = i + 1; j < kids.length; j++) {
          const b = kids[j];
          if (a.settled && b.settled) continue;
          // Fractional subtree clearance keeps branches clustered; the floor
          // on own radii keeps sibling file rings from visually colliding.
          const minDist = Math.max(
            a.radius + b.radius + 12,
            (a.subtreeRadius + b.subtreeRadius) * 0.55
          );
          this.separate(a, b, minDist, SIBLING_PUSH);
        }
      }
    }

    // Global separation via spatial hash on own file-ring radii. Cell size is
    // derived from the largest radius so a 3×3 neighborhood is guaranteed to
    // contain every potentially-overlapping pair.
    let maxR = 10;
    for (let i = 0; i < dirs.length; i++) {
      dirs[i].gridIdx = i;
      if (dirs[i].radius > maxR) maxR = dirs[i].radius;
    }
    const cell = 2 * maxR + 20;
    const grid = new Map();
    for (const d of dirs) {
      const key = Math.floor(d.x / cell) * 100003 + Math.floor(d.y / cell);
      let arr = grid.get(key);
      if (!arr) grid.set(key, arr = []);
      arr.push(d);
    }
    for (const d of dirs) {
      const cx = Math.floor(d.x / cell);
      const cy = Math.floor(d.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const arr = grid.get(gx * 100003 + gy);
          if (!arr) continue;
          for (const o of arr) {
            // Each unordered pair once; skip related nodes (springs and the
            // sibling pass own those relationships).
            if (o.gridIdx <= d.gridIdx) continue;
            if (d.settled && o.settled) continue;
            if (o.parent === d || d.parent === o || o.parent === d.parent) continue;
            this.separate(d, o, d.radius + o.radius + 15, GLOBAL_PUSH);
          }
        }
      }
    }

    // Integrate (root stays pinned at the origin).
    for (const d of dirs) {
      if (!d.parent || d.settled) continue;
      d.vx *= damping;
      d.vy *= damping;
      const speed = Math.sqrt((d.vx) * (d.vx) + (d.vy) * (d.vy));
      if (speed > MAX_SPEED) {
        d.vx *= MAX_SPEED / speed;
        d.vy *= MAX_SPEED / speed;
      }
      d.x += d.vx * DT;
      d.y += d.vy * DT;
      if (speed < SETTLE_SPEED) {
        if (++d.settleCount >= SETTLE_STEPS) {
          d.settled = true;
          d.vx = d.vy = 0;
        }
      } else {
        d.settleCount = 0;
      }
    }
  }

  /** Synchronous settling pass used after seeks — lands a near-final layout. */
  relaxAll(iterations = 150) {
    this.syncDirs();
    for (const d of this.dirs) {
      d.settled = false;
      d.settleCount = 0;
    }
    for (let i = 0; i < iterations; i++) this.step(0.7);
  }
}
