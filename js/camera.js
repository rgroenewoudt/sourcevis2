// Camera: auto-fit to the active part of the tree, with manual wheel-zoom /
// drag-pan override. Manual mode never times out on its own — the user
// returns to auto via the Follow button or a double-click.

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const FIT_MARGIN = 0.85; // fit bounds into 85% of the viewport
const SMOOTHING = 2.5;

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.mode = 'auto'; // 'auto' | 'manual'
    this.viewW = 1;
    this.viewH = 1;
  }

  setViewport(w, h) {
    this.viewW = Math.max(1, w);
    this.viewH = Math.max(1, h);
  }

  /** Smoothly track the given world-space AABB while in auto mode. */
  update(dt, bounds) {
    if (this.mode !== 'auto' || !bounds) return;
    const bw = Math.max(50, bounds.maxX - bounds.minX);
    const bh = Math.max(50, bounds.maxY - bounds.minY);
    const targetScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(this.viewW / bw, this.viewH / bh) * FIT_MARGIN)
    );
    const targetX = (bounds.minX + bounds.maxX) / 2;
    const targetY = (bounds.minY + bounds.maxY) / 2;
    const k = 1 - Math.exp(-SMOOTHING * dt);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
    // Interpolate scale in log space so zoom feels uniform.
    this.scale = Math.exp(Math.log(this.scale) + (Math.log(targetScale) - Math.log(this.scale)) * k);
  }

  /** Wheel zoom keeping the world point under the cursor fixed. Enters manual mode. */
  zoomAt(screenX, screenY, factor) {
    this.mode = 'manual';
    const [wx, wy] = this.screenToWorld(screenX, screenY);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    // Re-solve center so (wx, wy) maps back to (screenX, screenY).
    this.x = wx - (screenX - this.viewW / 2) / this.scale;
    this.y = wy - (screenY - this.viewH / 2) / this.scale;
  }

  /** Drag pan by a screen-space delta. Enters manual mode. */
  panBy(dxScreen, dyScreen) {
    this.mode = 'manual';
    this.x -= dxScreen / this.scale;
    this.y -= dyScreen / this.scale;
  }

  follow() {
    this.mode = 'auto';
  }

  worldToScreen(wx, wy) {
    return [
      (wx - this.x) * this.scale + this.viewW / 2,
      (wy - this.y) * this.scale + this.viewH / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.viewW / 2) / this.scale + this.x,
      (sy - this.viewH / 2) / this.scale + this.y,
    ];
  }
}
