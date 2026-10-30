import type { BossKind, RunEvent, RunState, ShipId, SpecialId, UpgradeId } from './types';
import type { StorageLike } from './records';
import { SHIP_IDS } from './ships';
import { SPECIAL_IDS } from './special';
import { UPGRADES } from './upgrades';
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

// --- Unlock queries ----------------------------------------------------------------------------

function sameUnlock(a: Unlock, b: Unlock): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Whether this is unlocked: in the starting pool, or the reward of a milestone met. */
export function isUnlocked(progress: Progress, unlock: Unlock): boolean {
  const starting: readonly string[] =
    unlock.kind === 'ship' ? STARTING_SHIPS : unlock.kind === 'special' ? STARTING_SPECIALS : STARTING_UPGRADES;
  if (starting.includes(unlock.id)) return true;
  return MILESTONES.some((m) => sameUnlock(m.reward, unlock) && progress.milestones.includes(m.id));
}

/** Unlocked ships, Specials and upgrades, each in its catalogue order (SHIP_IDS, SPECIAL_IDS, UPGRADES). */
export function unlockedShips(progress: Progress): ShipId[] {
  return SHIP_IDS.filter((id) => isUnlocked(progress, { kind: 'ship', id }));
}
export function unlockedSpecials(progress: Progress): SpecialId[] {
  return SPECIAL_IDS.filter((id) => isUnlocked(progress, { kind: 'special', id }));
}
export function unlockedUpgrades(progress: Progress): UpgradeId[] {
  return UPGRADES.map((u) => u.id).filter((id) => isUnlocked(progress, { kind: 'upgrade', id }));
}

/** The milestone that unlocks this, if any (null for the starting pool). */
export function milestoneFor(unlock: Unlock): MilestoneDef | null {
  return MILESTONES.find((m) => sameUnlock(m.reward, unlock)) ?? null;
}

/** The next milestones to aim for: the first `count` not yet met, in MILESTONES order. */
export function nextGoals(progress: Progress, count = 3): MilestoneDef[] {
  return MILESTONES.filter((m) => !progress.milestones.includes(m.id)).slice(0, Math.max(0, count));
}

// --- Recording a run ---------------------------------------------------------------------------

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
 * What has happened since the current wave started. The summary type has no room for it, so it is
 * kept beside the summary (and goes away with it).
 */
interface WaveWatch {
  comboBroken: boolean;
  lifeLost: boolean;
}
const watches = new WeakMap<RunSummary, WaveWatch>();

function watchFor(summary: RunSummary): WaveWatch {
  let w = watches.get(summary);
  if (!w) {
    w = { comboBroken: false, lifeLost: false };
    watches.set(summary, w);
  }
  return w;
}

/**
 * Folds one step's events into the summary (the real run's events only, never the demo's). `run`
 * is the run after the step, for anything the events don't carry.
 *
 * Events are folded in order, and every player's events count (the game is single-player for now,
 * so there is only one). A wave is "clean" when no comboBroken came between its waveStart and its
 * waveClear; a boss is "flawless" when no playerHit (a life lost; a shield absorbing a hit is a
 * shieldHit) came between its wave's waveStart and its bossKilled.
 */
export function recordEvents(summary: RunSummary, events: readonly RunEvent[], run: RunState): void {
  const watch = watchFor(summary);
  for (const e of events) {
    switch (e.type) {
      case 'waveStart':
        summary.reachedWave = Math.max(summary.reachedWave, e.wave);
        watch.comboBroken = false;
        watch.lifeLost = false;
        break;
      case 'waveClear':
        summary.wavesCleared += 1;
        if (!watch.comboBroken) summary.cleanWaves += 1;
        break;
      case 'comboBroken':
        watch.comboBroken = true;
        break;
      case 'playerHit':
        watch.lifeLost = true;
        break;
      case 'bossKilled':
        summary.bossesKilled.push(e.kind);
        if (!watch.lifeLost) summary.flawlessBosses.push(e.kind);
        break;
      case 'alienKilled':
        summary.kills += 1;
        break;
      case 'pickupCollected':
        summary.pickups += 1;
        break;
      case 'specialFired':
        summary.specials += 1;
        break;
      case 'synergyUnlocked':
        summary.synergies += 1;
        break;
      case 'won':
        summary.finished = true;
        summary.won = true;
        break;
      case 'lost':
        summary.finished = true;
        break;
      default:
        break;
    }
  }
  summary.bestCombo = Math.max(summary.bestCombo, run.bestCombo);
}

/**
 * Adds a run that has ended to the progress: totals first, then every milestone not yet met is
 * checked. Returns the new progress (the one passed in is not changed) and the milestones this
 * run met, in MILESTONES order. `summary.finished` says whether it counts as a finished run.
 */
