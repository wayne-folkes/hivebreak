import { ALIEN_SPECS, MEND_INTERVAL } from './aliens';
import { INVADE_MARGIN, SIDE_MARGIN, SLOT_SPACING_Y, slotPosition } from './formation';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP } from './player';
import type { Alien, RunEvent, RunState } from './types';
import { WAVES, waveColumns } from './waves';

// Sector 3's aliens: the Warper, which blinks to an empty slot in the formation the first time a
// hit doesn't kill it, and the Mender, which every few seconds heals its damaged neighbours.
//
// Both run on enemy time and use only `run.rng`, so a seeded run replays exactly. Nothing here
// touches a wave without Warpers or Menders.

/** Seconds a Warper takes to warp in at its new slot; shots pass through it meanwhile. */
export const WARP_SECONDS = 0.35;
/** Seconds between a Mender's healing pulses (enemy time). Defined in aliens.ts (a Mender starts with it). */
export { MEND_INTERVAL };
/** A Warper prefers a new slot at least this many slots away (columns or rows) from its old one. */
const BLINK_MIN_DISTANCE = 2;

// Scratch space so a blink allocates nothing.
const occupiedScratch = new Set<number>();
const farScratch: number[] = [];
const nearScratch: number[] = [];

/** A slot's key: row in the high bits so it sorts the way the wave reads, top row first. */
const slotKey = (col: number, row: number) => row * 64 + col;

/**
 * An alien took damage and lived (from any source: a shot, the laser, a chain spark, a burst, the
 * well). A Warper that hasn't blinked yet blinks to an empty slot now, with an alienWarped event.
 *
 * Only a Warper in formation blinks: one that is diving or returning just takes the hit and keeps
 * its blink for later. An empty slot is a place inside the wave's grid (its widest row by its
 * number of rows) that no living slotted alien holds; divers keep their slots while away. Slots at
 * least BLINK_MIN_DISTANCE away from where the Warper is are preferred, and with no free slot at
 * all it doesn't blink (and stays able to, if one frees up). The new position is the slot's, so
 * the formation carries the Warper along from there.
 */
export function alienHitSurvived(run: RunState, alien: Alien, events: RunEvent[]): void {
  if (alien.kind !== 'warper' || alien.warped || alien.hp <= 0 || alien.mode !== 'formation') return;
  const def = WAVES[run.wave];
  const cols = waveColumns(def);
  const rows = def.rows.length;
  const spec = ALIEN_SPECS.warper;

  occupiedScratch.clear();
  for (const a of run.aliens) if (a.col >= 0 && a.hp > 0) occupiedScratch.add(slotKey(a.col, a.row));
  farScratch.length = 0;
  nearScratch.length = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const key = slotKey(col, row);
      if (occupiedScratch.has(key) || !blinkable(run, col, row, cols, spec)) continue;
      const far = Math.max(Math.abs(col - alien.col), Math.abs(row - alien.row)) >= BLINK_MIN_DISTANCE;
      (far ? farScratch : nearScratch).push(key);
    }
  }
  const choices = farScratch.length > 0 ? farScratch : nearScratch;
  if (choices.length === 0) return;

  const key = run.rng.pick(choices);
  const col = key % 64;
  const row = Math.floor(key / 64);
  const fromX = alien.x;
  const fromY = alien.y;
  const pos = slotPosition(run.formation, col, row, cols);
  alien.col = col;
  alien.row = row;
  alien.x = pos.x;
  alien.y = pos.y;
  alien.warped = true;
  alien.warp = WARP_SECONDS;
  events.push({ type: 'alienWarped', alienId: alien.id, fromX, fromY, toX: pos.x, toY: pos.y });
}

/**
 * Whether a Warper may blink to this slot: it must be on the field now (a wiped-out column can be
 * past the wall once the formation has marched up to its remaining edge; a blink there would make
 * the march snap the whole formation back) and a row clear of the invade line (a blink into an
 * emptied low row mustn't end the run).
 */
function blinkable(run: RunState, col: number, row: number, cols: number, spec: { halfWidth: number; halfHeight: number }): boolean {
  const pos = slotPosition(run.formation, col, row, cols);
  if (Math.abs(pos.x) + spec.halfWidth > FIELD_WIDTH / 2 - SIDE_MARGIN) return false;
  return pos.y - spec.halfHeight > SHIP_TOP + INVADE_MARGIN + SLOT_SPACING_Y;
}

/** Counts Warpers' warp-ins down, on real time: a Time Stop or a stun mustn't keep one untouchable. */
export function stepWarps(run: RunState, dt: number): void {
  for (const a of run.aliens) if (a.warp !== undefined && a.warp > 0) a.warp = Math.max(0, a.warp - dt);
}

/**
 * Ticks Menders' pulses, on enemy time (not called while frozen or stunned).
 *
 * A Mender only counts down while it sits in the formation (not while diving or returning). When
 * its timer runs out it heals 1 hp to each damaged living alien in the slots around it (within one
 * column and one row, formation mode only, never past the kind's full hp), resets the timer, and
 * pushes a mendPulse listing where it healed. A pulse that finds nobody to heal is silent.
 */
export function stepSector3Aliens(run: RunState, dt: number, events: RunEvent[]): void {
  for (const a of run.aliens) {
    if (a.kind !== 'mender' || a.hp <= 0 || a.mode !== 'formation') continue;
    a.mendTimer = (a.mendTimer ?? MEND_INTERVAL) - dt;
    if (a.mendTimer > 0) continue;
    a.mendTimer = Math.max(0, a.mendTimer + MEND_INTERVAL);
    mendAround(run, a, events);
  }
}

/** One Mender's pulse: heals what's damaged next to it. */
function mendAround(run: RunState, mender: Alien, events: RunEvent[]): void {
  let healed: { x: number; y: number }[] | null = null;
  // Heals up to the wave's full strength: its armour counts.
  const armour = WAVES[run.wave]?.armour ?? 0;
  for (const a of run.aliens) {
    if (a === mender || a.mode !== 'formation' || a.col < 0 || a.hp <= 0) continue;
    if (Math.abs(a.col - mender.col) > 1 || Math.abs(a.row - mender.row) > 1) continue;
    if (a.hp >= ALIEN_SPECS[a.kind].hp + armour) continue;
    a.hp++;
    (healed ??= []).push({ x: a.x, y: a.y });
  }
  if (healed) events.push({ type: 'mendPulse', alienId: mender.id, x: mender.x, y: mender.y, healed });
}

/** Whether shots, beams and arcs can touch this alien right now (not while a Warper warps in). */
export function canBeHit(alien: Alien): boolean {
  return !(alien.warp !== undefined && alien.warp > 0);
}
