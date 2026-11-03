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
  // Acid: a marked or raining column is no place to stand, so aim just outside it, on the side
  // nearer the target.
  for (const c of run.acid) {
    const reach = c.halfWidth + ACID_CLEARANCE;
    if (Math.abs(target - c.x) >= reach && Math.abs(ship.x - c.x) >= reach) continue;
    target = target < c.x ? c.x - reach : c.x + reach;
  }
  const move = Math.max(-1, Math.min(1, (target - ship.x) / FULL_STEER_DISTANCE));
  return { move, drag: 0, fire: true, special: false };
}