export function completeRun(progress: Progress, summary: RunSummary): { progress: Progress; met: MilestoneDef[] } {
  const totals: Totals = {
    runs: progress.totals.runs + (summary.finished ? 1 : 0),
    kills: progress.totals.kills + summary.kills,
    specials: progress.totals.specials + summary.specials,
    winningShips: [...progress.totals.winningShips],
  };
  if (summary.won && !totals.winningShips.includes(summary.ship)) totals.winningShips.push(summary.ship);

  const met = MILESTONES.filter((m) => !progress.milestones.includes(m.id) && m.check(summary, totals));
  return {
    progress: { version: 1, milestones: [...progress.milestones, ...met.map((m) => m.id)], totals },
    met,
  };
}

// --- Saving ------------------------------------------------------------------------------------

const MILESTONE_IDS: ReadonlySet<string> = new Set(MILESTONES.map((m) => m.id));
const SHIP_ID_SET: ReadonlySet<string> = new Set(SHIP_IDS);

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * The progress in unknown data, checked field by field, or null if it isn't progress at all (not
 * an object, wrong version, no milestones list). Inside that, bad parts are repaired rather than
 * fatal: unknown or repeated milestones and unknown or repeated ships are dropped, and a total
 * that isn't a finite non-negative integer becomes 0. Shared by loadProgress and importCode.
 */
function parseProgress(data: unknown): Progress | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.version !== 1 || !Array.isArray(d.milestones)) return null;

  const milestones: MilestoneId[] = [];
  for (const id of d.milestones) {
    if (typeof id === 'string' && MILESTONE_IDS.has(id) && !milestones.includes(id as MilestoneId)) {
      milestones.push(id as MilestoneId);
    }
  }

  const t = typeof d.totals === 'object' && d.totals !== null ? (d.totals as Record<string, unknown>) : {};
  const winningShips: ShipId[] = [];
  if (Array.isArray(t.winningShips)) {
    for (const id of t.winningShips) {
      if (typeof id === 'string' && SHIP_ID_SET.has(id) && !winningShips.includes(id as ShipId)) winningShips.push(id as ShipId);
    }
  }
  return { version: 1, milestones, totals: { runs: count(t.runs), kills: count(t.kills), specials: count(t.specials), winningShips } };
}

/** The saved progress; missing, corrupt or unreadable storage gives emptyProgress(). */
/** Whether a saved progress string is from a version newer than this game understands. */
function newerSaveVersion(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== 'object' || saved === null) return false;
    const version = (saved as { version?: unknown }).version;
    return typeof version === 'number' && version > 1;
  } catch {
    return false;
  }
}

export function loadProgress(storage: StorageLike): Progress {
  try {
    const raw = storage.getItem(PROGRESS_KEY);
    if (raw === null) return emptyProgress();
    return parseProgress(JSON.parse(raw)) ?? emptyProgress();
  } catch {
    return emptyProgress();
  }
}

/**
 * Saves the progress, unless storage already holds a save from a newer version of the game (a
 * player who went back to an older build): that save is kept rather than overwritten.
 */
export function saveProgress(storage: StorageLike, progress: Progress): void {
  try {
    if (newerSaveVersion(storage.getItem(PROGRESS_KEY))) return;
    storage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    // Storage full or blocked: this visit goes on without saving.
  }
}

// --- Export code -------------------------------------------------------------------------------

const CODE_PREFIX = 'HB1-';

function toBase64Url(text: string): string {
  let binary = '';
  for (const b of new TextEncoder().encode(text)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(payload: string): string {
  const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Four hex characters from an FNV-1a hash of the payload: enough to catch a mistyped code. */
function checksum(payload: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (((h >>> 16) ^ h) & 0xffff).toString(16).padStart(4, '0');
}

/** A short text code holding the progress, to copy somewhere safe: `HB1-`, base64url, `-`, a 4-hex checksum. */
export function exportCode(progress: Progress): string {
  const clean = parseProgress(progress) ?? emptyProgress();
  const payload = toBase64Url(JSON.stringify(clean));
  return `${CODE_PREFIX}${payload}-${checksum(payload)}`;
}

/** The progress in a code from exportCode, or null if it isn't a valid code. Whitespace around it is ignored. */
export function importCode(code: string): Progress | null {
  try {
    const text = code.trim();
    if (!text.startsWith(CODE_PREFIX)) return null;
    const rest = text.slice(CODE_PREFIX.length);
    // base64url can contain '-', but the checksum is hex, so the last '-' is the separator.
    const sep = rest.lastIndexOf('-');
    if (sep < 1) return null;
    const payload = rest.slice(0, sep);
    const sum = rest.slice(sep + 1).toLowerCase();
    if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[0-9a-f]{4}$/.test(sum) || sum !== checksum(payload)) return null;
    return parseProgress(JSON.parse(fromBase64Url(payload)));
  } catch {
    return null;
  }
}
