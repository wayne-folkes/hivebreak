import { FIELD_WIDTH } from './playfield';
import { SEEKERS_EXTRA_BOUNCES, SEEKERS_HOMING_CAP, SEEKERS_HOMING_FACTOR } from './synergies';
import type { Shot } from './types';

// How a shot flies: straight, steering toward the nearest alien above it (homing), and bouncing
// off the side walls (ricochet). Pure, so the run can call it in place of a plain move.

/** Homing never turns a shot below this angle from horizontal, so it can't be steered to crawl sideways, radians. */
export const HOMING_MIN_ELEVATION = 0.35;

const HALF_WIDTH = FIELD_WIDTH / 2;

/** Anything with a place, for a shot to home in on. */
export interface Target {
  x: number;
  y: number;
}

/** The target nearest to the shot among those above it, or null. */
function nearestAbove(shot: Shot, targets: readonly Target[]): Target | null {
  let best: Target | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    if (t.y <= shot.y) continue;
    const d = (t.x - shot.x) ** 2 + (t.y - shot.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** Turns the shot's velocity toward `target` by at most `maxTurn` radians, keeping its speed. */
function steer(shot: Shot, target: Target, maxTurn: number): void {
  const speed = Math.hypot(shot.vx, shot.vy);
  if (speed === 0) return;
  const heading = Math.atan2(shot.vy, shot.vx);
  const wanted = Math.atan2(target.y - shot.y, target.x - shot.x);
  let diff = wanted - heading;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  let next = heading + Math.max(-maxTurn, Math.min(maxTurn, diff));
  // Keep it flying upward enough to get somewhere.
  next = Math.max(HOMING_MIN_ELEVATION, Math.min(Math.PI - HOMING_MIN_ELEVATION, next));
  shot.vx = Math.cos(next) * speed;
  shot.vy = Math.sin(next) * speed;
}

/**
 * Moves a shot for one step. A player's shot with `homing` turns toward the nearest of `targets`
 * above it (at `homing` radians per second, keeping its speed); one with bounces left reflects off
 * the side walls. With `seekers` (the owner has the Seekers synergy), a shot's first bounce
 * doubles its homing and gives it one more bounce. Enemy shots just fly straight.
 */
export function stepShot(shot: Shot, targets: readonly Target[], dt: number, seekers = false): void {
  if (shot.owner === 'player' && shot.homing > 0) {
    const target = nearestAbove(shot, targets);
    if (target) steer(shot, target, shot.homing * dt);
  }
  shot.x += shot.vx * dt;
  shot.y += shot.vy * dt;

  if (shot.bouncesLeft > 0 && Math.abs(shot.x) > HALF_WIDTH) {
    const side = Math.sign(shot.x);
    // Only bounce a shot that's moving outward, so it can't get stuck against the wall.
    if (Math.sign(shot.vx) === side) {
      shot.x = side * HALF_WIDTH - (shot.x - side * HALF_WIDTH);
      shot.vx = -shot.vx;
      shot.bouncesLeft--;
      shot.bounces = (shot.bounces ?? 0) + 1;
      if (seekers && shot.bounces === 1) {
        shot.homing = Math.min(SEEKERS_HOMING_CAP, shot.homing * SEEKERS_HOMING_FACTOR);
        shot.bouncesLeft += SEEKERS_EXTRA_BOUNCES;
      }
    }
  }
}
