import { alienBox } from './aliens';
import type { Alien, Box, Shot } from './types';

// Overlap tests. Axis-aligned boxes are enough: the playfield is flat and the fastest thing
// moves only a few art pixels per step, less than the smallest box, so nothing tunnels.

/** Half sizes of a shot's hit box (the same for both sides), art pixels. */
export const SHOT_HALF_WIDTH = 1;
export const SHOT_HALF_HEIGHT = 3;

export function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth && Math.abs(a.y - b.y) < a.halfHeight + b.halfHeight;
}

export function shotBox(shot: Shot): Box {
  return { x: shot.x, y: shot.y, halfWidth: SHOT_HALF_WIDTH, halfHeight: SHOT_HALF_HEIGHT };
}

/**
 * The living alien a shot is touching, or null. If it touches several, the lowest one wins
 * (the first a shot fired from below would reach), then the lowest id.
 */
export function firstAlienHit(shot: Shot, aliens: readonly Alien[]): Alien | null {
  const box = shotBox(shot);
  let best: Alien | null = null;
  for (const a of aliens) {
    if (a.hp <= 0 || !overlaps(box, alienBox(a))) continue;
    if (!best || a.y < best.y || (a.y === best.y && a.id < best.id)) best = a;
  }
  return best;
}
