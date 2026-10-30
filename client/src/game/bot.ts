import { createRun, pickUpgrade, stepRun } from './run';
import type { RunState, ShipInput, UpgradeId } from './types';

// A scripted player for tuning checks: it tracks the nearest alien, holds fire, and picks
// upgrades from a fixed priority list. Used to measure how often a run is won.
//
// Win counts over seeds 1-30 with 3 lives (this bot's priority picks):
//   slice 1 (6 upgrades, old waves, first-offer picks): 12/30
//   2a upgrade pool + old waves:                        14/30
//   2a upgrade pool + retuned waves (before run.ts fold-in): 7/30
// Re-measure with `botWins()` after the fold-in; the retune should keep it well below slice 1.

const DT = 1 / 120;
const MAX_STEPS = 120 * 60 * 10;

/** What the bot takes first when it can. Anything not listed ranks last. */
export const BOT_PRIORITY: readonly UpgradeId[] = [
  'rapidFire', 'twinShot', 'piercing', 'extraLife', 'shieldPulse', 'thrusters', 'doubleTap', 'wingman',
];

/** Moves under the nearest alien and holds fire. */
export function botInput(run: RunState): ShipInput {
  const ship = run.players[0];
  let target: number | null = null;
  for (const a of run.aliens) {
    if (target === null || Math.abs(a.x - ship.x) < Math.abs(target - ship.x)) target = a.x;
  }
  const move = target === null ? 0 : Math.max(-1, Math.min(1, (target - ship.x) / 6));
  return { move, drag: 0, fire: true, special: false };
}

/** The index of the offer the bot would take. */
export function botPick(offer: readonly UpgradeId[]): number {
  let best = 0;
  let bestRank = Infinity;
  offer.forEach((id, i) => {
    const rank = BOT_PRIORITY.includes(id) ? BOT_PRIORITY.indexOf(id) : BOT_PRIORITY.length;
    if (rank < bestRank) {
      bestRank = rank;
      best = i;
    }
  });
  return best;
}

/** Plays one run with the bot until it ends (or runs out of time) and returns the final state. */
export function playBotRun(seed: number, lives: number): RunState {
  const run = createRun(seed);
  run.players[0].lives = lives;
  for (let n = 0; run.phase !== 'won' && run.phase !== 'lost' && n < MAX_STEPS; n++) {
    if (run.phase === 'chooseSpecial') run.phase = 'waveIntro';
    if (run.phase === 'upgradePick') pickUpgrade(run, botPick(run.offer));
    stepRun(run, [botInput(run)], DT);
  }
  return run;
}

/** How many of seeds 1..`seeds` the bot wins with `lives` lives. */
export function botWins(seeds = 30, lives = 3): number {
  let wins = 0;
  for (let seed = 1; seed <= seeds; seed++) if (playBotRun(seed, lives).phase === 'won') wins++;
  return wins;
}
