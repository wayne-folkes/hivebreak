import type { Fit } from '../game/playfield';
import { LEGACY_RECORD_WAVES } from '../game/records';
import type { RunRecord } from '../game/records';
import type { SourceKind } from '../game/controls';
import type { ActivePowerUp, BossKind, PowerUpKind, Rarity, Sector, SpecialId, SynergyId, UpgradeId } from '../game/types';
import { synergyDef } from '../game/synergies';
import { WAVES } from '../game/waves';
import { upgradeDef } from '../game/upgrades';

// The small pure helpers the menus and HUD share: text formatting, the upgrade-pick guard, the
// HUD's choice of layout, and the labels for the Special meter, power-up chips and boss bar. No DOM in here, so they're unit-tested on their own.

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

/**
 * One line of the Records list. `index` is the record's place in the list, 0 for the best. Waves
 * read "W5/10"; a record without `waves` came from the 5-wave game and reads "W5/5".
 */
export function recordRowText(index: number, record: RunRecord): RecordRowText {
  return {
    rank: String(index + 1),
    score: formatScore(record.score),
    wave: `W${record.wave}/${record.waves ?? LEGACY_RECORD_WAVES}`,
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

// Special, power-ups, bosses and synergies ------------------------------------------------------

/** Cells in the Special meter. */
export const METER_CELLS = 5;

/** The Special's short name for the HUD meter: "PULSE READY" has to fit a phone's corner. */
export const SPECIAL_SHORT: Record<SpecialId, string> = {
  pulseBomb: 'Pulse',
  shieldBurst: 'Shield',
  timeStop: 'Time',
};

/** How full each meter cell is, 0 to 1, left to right, for a meter at `charge` (0 to 1). */
export function meterCells(charge: number, cells = METER_CELLS): number[] {
  const c = Math.min(1, Math.max(0, Number.isFinite(charge) ? charge : 0));
  return Array.from({ length: cells }, (_, i) => Math.min(1, Math.max(0, c * cells - i)));
}

/** The key to press for the Special on the device in use. */
export function specialHint(device: SourceKind): string {
  if (device === 'gamepad') return 'B / LT';
  if (device === 'touch') return 'tap the button';
  return 'X';
}

/** Short names for power-up chips. */
export const POWER_UP_SHORT: Record<PowerUpKind, string> = {
  spread: 'Spread',
  laser: 'Laser',
  slow: 'Slow',
  helper: 'Helper',
};

/** Seconds left on a chip at or below this get a blink, so a running-out boost is noticed. */
export const POWER_UP_LOW_SECONDS = 3;

export interface PowerUpChip {
  kind: PowerUpKind;
  /** "SPREAD 6s". */
  label: string;
  /** Whole seconds left, rounded up so a chip never reads 0s while it still runs. */
  seconds: number;
  low: boolean;
}

/** The chips for a ship's running power-ups, in the order they run. Expired ones (0 s) are skipped. */
export function powerUpChips(powerUps: readonly ActivePowerUp[]): PowerUpChip[] {
  const chips: PowerUpChip[] = [];
  for (const p of powerUps) {
    if (!(p.timeLeft > 0)) continue;
    const seconds = Math.ceil(p.timeLeft);
    chips.push({
      kind: p.kind,
      label: `${POWER_UP_SHORT[p.kind].toUpperCase()} ${seconds}s`,
      seconds,
      low: p.timeLeft <= POWER_UP_LOW_SECONDS,
    });
  }
  return chips;
}

/** Boss names for the health bar and the pick card heading. */
export const BOSS_NAMES: Record<BossKind, string> = {
  broodMother: 'Brood Mother',
  hiveMind: 'Hive Mind',
};

/** The pick card's heading after a normal wave: "WAVE 3 CLEAR". */
export function waveClearHeading(wave: number): string {
  return `WAVE ${wave} CLEAR`;
}

/** The pick card's heading after a boss: "BROOD MOTHER DOWN". */
export function bossDownHeading(kind: BossKind): string {
  return `${BOSS_NAMES[kind].toUpperCase()} DOWN`;
}

/** The boss bar's fill as a CSS percentage, 0 to 100, from bossHealth()'s 0 to 1. */
export function bossBarPercent(health: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(health) ? health : 0)) * 100);
}

export interface PickTags {
  /** The rarity word to show, or null for none. */
  rarity: string | null;
  /** "completes LANCE", or null. */
  synergy: string | null;
}

/**
 * The labels under a pick card's text. A synergy hint takes the place of the rarity word, except
 * for a rare, whose word stays beside it (its gold border is shown either way).
 */
export function pickTags(rarity: Rarity, completes: SynergyId | null): PickTags {
  if (completes === null) return { rarity, synergy: null };
  return { rarity: rarity === 'rare' ? rarity : null, synergy: `completes ${synergyDef(completes).name.toUpperCase()}` };
}

/** The toast for a synergy unlocking: "SYNERGY: LANCE" over its description. */
export function synergyToast(id: SynergyId): { text: string; sub: string } {
  const def = synergyDef(id);
  return { text: `SYNERGY: ${def.name.toUpperCase()}`, sub: def.description };
}

// Sectors and the boss bar --------------------------------------------------------------------

/** The sector a wave belongs to (`wave` is the run's 0-based index); the last sector past the end. */
export function waveSector(wave: number): Sector {
  const def = WAVES[Math.min(Math.max(0, Math.floor(wave)), WAVES.length - 1)];
  return def ? def.sector : 1;
}

/** Subtitles under a sector's banner. */
export const SECTOR_SUBTITLES: Record<Sector, string> = {
  1: 'The outer hive',
  2: 'Deeper into the hive',
};

/**
 * The banner for a sector starting, or null for sector 1: the run opens with the plain wave
 * banner, so only going deeper gets a banner of its own.
 */
export function sectorBanner(sector: Sector): { title: string; sub: string } | null {
  if (sector <= 1) return null;
  return { title: `SECTOR ${sector}`, sub: SECTOR_SUBTITLES[sector] };
}

/** The boss bar's phase tag, "PHASE 2": only the Hive Mind has one worth showing; the Brood Mother gets null. */
export function bossPhaseLabel(kind: BossKind, phase: number): string | null {
  return kind === 'hiveMind' ? `PHASE ${Math.max(1, Math.floor(phase))}` : null;
}

/** The boss bar's whole caption, "HIVE MIND · PHASE 2" (the Brood Mother is just its name). */
export function bossBarLabel(kind: BossKind, phase: number): string {
  const name = BOSS_NAMES[kind].toUpperCase();
  const tag = bossPhaseLabel(kind, phase);
  return tag ? `${name} · ${tag}` : name;
}
