import { SHIP_X_LIMIT } from '../game/player';
import type { RunState, ShipInput } from '../game/types';

// Plays the demo run behind the title screen: chases the lowest alien's column and holds fire,
// stepping out of an acid column (sector 3) that is marked or raining.

/** Art pixels of distance at which the autopilot steers at full speed. */
const FULL_STEER_DISTANCE = 6;
/** How far beyond an acid column's edge the autopilot keeps the ship's centre, art pixels (the ship is 16 wide). */
const ACID_CLEARANCE = 10;

export function autopilot(run: RunState): ShipInput {
  const ship = run.players[0];
  if (!ship) return { move: 0, drag: 0, fire: false, special: false };
  let target = ship.x;
  let lowest = Infinity;
  for (const a of run.aliens) {
    // An alien flying back to its slot is no threat, so it isn't chased.
    if (a.mode === 'returning') continue;
    // The lowest alien is the most urgent one.
    if (a.y < lowest) {
      lowest = a.y;
      target = a.x;
    }
  }
  if (run.acid.length > 0) target = clearOfAcid(run, ship.x, target);
  const move = Math.max(-1, Math.min(1, (target - ship.x) / FULL_STEER_DISTANCE));
  return { move, drag: 0, fire: true, special: false };
}

/**
 * Acid: a marked or raining column is no place to stand. With the ship or its target in one, aims
 * at the nearest spot to the target that is clear of every column and that the ship can reach: a
 * column against a wall is left by its open side, and two columns close together are left by the
 * far side of both.
 */
function clearOfAcid(run: RunState, shipX: number, target: number): number {
  const inAcid = (x: number) => run.acid.some((c) => Math.abs(x - c.x) < c.halfWidth + ACID_CLEARANCE);
  if (!inAcid(target) && !inAcid(shipX)) return target;
  const spots = [target];
  for (const c of run.acid) spots.push(c.x - c.halfWidth - ACID_CLEARANCE, c.x + c.halfWidth + ACID_CLEARANCE);
  let best: number | null = null;
  for (const raw of spots) {
    const x = Math.max(-SHIP_X_LIMIT, Math.min(SHIP_X_LIMIT, raw));
    if (inAcid(x)) continue;
    if (best === null || Math.abs(x - target) < Math.abs(best - target)) best = x;
  }
  // Nowhere is clear (the field is all acid): keep chasing.
  return best ?? target;
}
