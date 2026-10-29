import type { Fit } from '../game/playfield';
import type { RunRecord } from '../game/records';
import type { UpgradeId } from '../game/types';
import { upgradeDef } from '../game/upgrades';

// The small pure helpers the menus and HUD share: text formatting, the upgrade-pick guard and the
// HUD's choice of layout. No DOM in here, so they're unit-tested on their own.

/** Digits in a score as shown: 4250 reads 004250. Bigger scores just grow. */
export const SCORE_DIGITS = 6;

export function formatScore(score: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(score) ? score : 0));
  return String(whole).padStart(SCORE_DIGITS, '0');
}

export function comboLabel(combo: number): string {
  return `x${Math.max(1, Math.floor(combo))}`;
}

/** Waves as shown in the HUD: `wave` counts from 1. */
export function waveLabel(wave: number, total: number): string {
  return `${wave}/${total}`;
}

/** How many times an upgrade has been taken, out of how many it can be: "2/3". */
export function stackLabel(taken: number, max: number): string {
  return `${taken}/${max}`;
}

/** Seconds after the upgrade pick opens during which confirm and clicks are ignored. */
export const PICK_GUARD_SECONDS = 0.4;

/**
 * Whether the upgrade pick takes a press yet. A fire press as the last alien dies must not pick
 * a card, so presses within the guard time of the pick opening are ignored.
 */
export function pickReady(openedAtMs: number, nowMs: number, guardSeconds = PICK_GUARD_SECONDS): boolean {
  return nowMs - openedAtMs >= guardSeconds * 1000;
}

/** The upgrades taken so far, each once with its count, in the order first picked. */
export function summarizeUpgrades(upgrades: readonly UpgradeId[]): { id: UpgradeId; name: string; count: number }[] {
  const counts = new Map<UpgradeId, number>();
  for (const id of upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, count]) => ({ id, name: upgradeDef(id).name, count }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A record's date as "29 Oct" (local time), or a dash if it can't be read. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export interface RecordRowText {
  rank: string;
  score: string;
  wave: string;
  combo: string;
  result: string;
  date: string;
}

/** One line of the Records list. `index` is the record's place in the list, 0 for the best. */
export function recordRowText(index: number, record: RunRecord): RecordRowText {
  return {
    rank: String(index + 1),
    score: formatScore(record.score),
    wave: `W${record.wave}`,
    combo: comboLabel(record.bestCombo),
    result: record.won ? 'WON' : 'LOST',
    date: formatDate(record.date),
  };
}

/** The end-of-run heading. */
export function endTitle(won: boolean, reason?: 'lives' | 'invaded'): string {
  if (won) return 'HIVE BROKEN';
  return reason === 'invaded' ? 'THE HIVE LANDED' : 'SHIP LOST';
}

/**
 * The badge for a finished run's place in the top 10 (`rank` from addRecord: 0 is the best, -1
 * means it didn't make the list). Null when there's nothing to show.
 */
export function rankBadge(rank: number): string | null {
  if (!Number.isInteger(rank) || rank < 0) return null;
  return rank === 0 ? 'New best!' : `Rank #${rank + 1}`;
}

/** Room each side of the field, in CSS pixels, before the HUD moves out into side panels. */
export const SIDE_PANEL_MIN = 150;
/**
 * Space to leave at the right edge of the screen in the overlay layout, for the pause button
 * (44 px wide, 12 px in from the edge, and a gap), in CSS pixels.
 */
export const PAUSE_RESERVE = 64;

export interface HudLayout {
  /** True: side panels either side of the field. False: overlaid on the top of the field. */
  side: boolean;
  /** Width of each side panel, CSS pixels. Zero in the overlay layout. */
  sideWidth: number;
  /** How far in from the field's right edge the overlay must stay, to clear the pause button. */
  rightInset: number;
}

/** Picks the HUD layout for a playfield placed by `fitPlayfield` in a viewport this wide. */
export function hudLayout(fit: Fit, viewWidth: number): HudLayout {
  const rightSpare = Math.max(0, viewWidth - fit.left - fit.width);
  const spare = Math.min(fit.left, rightSpare);
  if (spare >= SIDE_PANEL_MIN) return { side: true, sideWidth: Math.floor(spare), rightInset: 0 };
  return { side: false, sideWidth: 0, rightInset: Math.max(0, Math.ceil(PAUSE_RESERVE - rightSpare)) };
}
