// All Canvas 2D drawing. World pass (edges, beams, file dots, dir dots) under
// the camera transform; users and labels in screen space so they stay crisp
// and constant-size. File dots are batched into one fill() per
// color/alpha-band bucket to minimize state changes. All HUD text is DOM.

import { FILE_RING_BASE, FILE_RING_STEP } from './tree.js';
import { extColor } from './colors.js';
import { getAvatar } from './avatars.js';
import { FILE_FLASH_S, FILE_DEATH_S } from './sim.js';
import { BEAM_S } from './users.js';

const BG = '#0b0e14';
const EDGE_STYLE = 'rgba(255,255,255,0.10)';
const DYING_COLOR = '224,64,64';
const DIR_TOUCH_LABEL_S = 4;
const MAX_DIR_LABELS = 120;
const DIR_LABEL_MIN_PX = 3;
const AVATAR_PX = 20;

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.camera = camera;
    this.ctx = canvas.getContext('2d');
    this.dpr = 1;
    this.resize();
  }

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.camera.setViewport(w, h);
  }

  draw(sim, wallNow) {
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = this.dpr;
    const s = cam.scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cam.viewW, cam.viewH);

    // View AABB in world coords, with margin, for culling.
    const halfW = cam.viewW / 2 / s;
    const halfH = cam.viewH / 2 / s;
    const vMinX = cam.x - halfW - 50, vMaxX = cam.x + halfW + 50;
    const vMinY = cam.y - halfH - 50, vMaxY = cam.y + halfH + 50;
    const dirVisible = (d) =>
      d.x + d.radius > vMinX && d.x - d.radius < vMaxX &&
      d.y + d.radius > vMinY && d.y - d.radius < vMaxY;

    // ---- world space ----
    ctx.setTransform(
      s * dpr, 0, 0, s * dpr,
      dpr * (cam.viewW / 2 - cam.x * s),
      dpr * (cam.viewH / 2 - cam.y * s)
    );

    // 1. Directory edges (single batched path).
    ctx.beginPath();
    for (const d of sim.tree.allDirs) {
      if (!d.parent) continue;
      if (!dirVisible(d) && !dirVisible(d.parent)) continue;
      ctx.moveTo(d.parent.x, d.parent.y);
      ctx.lineTo(d.x, d.y);
    }
    ctx.strokeStyle = EDGE_STYLE;
    ctx.lineWidth = 1.2 / s;
    ctx.stroke();

    // 2. Beams (few at a time; drawn per beam, solid color + age alpha).
    ctx.lineWidth = 1.0 / s;
    ctx.lineCap = 'round';
    for (const b of sim.beams) {
      const age = wallNow - b.bornWall;
      const p = age / BEAM_S;
      if (p >= 1) continue;
      const grow = Math.min(1, p / 0.3);
      const ex = b.user.x + (b.file.x - b.user.x) * grow;
      const ey = b.user.y + (b.file.y - b.user.y) * grow;
      ctx.globalAlpha = p < 0.3 ? 1 : 1 - (p - 0.3) / 0.7;
      ctx.strokeStyle = b.color;
      ctx.beginPath();
      ctx.moveTo(b.user.x, b.user.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3. File dots, bucketed by fillStyle. Also updates cached file world
    //    positions (used by beams next frame).
    const dotR = Math.max(3, 1.4 / s);
    const buckets = new Map(); // fillStyle -> [x, y, ...]
    const pushDot = (style, x, y) => {
      let arr = buckets.get(style);
      if (!arr) buckets.set(style, arr = []);
      arr.push(x, y);
    };
    for (const dir of sim.tree.allDirs) {
      if (dir.files.size === 0 || !dirVisible(dir)) continue;
      for (const file of dir.files.values()) {
        const r = FILE_RING_BASE + file.slotRing * FILE_RING_STEP;
        const x = file.x = dir.x + Math.cos(file.slotAngle) * r;
        const y = file.y = dir.y + Math.sin(file.slotAngle) * r;
        const age = wallNow - file.lastActionWall;
        if (file.state === 'dying') {
          const fade = Math.max(0, 1 - age / FILE_DEATH_S);
          pushDot(`rgba(${DYING_COLOR},${(Math.round(fade * 8) / 8).toFixed(3)})`, x, y);
        } else {
          pushDot(file.color || (file.color = extColorOf(file)), x, y);
          if (age < FILE_FLASH_S) {
            const flash = Math.round((1 - age / FILE_FLASH_S) * 8) / 8;
            if (flash > 0) pushDot(`rgba(255,255,255,${flash.toFixed(3)})`, x, y);
          }
        }
      }
    }
    const TAU = Math.PI * 2;
    for (const [style, pts] of buckets) {
      ctx.fillStyle = style;
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        ctx.moveTo(pts[i] + dotR, pts[i + 1]);
        ctx.arc(pts[i], pts[i + 1], dotR, 0, TAU);
      }
      ctx.fill();
    }

    // 4. Directory center dots.
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (const d of sim.tree.allDirs) {
      if (!dirVisible(d)) continue;
      ctx.moveTo(d.x + 2 / s, d.y);
      ctx.arc(d.x, d.y, 2 / s, 0, TAU);
    }
    ctx.fill();

    // ---- screen space ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 5. Directory labels: persistent names above each cluster, sized and
    //    faded by on-screen size, so the tree structure reads even when
    //    playback is paused. Recently touched dirs flash bright (and get a
    //    label even below the size threshold), then fade back; they win the
    //    label cap and collision placement, then largest dirs.
    const dirLabelCandidates = [];
    for (const d of sim.tree.allDirs) {
      if (!d.parent || !dirVisible(d)) continue;
      const touched = wallNow - d.touchWall < DIR_TOUCH_LABEL_S;
      if (d.radius * s < DIR_LABEL_MIN_PX && !touched) continue;
      dirLabelCandidates.push(d);
    }
    dirLabelCandidates.sort((a, b) => {
      const ta = wallNow - a.touchWall < DIR_TOUCH_LABEL_S;
      const tb = wallNow - b.touchWall < DIR_TOUCH_LABEL_S;
      if (ta !== tb) return ta ? -1 : 1;
      if (ta) return b.touchWall - a.touchWall;
      return b.radius - a.radius;
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let bigFont = true;
    ctx.font = '11px system-ui, sans-serif';
    const drawnRects = []; // [x0, y0, x1, y1] of placed labels, larger dirs first
    for (const d of dirLabelCandidates) {
      if (drawnRects.length >= MAX_DIR_LABELS) break;
      const px = d.radius * s;
      const big = px >= 22;
      if (big !== bigFont) {
        ctx.font = big ? '11px system-ui, sans-serif' : '9px system-ui, sans-serif';
        bigFont = big;
      }
      const [sx, sy] = cam.worldToScreen(d.x, d.y);
      const w = ctx.measureText(d.name).width;
      const x0 = sx - w / 2, y1 = sy - px - 3, y0 = y1 - (big ? 12 : 10);
      let clashes = false;
      for (const r of drawnRects) {
        if (x0 < r[2] && x0 + w > r[0] && y0 < r[3] && y1 > r[1]) { clashes = true; break; }
      }
      if (clashes) continue;
      drawnRects.push([x0, y0, x0 + w, y1]);
      const base = px >= DIR_LABEL_MIN_PX ? Math.min(0.5, 0.25 + px / 150) : 0;
      const age = wallNow - d.touchWall;
      const touchAlpha = age < DIR_TOUCH_LABEL_S ? (1 - age / DIR_TOUCH_LABEL_S) * 0.9 : 0;
      const alpha = Math.max(base, touchAlpha);
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.fillText(d.name, sx, y1);
    }

    // 6. Users: avatar + colored ring + name, constant screen size.
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const half = AVATAR_PX / 2;
    for (const u of sim.users.values()) {
      if (u.alpha < 0.02) continue;
      const [sx, sy] = cam.worldToScreen(u.x, u.y);
      if (sx < -60 || sx > cam.viewW + 60 || sy < -60 || sy > cam.viewH + 60) continue;
      const avatar = getAvatar(u.key, u.email, u.initials, u.color);
      ctx.globalAlpha = u.alpha;
      ctx.drawImage(avatar, sx - half, sy - half, AVATAR_PX, AVATAR_PX);
      ctx.beginPath();
      ctx.arc(sx, sy, half + 1, 0, TAU);
      ctx.strokeStyle = u.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(235,240,248,0.9)';
      ctx.fillText(u.name, sx, sy + half + 3);
      ctx.globalAlpha = 1;
    }
  }
}

// Lazy per-file color cache (avoids re-hashing the extension every frame).
function extColorOf(file) {
  return extColor(file.ext);
}
