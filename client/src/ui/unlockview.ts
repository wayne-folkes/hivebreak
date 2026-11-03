import {
  bossRushUnlocked,
  isUnlocked,
  MILESTONES,
  milestoneFor,
  nextGoals,
  type MilestoneDef,
  type Progress,
  type Unlock,
} from '../game/progress';
import { SHIP_IDS, SHIPS } from '../game/ships';
import { SPECIAL_IDS, SPECIALS } from '../game/special';
import type { ShipId, SpecialId } from '../game/types';
import { UPGRADES } from '../game/upgrades';
import {
  progressPercent,
  progressText,
  shipStatPips,
  unlockedCountLabel,
  unlockKindLabel,
  unlockLabel,
  unlockName,
  type ShipStatPips,
} from './format';

// What the unlock cards show, worked out from the progress: no DOM in here, so it is unit-tested
// on its own. The cards (ship.ts, special.ts, unlocked.ts, unlocks.ts) only turn these into markup.

/** Where a ship's 32x32 icon is served from (client/public/ships). */
export function shipIconUrl(id: ShipId): string {
  return `/ships/${id}.png`;
}

/** The milestone that unlocks something, as "Reach sector 2", or null for the starting pool. */
export function unlockHint(unlock: Unlock): string | null {
  return milestoneFor(unlock)?.description ?? null;
}

// --- Modes --------------------------------------------------------------------------------------

/** The milestone that opens Boss Rush (see bossRushUnlocked). */
const BOSS_RUSH_MILESTONE: MilestoneDef['id'] = 'victor';
const BOSS_RUSH_NAME = 'Boss Rush';
const MODE_KIND = 'Mode';

// --- Ship choice --------------------------------------------------------------------------------

export interface ShipEntry {
  id: ShipId;
  name: string;
  description: string;
  lives: number;
  unlocked: boolean;
  /** What unlocks it (only for a locked ship). */
  hint: string | null;
  pips: ShipStatPips;
}

/** Every ship in SHIP_IDS order, unlocked or not. */
export function shipEntries(progress: Progress): ShipEntry[] {
  const all = SHIP_IDS.map((id) => SHIPS[id]);
  return all.map((def) => {
    const unlock: Unlock = { kind: 'ship', id: def.id };
    const unlocked = isUnlocked(progress, unlock);
    return {
      id: def.id,
      name: def.name,
      description: def.description,
      lives: def.lives,
      unlocked,
      hint: unlocked ? null : unlockHint(unlock),
      pips: shipStatPips(def, all),
    };
  });
}

/** The card focus lands on: the last ship chosen if it is still unlocked, otherwise the first unlocked one. */
export function focusEntry<T extends { id: string; unlocked: boolean }>(entries: readonly T[], last?: string | null): T | null {
  return entries.find((e) => e.unlocked && e.id === last) ?? entries.find((e) => e.unlocked) ?? null;
}

// --- Special choice -----------------------------------------------------------------------------

export interface SpecialEntry {
  id: SpecialId;
  name: string;
  description: string;
  unlocked: boolean;
  hint: string | null;
}

export function specialEntries(progress: Progress): SpecialEntry[] {
  return SPECIAL_IDS.map((id) => {
    const unlock: Unlock = { kind: 'special', id };
    const unlocked = isUnlocked(progress, unlock);
    return { id, name: SPECIALS[id].name, description: SPECIALS[id].description, unlocked, hint: unlocked ? null : unlockHint(unlock) };
  });
}

// --- End-of-run "UNLOCKED" ----------------------------------------------------------------------

export interface UnlockedEntry {
  milestone: MilestoneDef['id'];
  /** The reward's name: "Lancer". */
  name: string;
  /** "Ship", "Special", "Upgrade" or "Mode". */
  kind: string;
  /** "for: Defeat the Brood Mother". */
  reason: string;
  /** Set for a ship, whose icon is shown. */
  shipId: ShipId | null;
}

