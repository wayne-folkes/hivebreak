import type { RunState, ShipInput } from '../game/types';

// Plays the demo run behind the title screen: chases the lowest alien's column and holds fire.

/** Art pixels of distance at which the autopilot steers at full speed. */
const FULL_STEER_DISTANCE = 6;

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
  const move = Math.max(-1, Math.min(1, (target - ship.x) / FULL_STEER_DISTANCE));
  return { move, drag: 0, fire: true, special: false };
}
