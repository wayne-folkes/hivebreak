import { ALIEN_SPECS, createAlien } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP } from './player';
import type { Rng } from './rng';
import type { Alien, AlienKind, FormationState, WaveDef } from './types';
import { waveColumns } from './waves';

// The formation: a grid of slots that marches side to side, drops a row at each edge, speeds
// up as it thins, and picks which alien fires. Aliens in formation sit on their slots.

/** Distance between slot centres, art pixels. */
export const SLOT_SPACING_X = 24;
export const SLOT_SPACING_Y = 20;
/** Height of the top row at the start of a wave. */
export const FORMATION_TOP_Y = 110;
/** Gap kept between an alien's box and the side of the field before the formation turns. */
export const SIDE_MARGIN = 6;
/** How far the formation drops each time it turns. */
export const DROP_DISTANCE = 8;
/** Extra march speed gained as aliens fall: speed rises by this many times the starting speed over the whole wave. */
export const SPEED_UP = 2;
/** The formation has invaded when an alien's bottom is this far above the top of the ship's hit box. */
export const INVADE_MARGIN = 4;

const KINDS: Record<string, AlienKind> = { d: 'drone', w: 'warden', v: 'diver', c: 'carrier' };

/** Where the slot at (col, row) is right now, with the formation's offset applied. */
export function slotPosition(formation: FormationState, col: number, row: number, cols: number): { x: number; y: number } {
  return {
    x: (col - (cols - 1) / 2) * SLOT_SPACING_X + formation.offsetX,
    y: FORMATION_TOP_Y - row * SLOT_SPACING_Y + formation.offsetY,
  };
}

/** Builds a wave's aliens on their slots, handing out ids with `newId`. */
export function spawnFormation(def: WaveDef, newId: () => number): { aliens: Alien[]; formation: FormationState } {
  const cols = waveColumns(def);
  const formation: FormationState = { offsetX: 0, offsetY: 0, dir: 1, startCount: 0 };
  const aliens: Alien[] = [];
  def.rows.forEach((rowText, row) => {
    [...rowText].forEach((char, col) => {
      if (char === '.') return;
      const kind = KINDS[char];
      if (!kind) throw new Error(`Unknown alien '${char}' in wave row '${rowText}'`);
      const pos = slotPosition(formation, col, row, cols);
      aliens.push(createAlien(kind, newId(), col, row, pos.x, pos.y));
    });
  });
  formation.startCount = aliens.length;
  return { aliens, formation };
}

/** Sideways march speed: the wave's speed, rising up to three times over as aliens are destroyed. */
export function marchSpeed(def: WaveDef, formation: FormationState, alive: number): number {
  const destroyed = formation.startCount > 0 ? 1 - alive / formation.startCount : 0;
  return def.marchSpeed * (1 + SPEED_UP * destroyed);
}

/**
 * Marches the formation for one step. When any slot in use (including divers' slots) would
 * push an alien's box past the side margin, it's pulled back to touch the margin, drops a row
 * and turns round.
 */
export function stepFormation(formation: FormationState, aliens: readonly Alien[], def: WaveDef, dt: number): void {
  if (aliens.length === 0) return;
  const cols = waveColumns(def);
  formation.offsetX += formation.dir * marchSpeed(def, formation, aliens.length) * dt;

  let minEdge = Infinity;
  let maxEdge = -Infinity;
  for (const a of aliens) {
    const x = slotPosition(formation, a.col, a.row, cols).x;
    const half = ALIEN_SPECS[a.kind].halfWidth;
    minEdge = Math.min(minEdge, x - half);
    maxEdge = Math.max(maxEdge, x + half);
  }

  const limit = FIELD_WIDTH / 2 - SIDE_MARGIN;
  if (formation.dir === 1 && maxEdge > limit) {
    formation.offsetX -= maxEdge - limit;
    formation.dir = -1;
    formation.offsetY -= DROP_DISTANCE;
  } else if (formation.dir === -1 && minEdge < -limit) {
    formation.offsetX += -limit - minEdge;
    formation.dir = 1;
    formation.offsetY -= DROP_DISTANCE;
  }
}

/** True with the probability that an event at `ratePerSecond` happens in a step of `dt`. */
export function rollEvent(ratePerSecond: number, dt: number, rng: Rng): boolean {
  if (ratePerSecond <= 0) return false;
  return rng.next() < 1 - Math.exp(-ratePerSecond * dt);
}

/** The lowest formation alien in a random column that still has one, or null if none are left. */
export function pickShooter(aliens: readonly Alien[], rng: Rng): Alien | null {
  const lowest = new Map<number, Alien>();
  for (const a of aliens) {
    if (a.mode !== 'formation') continue;
    const current = lowest.get(a.col);
    if (!current || a.row > current.row) lowest.set(a.col, a);
  }
  if (lowest.size === 0) return null;
  const cols = [...lowest.keys()].sort((a, b) => a - b);
  return lowest.get(rng.pick(cols)) ?? null;
}

/** True when a formation alien has come down to the ship's row. */
export function hasInvaded(aliens: readonly Alien[]): boolean {
  const line = SHIP_TOP + INVADE_MARGIN;
  return aliens.some((a) => a.mode === 'formation' && a.y - ALIEN_SPECS[a.kind].halfHeight <= line);
}
