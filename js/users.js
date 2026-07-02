// Author entities and change beams. Movement and fading are wall-clock
// driven so they look the same at every playback speed.

import { authorColor, initials, hashString } from './colors.js';

export const USER_IDLE_S = 6.0;
export const USER_FADE_S = 3.0;
export const BEAM_S = 0.9;

const APPROACH = 4.0;   // steering acceleration factor
const HOVER_DIST = 55;  // users hover beside their target, not on top of it

export class UserEntity {
  constructor(key, name, email) {
    this.key = key;
    this.name = name;
    this.email = email;
    this.color = authorColor(name);
    this.initials = initials(name);
    // Stable per-user hover offset so simultaneous authors don't stack.
    const a = (hashString(key) % 628) / 100;
    this.offsetX = Math.cos(a) * HOVER_DIST;
    this.offsetY = Math.sin(a) * HOVER_DIST;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.hasPosition = false;
    this.alpha = 0;
    this.lastCommitWall = -Infinity;
    this.lastCommitSimTime = -Infinity;
  }

  setTarget(cx, cy) {
    this.targetX = cx + this.offsetX;
    this.targetY = cy + this.offsetY;
    if (!this.hasPosition) {
      // First appearance: spawn a bit further out and fly in.
      this.x = this.targetX + this.offsetX * 3;
      this.y = this.targetY + this.offsetY * 3;
      this.hasPosition = true;
    }
  }
}

export class Beam {
  constructor(user, file, color, bornWall) {
    this.user = user;
    this.file = file;
    this.color = color;
    this.bornWall = bornWall;
  }
}

export function updateUsers(users, wallNow, dt) {
  for (const u of users.values()) {
    const idle = wallNow - u.lastCommitWall;
    if (idle < USER_IDLE_S) {
      u.alpha = Math.min(1, u.alpha + dt * 4);
    } else {
      u.alpha = Math.max(0, u.alpha - dt / USER_FADE_S);
    }
    if (u.alpha <= 0) continue;
    u.vx += (u.targetX - u.x) * APPROACH * dt;
    u.vy += (u.targetY - u.y) * APPROACH * dt;
    u.vx *= 0.9;
    u.vy *= 0.9;
    u.x += u.vx * dt;
    u.y += u.vy * dt;
  }
}

export function expireBeams(beams, wallNow) {
  for (let i = beams.length - 1; i >= 0; i--) {
    if (wallNow - beams[i].bornWall > BEAM_S) {
      beams[i] = beams[beams.length - 1];
      beams.pop();
    }
  }
}
