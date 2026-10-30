import { FIELD_WIDTH } from './playfield';
import { SEEKERS_EXTRA_BOUNCES, SEEKERS_HOMING_CAP, SEEKERS_HOMING_FACTOR } from './synergies';
import type { Shot } from './types';

// How a shot flies: straight, steering toward the nearest alien above it (homing), and bouncing
// off the side walls (ricochet). Pure, so the run can call it in place of a plain move. A Missile
// Swarm missile homes like any shot (each on one of the few nearest targets, by its id, so the
// swarm spreads out), and with nothing above it turns to fly straight up.

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

/** A Swarm missile aims at one of this many nearest targets (by its id), so the swarm does not all pile onto one alien. */
export const MISSILE_TARGET_SPREAD = 4;

// Scratch for spreadAbove: the nearest few targets above a shot, closest first.
const nearTargets: Target[] = [];
const nearDists: number[] = [];

/**
 * One of the nearest MISSILE_TARGET_SPREAD targets above the shot, picked by `pick` (taken modulo
 * how many there are, so a short list is shared out evenly), or null if none is above.
 */
function spreadAbove(shot: Shot, targets: readonly Target[], pick: number): Target | null {
  const keep = MISSILE_TARGET_SPREAD;
  let n = 0;
  for (const t of targets) {
    if (t.y <= shot.y) continue;
    const d = (t.x - shot.x) ** 2 + (t.y - shot.y) ** 2;
    if (n === keep && d >= nearDists[n - 1]) continue;
    // Insert in order, dropping the farthest if the list is full.
    let i = n < keep ? n++ : n - 1;
    while (i > 0 && nearDists[i - 1] > d) {
      nearDists[i] = nearDists[i - 1];
      nearTargets[i] = nearTargets[i - 1];
      i--;
    }
    nearDists[i] = d;
    nearTargets[i] = t;
  }
  return n === 0 ? null : nearTargets[pick % n];
}

// Where a missile with nothing above it steers: straight up, so it flies back to the field.
const straightUp: Target = { x: 0, y: 0 };

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
    let target = shot.kind === 'missile' ? spreadAbove(shot, targets, shot.id) : nearestAbove(shot, targets);
    if (!target && shot.kind === 'missile') {
      // A missile that has passed everything (or fired into an empty field) levels out upward
      // instead of flying off the side.
      straightUp.x = shot.x;
      straightUp.y = shot.y + 1;
      target = straightUp;
    }
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
