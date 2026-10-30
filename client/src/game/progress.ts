import type { BossKind, RunEvent, RunState, ShipId, SpecialId, UpgradeId } from './types';
import type { StorageLike } from './records';
import { WAVES } from './waves';

// Unlocks: what a player has earned across runs. A new player starts with a trimmed pool (the
// Breaker, two Specials and nine upgrades); each milestone, met once, unlocks one more ship,
// Special or upgrade. Progress lives in the browser only (localStorage), with an export code as a
// backup.
//
// CONTRACT: the types, the starting pool and the milestone table are fixed here. The progression
// worker writes the functions below the table (marked TODO) and their tests.
//
// How the game uses it (main.ts): a RunSummary is started when a real run starts
// (newSummary), fed every step's events (recordEvents), and handed to completeRun when the run
// ends (won, lost, or quit to the title). completeRun returns the new progress and the
// milestones this run met, which the end-of-run "UNLOCKED" moment shows.

/** Something a milestone unlocks. */
export type Unlock =
  | { kind: 'ship'; id: ShipId }
  | { kind: 'special'; id: SpecialId }
  | { kind: 'upgrade'; id: UpgradeId };

export type MilestoneId =
  | 'firstSteps'
  | 'comboMaster'
  | 'synergist'
  | 'collector'
  | 'specialist'
  | 'unbroken'
  | 'untouched'
  | 'deepSpace'
  | 'broodSlayer'
  | 'hiveReached'
  | 'victor'
  | 'frozenVictory'
  | 'fleet'
  | 'exterminator'
  | 'veteran'
  | 'overdrive';

/** What one run did, collected from its events and its end state. */
export interface RunSummary {
  ship: ShipId;
  special: SpecialId;
  /** The run ended by winning or losing (false: quit from the pause menu). */
  finished: boolean;
  won: boolean;
  /** Highest wave index (0-based) the run started. */
  reachedWave: number;
  /** Waves cleared. */
  wavesCleared: number;
  /** Waves cleared without the combo breaking during them. */
  cleanWaves: number;
  /** Bosses destroyed. */
  bossesKilled: BossKind[];
  /** Bosses destroyed without losing a life during their wave. */
  flawlessBosses: BossKind[];
  bestCombo: number;
  /** Synergies unlocked this run. */
  synergies: number;
  /** Power-ups caught this run. */
  pickups: number;
  /** Specials fired this run. */
  specials: number;
  /** Aliens destroyed this run (not boss parts or the boss itself). */
  kills: number;
}

/** Running totals across every run. */
export interface Totals {
  /** Runs finished (won or lost; quits don't count). */
  runs: number;
  kills: number;
  specials: number;
  /** The different ships that have won a run, in the order they first won. */
  winningShips: ShipId[];
}

/** The saved progress. */
export interface Progress {
  version: 1;
  /** Milestones met, in the order they were met. What is unlocked follows from these. */
  milestones: MilestoneId[];
  totals: Totals;
}

export interface MilestoneDef {
  id: MilestoneId;
  name: string;
  /** What to do, as the unlocks screen and the locked items show it: "Reach sector 2". */
  description: string;
  reward: Unlock;
  /**
   * Whether it is met, given the run just ended and the totals with that run already added.
   * Milestones are checked when a run ends, including a quit.
   */
  check(run: RunSummary, totals: Totals): boolean;
  /** For a milestone counted across runs: how far along the player is, for the unlocks screen. */
  progress?(totals: Totals): { value: number; target: number };
}

/** What a new player has. */
export const STARTING_SHIPS: readonly ShipId[] = ['breaker'];
export const STARTING_SPECIALS: readonly SpecialId[] = ['pulseBomb', 'shieldBurst'];
export const STARTING_UPGRADES: readonly UpgradeId[] = [
  'twinShot',
  'rapidFire',
  'extraLife',
  'piercing',
  'shieldPulse',
  'thrusters',
  'comboGuard',
  'magnet',
  'homing',
];

/** The wave index where sector 2 begins, and the Hive Mind's wave. */
export const SECTOR_2_WAVE = WAVES.findIndex((w) => w.sector === 2);
export const HIVE_MIND_WAVE = WAVES.findIndex((w) => w.boss === 'hiveMind');

