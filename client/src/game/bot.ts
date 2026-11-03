import { standingParts } from './boss';
import { chooseSpecial, createRun, pickUpgrade, stepRun } from './run';
import { specialReady } from './special';
import type { RunState, ShipInput, UpgradeId } from './types';

// A scripted player for tuning checks: it tracks the nearest alien, holds fire, and picks
// upgrades from a fixed priority list. Used to measure how often a run is won.
//
// Win counts over seeds 1-30 with 3 lives (this bot's priority picks):
//   slice 1 (6 upgrades, old waves, first-offer picks): 12/30
//   2a upgrade pool + old waves:                        14/30
//   2a upgrade pool + retuned waves (before run.ts fold-in): 7/30
//   2a folded into run.ts (Brood Mother wave 5, Pulse Bomb chosen, pressed when ready): 0/30 with 3 lives,
//   3/30 with 5. The bot never dodges, and the boss fight costs it 3-39 lives, so the boss is the
//   wall (see the 2a fold-in report for the tuning suggestion).
//   2b, all ten waves and both bosses (boss hp as retuned to plates 8 / core 80), real bunkers:
//   4/30 with 3 lives, 12/30 with 5. Seeds that die with 3 lives: 6 in wave 1 (the bot sits under
//   the bunkers, where its own shots are spent, so the first wave drags on), 13 to the Brood
//   Mother, 1 in wave 4, 1 in sector 2 (wave 6), 5 to the Hive Mind; 9 of 30 reach wave 10.

const DT = 1 / 120;
const MAX_STEPS = 120 * 60 * 10;

/** What the bot takes first when it can. Anything not listed ranks last. */
export const BOT_PRIORITY: readonly UpgradeId[] = [
  'rapidFire', 'twinShot', 'piercing', 'extraLife', 'shieldPulse', 'thrusters', 'doubleTap', 'wingman',
];

/**
 * Moves under the nearest alien, or with none left (a boss wave) under the nearest standing
 * plate, then the core (the Hive Mind's core, once its ring is the only thing left), and holds
 * fire. Presses the Special as soon as the meter is full. Never dodges, and ignores the bunkers:
 * its shots dig through them and it sometimes sits under their cover.
 */
export function botInput(run: RunState): ShipInput {
  const ship = run.players[0];
  let target: number | null = null;
  for (const a of run.aliens) {
    if (target === null || Math.abs(a.x - ship.x) < Math.abs(target - ship.x)) target = a.x;
  }
  if (target === null && run.boss) {
    // The shields first (the Brood Mother's plates, the Hive Heart's veins), then the core.
    const plates = [...standingParts(run.boss, 'plate'), ...standingParts(run.boss, 'vein')];
    const parts = plates.length > 0 ? plates : standingParts(run.boss, 'core');
    for (const p of parts) {
      const x = run.boss.x + p.dx;
      if (target === null || Math.abs(x - ship.x) < Math.abs(target - ship.x)) target = x;
    }
  }
  const move = target === null ? 0 : Math.max(-1, Math.min(1, (target - ship.x) / 6));
  return { move, drag: 0, fire: true, special: specialReady(ship) };
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
  chooseSpecial(run, 'pulseBomb');
  run.players[0].lives = lives;
  for (let n = 0; run.phase !== 'won' && run.phase !== 'lost' && n < MAX_STEPS; n++) {
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
