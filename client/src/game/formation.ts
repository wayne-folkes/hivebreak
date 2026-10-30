import { ALIEN_SPECS, createAlien } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP } from './player';
import type { Rng } from './rng';
import type { Alien, AlienKind, FormationState, SplitState, WaveDef } from './types';
import { waveColumns } from './waves';

// The formation: a grid of slots that marches side to side, drops a row at each edge, speeds
// up as it thins, and picks which alien fires. Aliens in formation sit on their slots.
//
// Sector 2 adds two behaviours (see WaveDef.behaviours). 'split': the formation's left and right
// halves separate, march on their own, then close back up, over and over (stepFormation drives
// it and says when it changes phase). 'pairedDives': pickDivePair finds two neighbouring divers
// to dive together (aliens.ts's startPairedDive starts them).
//
// How run.ts uses the new parts:
//   each step  const change = stepFormation(...) as today; if it returns 'split' emit
//              { type: 'formationSplit' }, if 'regroup' emit { type: 'formationRegroup' }.
//              Everything else (slotPosition, hasInvaded, pickShooter) is unchanged for callers:
//              slotPosition already accounts for the alien's half.
//   dives      on a wave with the 'pairedDives' behaviour, when a dive is due call pickDivePair(run.aliens, run.rng, run.formation.split);
//              if it gives a pair, startPairedDive(left, right, targetX) and emit a diveStart for
//              each; if it gives null fall back to the single dive.

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

/** Seconds the formation marches as one before it splits (and again after each regroup). */
export const SPLIT_JOINED_SECONDS = 6;
/** Seconds the halves march on their own before they regroup. */
export const SPLIT_APART_SECONDS = 5;
/** Speed the halves close back up at while regrouping, art pixels per second. */
export const SPLIT_REGROUP_SPEED = 45;
/** The halves bounce off each other when their offsets come this close, art pixels. */
export const SPLIT_MIN_SEPARATION = 8;
/** A half dropping off a side wall while apart steps down this far: two halves, one full drop. */
export const SPLIT_DROP = DROP_DISTANCE / 2;
/** Two divers count as neighbours when their x is within this many slot widths. */
const PAIR_REACH = 1.5;

const KINDS: Record<string, AlienKind> = { d: 'drone', w: 'warden', v: 'diver', c: 'carrier', s: 'splitter' };

// Scratch space for stepFormation, so a step allocates nothing; the sim is synchronous.
const slottedScratch: Alien[] = [];

/** What stepFormation reports when the split behaviour changes phase. */
export type FormationChange = 'split' | 'regroup' | null;

/** A fresh split state for a formation `cols` wide: joined, with the halves meeting in the middle. */
export function createSplitState(cols: number): SplitState {
  return {
    mode: 'joined',
    modeTime: 0,
    leftOffsetX: 0,
    rightOffsetX: 0,
    leftDir: -1,
    rightDir: 1,
    splitColumn: Math.ceil(cols / 2),
  };
}

/**
 * Where the slot at (col, row) is right now, with the formation's offset applied, plus the extra
 * offset of the alien's half while the formation is split.
 */
