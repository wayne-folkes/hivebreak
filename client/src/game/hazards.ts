import type { Box, RunEvent, RunState, Shot } from './types';

// Sector 3's hazards: mines that drift down the field, and acid rain.
//
// - A mine drifts down slowly. A player's shot bursts it (shootMine), damaging the aliens within
//   MINE_BURST_RADIUS (the run applies the damage, credited to the shooter). A mine that touches a
//   bunker goes off there and bites it; one that reaches the ship's row goes off, and its blast
//   hurts a ship close by.
// - Acid rain: a column is marked at the top for ACID_WARN_SECONDS, then rains for
//   ACID_RAIN_SECONDS; the rain hurts a ship standing in it and eats bunkers from above.
//
// TODO(4a worker): implement. run.ts calls these hooks; keep their signatures.

/** Radius of a shot mine's burst, art pixels, and the damage it does to each alien inside. */
export const MINE_BURST_RADIUS = 26;
export const MINE_BURST_DAMAGE = 2;
export const ACID_WARN_SECONDS = 1;
export const ACID_RAIN_SECONDS = 1.5;

/** Clears the hazards and sets the spawn timers for the wave now starting (run.wave). */
export function resetHazards(run: RunState): void {
  run.mines = [];
  run.acid = [];
  run.mineTimer = 0;
  run.acidTimer = 0;
}

/**
 * Spawns, moves and ends mines and acid columns on enemy time `dt`, bites bunkers, and returns
 * the areas that hurt a ship this step (a mine's blast at the ship's row, a raining column). The
 * run damages a vulnerable ship touching any of them.
 */
export function stepHazards(_run: RunState, _dt: number, _events: RunEvent[]): Box[] {
  return [];
}

/**
 * A player's shot against the mines: bursts the first mine it touches (removing it, with a
 * mineBurst event) and returns the burst's centre, or null if it touched none. The run spends the
 * shot and applies the burst's damage to aliens.
 */
export function shootMine(_run: RunState, _shot: Shot, _events: RunEvent[]): { x: number; y: number } | null {
  return null;
}