/** Every milestone, in the order the unlocks screen lists them (roughly easiest first). */
export const MILESTONES: readonly MilestoneDef[] = [
  {
    id: 'firstSteps',
    name: 'First steps',
    description: 'Clear wave 3',
    reward: { kind: 'upgrade', id: 'ricochet' },
    check: (run) => run.wavesCleared >= 3,
  },
  {
    id: 'unbroken',
    name: 'Unbroken',
    description: 'Clear a wave without breaking your combo',
    reward: { kind: 'upgrade', id: 'bombOnKill' },
    check: (run) => run.cleanWaves >= 1,
  },
  {
    id: 'synergist',
    name: 'Synergist',
    description: 'Unlock a synergy',
    reward: { kind: 'upgrade', id: 'chainSpark' },
    check: (run) => run.synergies >= 1,
  },
  {
    id: 'collector',
    name: 'Collector',
    description: 'Catch 10 power-ups in one run',
    reward: { kind: 'upgrade', id: 'scavenger' },
    check: (run) => run.pickups >= 10,
  },
  {
    id: 'specialist',
    name: 'Specialist',
    description: 'Fire your Special 5 times in one run',
    reward: { kind: 'special', id: 'timeStop' },
    check: (run) => run.specials >= 5,
  },
  {
    id: 'comboMaster',
    name: 'Combo master',
    description: 'Reach an x8 combo',
    reward: { kind: 'upgrade', id: 'overcharge' },
    check: (run) => run.bestCombo >= 8,
  },
  {
    id: 'deepSpace',
    name: 'Deep space',
    description: 'Reach sector 2',
    reward: { kind: 'ship', id: 'interceptor' },
    check: (run) => run.reachedWave >= SECTOR_2_WAVE,
  },
  {
    id: 'broodSlayer',
    name: 'Brood slayer',
    description: 'Defeat the Brood Mother',
    reward: { kind: 'ship', id: 'lancer' },
    check: (run) => run.bossesKilled.includes('broodMother'),
  },
  {
    id: 'untouched',
    name: 'Untouched',
    description: 'Beat the Brood Mother without losing a life',
    reward: { kind: 'upgrade', id: 'doubleTap' },
    check: (run) => run.flawlessBosses.includes('broodMother'),
  },
  {
    id: 'overdrive',
    name: 'Overdrive',
    description: 'Fire 20 Specials in total',
    reward: { kind: 'upgrade', id: 'overclock' },
    check: (_run, totals) => totals.specials >= 20,
    progress: (totals) => ({ value: totals.specials, target: 20 }),
  },
  {
    id: 'exterminator',
    name: 'Exterminator',
    description: 'Destroy 300 aliens in total',
    reward: { kind: 'ship', id: 'bastion' },
    check: (_run, totals) => totals.kills >= 300,
    progress: (totals) => ({ value: totals.kills, target: 300 }),
  },
  {
    id: 'hiveReached',
    name: 'Into the hive',
    description: 'Reach the Hive Mind',
    reward: { kind: 'special', id: 'missileSwarm' },
    check: (run) => run.reachedWave >= HIVE_MIND_WAVE,
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Finish 10 runs',
    reward: { kind: 'upgrade', id: 'lastStand' },
    check: (_run, totals) => totals.runs >= 10,
    progress: (totals) => ({ value: totals.runs, target: 10 }),
  },
  {
    id: 'victor',
    name: 'Hivebreaker',
    description: 'Win a run',
    reward: { kind: 'special', id: 'gravityWell' },
    check: (run) => run.won,
  },
  {
    id: 'frozenVictory',
    name: 'Cold victory',
    description: 'Win with Time Stop',
    reward: { kind: 'upgrade', id: 'slowField' },
    check: (run) => run.won && run.special === 'timeStop',
  },
  {
    id: 'fleet',
    name: 'Fleet admiral',
    description: 'Win with two different ships',
    reward: { kind: 'upgrade', id: 'wingman' },
    check: (_run, totals) => totals.winningShips.length >= 2,
    progress: (totals) => ({ value: totals.winningShips.length, target: 2 }),
  },
];

export const PROGRESS_KEY = 'hivebreak.progress.v1';

export function emptyProgress(): Progress {
  return { version: 1, milestones: [], totals: { runs: 0, kills: 0, specials: 0, winningShips: [] } };
}

// --- TODO (progression worker) -----------------------------------------------------------------

/** Whether this is unlocked: in the starting pool, or the reward of a milestone met. */
export function isUnlocked(_progress: Progress, _unlock: Unlock): boolean {
  return true;
}

/** Unlocked ships, Specials and upgrades, each in its catalogue order (SHIP_IDS, SPECIAL_IDS, UPGRADES). */
export function unlockedShips(_progress: Progress): ShipId[] {
  return ['breaker'];
}
export function unlockedSpecials(_progress: Progress): SpecialId[] {
  return [...STARTING_SPECIALS];
}
export function unlockedUpgrades(_progress: Progress): UpgradeId[] {
  return [...STARTING_UPGRADES];
}

/** The milestone that unlocks this, if any (null for the starting pool). */
export function milestoneFor(_unlock: Unlock): MilestoneDef | null {
  return null;
}

/** A fresh summary for a run about to start. */
export function newSummary(ship: ShipId, special: SpecialId): RunSummary {
  return {
    ship,
    special,
    finished: false,
    won: false,
    reachedWave: 0,
    wavesCleared: 0,
    cleanWaves: 0,
    bossesKilled: [],
    flawlessBosses: [],
    bestCombo: 1,
    synergies: 0,
    pickups: 0,
    specials: 0,
    kills: 0,
  };
}

/**
 * Folds one step's events into the summary (the real run's events only, never the demo's). `run`
 * is the run after the step, for anything the events don't carry.
 */
export function recordEvents(_summary: RunSummary, _events: readonly RunEvent[], _run: RunState): void {}

/**
 * Adds a run that has ended to the progress: totals first, then every milestone not yet met is
 * checked. Returns the new progress (the one passed in is not changed) and the milestones this
 * run met, in MILESTONES order. `summary.finished` says whether it counts as a finished run.
 */
export function completeRun(progress: Progress, _summary: RunSummary): { progress: Progress; met: MilestoneDef[] } {
  return { progress, met: [] };
}

/** The saved progress; missing, corrupt or unreadable storage gives emptyProgress(). */
export function loadProgress(_storage: StorageLike): Progress {
  return emptyProgress();
}

export function saveProgress(_storage: StorageLike, _progress: Progress): void {}

/** A short text code holding the progress, to copy somewhere safe: `HB1-` and then base64url. */
export function exportCode(_progress: Progress): string {
  return 'HB1-';
}

/** The progress in a code from exportCode, or null if it isn't a valid code. Whitespace around it is ignored. */
export function importCode(_code: string): Progress | null {
  return null;
}

/** The next milestones to aim for: the first `count` not yet met, in MILESTONES order. */
export function nextGoals(_progress: Progress, _count = 3): MilestoneDef[] {
  return [];
}