export function slotPosition(formation: FormationState, col: number, row: number, cols: number): { x: number; y: number } {
  const split = formation.split;
  const half = split ? (col < split.splitColumn ? split.leftOffsetX : split.rightOffsetX) : 0;
  return {
    x: (col - (cols - 1) / 2) * SLOT_SPACING_X + formation.offsetX + half,
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
  if (def.behaviours?.includes('split')) formation.split = createSplitState(cols);
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
 *
 * On a wave with `formation.split` (the 'split' behaviour) it also runs the split cycle: joined
 * for SPLIT_JOINED_SECONDS, then the halves (columns below `splitColumn`, and the rest) march on
 * their own for SPLIT_APART_SECONDS, bouncing off the side walls and off each other, then they
 * close back up at SPLIT_REGROUP_SPEED and the cycle repeats. Returns 'split' on the step the
 * halves separate, 'regroup' on the step they start closing up (emit formationSplit /
 * formationRegroup for those) and null otherwise. A split needs aliens in both halves; with one
 * half gone the formation just marches as one.
 */
export function stepFormation(formation: FormationState, aliens: readonly Alien[], def: WaveDef, dt: number): FormationChange {
  // Free aliens (minis, a boss's Drones) have no slot, so they don't march and don't count.
  const slotted = slottedScratch;
  slotted.length = 0;
  for (const a of aliens) if (a.mode !== 'free') slotted.push(a);
  if (slotted.length === 0) return null;
  const cols = waveColumns(def);
  const split = formation.split;
  if (split && split.mode !== 'joined') return stepSplit(formation, split, slotted, def, cols, dt);

  formation.offsetX += formation.dir * marchSpeed(def, formation, slotted.length) * dt;

  let minEdge = Infinity;
  let maxEdge = -Infinity;
  for (const a of slotted) {
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

  if (split) {
    split.modeTime += dt;
    if (split.modeTime >= SPLIT_JOINED_SECONDS && halfEdges(formation, split, slotted, cols, false) && halfEdges(formation, split, slotted, cols, true)) {
      split.mode = 'apart';
      split.modeTime = 0;
      split.leftDir = -1;
      split.rightDir = 1;
      return 'split';
    }
  }
  return null;
}

/** The left or right half's outer edges right now (slots in use, divers included), or null if it has no aliens. */
function halfEdges(
  formation: FormationState,
  split: SplitState,
  aliens: readonly Alien[],
  cols: number,
  rightHalf: boolean,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const a of aliens) {
    if (a.col < 0 || (a.col >= split.splitColumn) !== rightHalf) continue;
    const x = slotPosition(formation, a.col, a.row, cols).x;
    const half = ALIEN_SPECS[a.kind].halfWidth;
    min = Math.min(min, x - half);
    max = Math.max(max, x + half);
  }
  return min <= max ? { min, max } : null;
}

/** One step of the apart and regrouping phases. The formation's own offset holds still; the halves move. */
function stepSplit(
  formation: FormationState,
  split: SplitState,
  aliens: readonly Alien[],
  def: WaveDef,
  cols: number,
  dt: number,
): FormationChange {
  split.modeTime += dt;

  if (split.mode === 'regrouping') {
    const reach = SPLIT_REGROUP_SPEED * dt;
    split.leftOffsetX = approach(split.leftOffsetX, reach);
    split.rightOffsetX = approach(split.rightOffsetX, reach);
    if (split.leftOffsetX === 0 && split.rightOffsetX === 0) {
      split.mode = 'joined';
      split.modeTime = 0;
      split.leftDir = -1;
      split.rightDir = 1;
    }
    return null;
  }

  const step = marchSpeed(def, formation, aliens.length) * dt;
  split.leftOffsetX += split.leftDir * step;
  split.rightOffsetX += split.rightDir * step;

  // The halves bounce off each other: heading towards one another and too close, they swap directions.
  if (split.leftDir === 1 && split.rightDir === -1) {
    const deficit = SPLIT_MIN_SEPARATION - (split.rightOffsetX - split.leftOffsetX);
    if (deficit > 0 && halfEdges(formation, split, aliens, cols, false) && halfEdges(formation, split, aliens, cols, true)) {
      split.leftOffsetX -= deficit / 2;
      split.rightOffsetX += deficit / 2;
      split.leftDir = -1;
      split.rightDir = 1;
    }
  }

  // Each half bounces off the side walls, and steps down when it does.
  const limit = FIELD_WIDTH / 2 - SIDE_MARGIN;
  const left = halfEdges(formation, split, aliens, cols, false);
  if (left && left.min < -limit) {
    split.leftOffsetX += -limit - left.min;
    if (split.leftDir === -1) {
      split.leftDir = 1;
      formation.offsetY -= SPLIT_DROP;
    }
  }
  const right = halfEdges(formation, split, aliens, cols, true);
  if (right && right.max > limit) {
    split.rightOffsetX -= right.max - limit;
    if (split.rightDir === 1) {
      split.rightDir = -1;
      formation.offsetY -= SPLIT_DROP;
    }
  }

  if (split.modeTime >= SPLIT_APART_SECONDS) {
    split.mode = 'regrouping';
    split.modeTime = 0;
    return 'regroup';
  }
  return null;
}

/** Moves `value` towards 0 by at most `reach`. */
function approach(value: number, reach: number): number {
  return Math.abs(value) <= reach ? 0 : value - Math.sign(value) * reach;
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

/**
 * Two neighbouring divers to dive together on a 'pairedDives' wave: both in formation, in the same
 * row and adjacent columns (and, when `split` is given, i.e. `formation.split`, both on the same
 * half: both left of its splitColumn or both at or right of it), as [left, right]. Picks one pair at random with `rng`, or returns null (without touching `rng`)
 * when there is none. Start both with aliens.ts's startPairedDive(left, right, targetX) so they
 * swoop mirrored and arrive as a pair; the fold-in falls back to a single dive on null.
 */
export function pickDivePair(aliens: readonly Alien[], rng: Rng, split?: SplitState): [Alien, Alien] | null {
  const cell = (row: number, col: number) => row * 64 + col;
  const divers = new Map<number, Alien>();
  for (const a of aliens) if (a.kind === 'diver' && a.mode === 'formation') divers.set(cell(a.row, a.col), a);
  const pairs: [Alien, Alien][] = [];
  for (const a of aliens) {
    const next = divers.get(cell(a.row, a.col + 1));
    if (!(a.kind === 'diver' && a.mode === 'formation' && next && next.x - a.x <= SLOT_SPACING_X * PAIR_REACH)) continue;
    if (split && a.col < split.splitColumn !== next.col < split.splitColumn) continue;
    pairs.push([a, next]);
  }
  return pairs.length > 0 ? rng.pick(pairs) : null;
}

/** True when a formation alien has come down to the ship's row. */
export function hasInvaded(aliens: readonly Alien[]): boolean {
  const line = SHIP_TOP + INVADE_MARGIN;
  return aliens.some((a) => a.mode === 'formation' && a.y - ALIEN_SPECS[a.kind].halfHeight <= line);
}
