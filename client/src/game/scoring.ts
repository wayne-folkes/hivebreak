import { basePoints } from './aliens';
import type { Alien, RunEvent, RunState } from './types';

// Combo scoring: the first hit of each shot raises the multiplier (after that hit's own points
// are counted, so the first kill in a chain is x1), a volley whose shots all fly off without
// hitting anything drops it back to 1, and a kill is worth its base points times the multiplier
// as it stood before the hit.

export const COMBO_MAX = 8;

/** Points for killing `alien` while the multiplier is `combo`. */
export function killPoints(alien: Alien, combo: number): number {
  return basePoints(alien) * combo;
}

/** Call when a player's shot lands its first hit: raises the combo (up to COMBO_MAX). */
export function registerShotHit(run: RunState): void {
  run.combo = Math.min(COMBO_MAX, run.combo + 1);
  run.bestCombo = Math.max(run.bestCombo, run.combo);
}

/** Marks a volley (see Shot.volley) in which some shot has hit something, so its other shots can't count as misses. */
export const VOLLEY_HIT = -1;

/** Call when a volley has left the field without a single hit. Resets the combo, with an event if there was one to lose. */
export function registerMiss(run: RunState): RunEvent[] {
  if (run.combo <= 1) return [];
  const lost = run.combo;
  run.combo = 1;
  return [{ type: 'comboBroken', combo: lost }];
}

/** Adds the points for a kill at the current combo to the score, and returns them. */
export function awardKill(run: RunState, alien: Alien): number {
  const points = killPoints(alien, run.combo);
  run.score += points;
  return points;
}