export function unlockedEntries(met: readonly MilestoneDef[]): UnlockedEntry[] {
  return met.flatMap((m) => {
    const entry: UnlockedEntry = {
      milestone: m.id,
      name: unlockName(m.reward),
      kind: unlockKindLabel(m.reward.kind),
      reason: `for: ${m.description}`,
      shipId: m.reward.kind === 'ship' ? m.reward.id : null,
    };
    // The first win opens Boss Rush as well as its own reward, so it is announced beside it.
    return m.id === BOSS_RUSH_MILESTONE ? [entry, { ...entry, name: BOSS_RUSH_NAME, kind: MODE_KIND, shipId: null }] : [entry];
  });
}

// --- Unlocks screen -----------------------------------------------------------------------------

export interface ProgressView {
  text: string;
  percent: number;
}

export interface UnlockRow {
  /** What it unlocks; null for a game mode (Boss Rush), which is not a ship, Special or upgrade. */
  unlock: Unlock | null;
  name: string;
  unlocked: boolean;
  /** In the starting pool, so no milestone unlocks it. */
  starter: boolean;
  /** The milestone's description, for a locked item. */
  hint: string | null;
  /** For a locked item whose milestone counts across runs. */
  progress: ProgressView | null;
}

export interface GoalRow {
  id: MilestoneDef['id'];
  /** What it unlocks: "Ship · Interceptor" ("Special · Gravity Well + Mode · Boss Rush" for the first win). */
  reward: string;
  description: string;
  progress: ProgressView | null;
}

export interface UnlocksOverview {
  met: number;
  total: number;
  /** "7 / 16 unlocked". */
  countText: string;
  goals: GoalRow[];
  sections: { title: string; rows: UnlockRow[] }[];
}

function progressView(progress: Progress, milestone: MilestoneDef | null): ProgressView | null {
  const p = milestone?.progress?.(progress.totals);
  return p ? { text: progressText(p), percent: progressPercent(p) } : null;
}

function row(progress: Progress, unlock: Unlock): UnlockRow {
  const unlocked = isUnlocked(progress, unlock);
  const milestone = milestoneFor(unlock);
  return {
    unlock,
    name: unlockName(unlock),
    unlocked,
    starter: milestone === null,
    hint: unlocked ? null : (milestone?.description ?? null),
    progress: unlocked ? null : progressView(progress, milestone),
  };
}

/** The Boss Rush row of the Modes section: open once the first win is in. */
function bossRushRow(progress: Progress): UnlockRow {
  const unlocked = bossRushUnlocked(progress);
  return {
    unlock: null,
    name: BOSS_RUSH_NAME,
    unlocked,
    starter: false,
    hint: unlocked ? null : (MILESTONES.find((m) => m.id === BOSS_RUSH_MILESTONE)?.description ?? null),
    progress: null,
  };
}

/** How many milestones are met, counting only ones in the table. */
export function metCount(progress: Progress): number {
  return MILESTONES.filter((m) => progress.milestones.includes(m.id)).length;
}

export function unlocksOverview(progress: Progress, goalCount = 3): UnlocksOverview {
  const met = metCount(progress);
  const total = MILESTONES.length;
  return {
    met,
    total,
    countText: unlockedCountLabel(met, total),
    goals: nextGoals(progress, goalCount).map((m) => ({
      id: m.id,
      reward: m.id === BOSS_RUSH_MILESTONE ? `${unlockLabel(m.reward)} + ${MODE_KIND} · ${BOSS_RUSH_NAME}` : unlockLabel(m.reward),
      description: m.description,
      progress: progressView(progress, m),
    })),
    sections: [
      { title: 'Ships', rows: SHIP_IDS.map((id) => row(progress, { kind: 'ship', id })) },
      { title: 'Specials', rows: SPECIAL_IDS.map((id) => row(progress, { kind: 'special', id })) },
      { title: 'Modes', rows: [bossRushRow(progress)] },
      { title: 'Upgrades', rows: UPGRADES.map((u) => row(progress, { kind: 'upgrade', id: u.id })) },
    ],
  };
}
