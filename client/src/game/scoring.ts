import { basePoints } from './aliens';
import type { Alien, PlayerState, RunEvent, RunState } from './types';

// Combo scoring: the first hit of each shot raises the multiplier (after that hit's own points
// are counted, so the first kill in a chain is x1), a volley whose shots all fly off without
// hitting anything drops it back to 1, and a kill is worth its base points times the multiplier
// as it stood before the hit. Only the ship's fan of shots counts: overcharge, lance, wingman and
// power-up shots are fired in the VOLLEY_HIT volley, so they can't miss, and a hit by them doesn't
// raise the combo (the run raises it only on the first hit of a counted volley). A combo guard
// forgives a miss before it can break the combo.

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

// VOLLEY_HIT lives in types.ts so player.ts can use it without importing this module (which
// would close an import cycle through aliens.ts). Re-exported for existing callers.
export { VOLLEY_HIT } from './types';

/**
 * Call when a volley has left the field without a single hit. Resets the combo, with an event if
 * there was one to lose. If `player` (whose volley it was) has a combo guard left, it is used up
 * instead and the combo survives.
 */
export function registerMiss(run: RunState, player?: PlayerState): RunEvent[] {
  if (run.combo <= 1) return [];
  if (player && player.comboGuardLeft > 0) {
    player.comboGuardLeft--;
    return [{ type: 'comboGuarded', playerId: player.id }];
  }
  const lost = run.combo;
  run.combo = 1;
  return [{ type: 'comboBroken', combo: lost }];
}

/** Call at the start of every wave: refills the ship's shield and combo guard from its stats. */
export function refillWaveGuards(player: PlayerState): void {
  player.shield = player.stats.shieldPerWave;
  player.comboGuardLeft = player.stats.comboGuard;
  player.shieldRegen = 0;
  player.bulwarkUsed = false;
}

/** Adds the points for a kill at the current combo to the score, and returns them. */
export function awardKill(run: RunState, alien: Alien): number {
  const points = killPoints(alien, run.combo);
  run.score += points;
  return points;
}
