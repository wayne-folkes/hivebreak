import { FIELD_WIDTH } from './playfield';
import { SHIP_Y } from './player';
import type { Alien, AlienKind, Box, DivePath } from './types';

// The alien kinds: their sizes, toughness and points, and how a diver swoops out of the
// formation and flies back to its slot. A diver's path is a closed-form curve over its dive
// time, so it needs nothing but the alien's own state to follow.

export interface AlienSpec {
  hp: number;
  /** Points for a kill, before the combo multiplier. */
  points: number;
  /** Half sizes of the hit box, art pixels. */
  halfWidth: number;
  halfHeight: number;
}

export const ALIEN_SPECS: Record<AlienKind, AlienSpec> = {
  drone: { hp: 1, points: 10, halfWidth: 7, halfHeight: 5 },
  warden: { hp: 2, points: 30, halfWidth: 8, halfHeight: 6 },
  diver: { hp: 1, points: 40, halfWidth: 6, halfHeight: 6 },
  // Slow and tough, sits in the formation and never dives; always drops a power-up (see powerups.ts).
  carrier: { hp: 4, points: 60, halfWidth: 10, halfHeight: 7 },
  // Sector 2. Sits in the formation a little bigger than a drone; when killed it splits into two
  // minis (see splitAlien), so a Splitter is worth more than a warden but its minis are cheap.
  splitter: { hp: 2, points: 50, halfWidth: 8, halfHeight: 6 },
  // Small and fragile, always a free alien: it never has a slot, flies down like a launched Drone
  // and crashes into ships like a diver.
  mini: { hp: 1, points: 10, halfWidth: 5, halfHeight: 4 },
};

/** Sideways speed the two minis of a split Splitter fly apart at, art pixels per second. */
export const MINI_SPREAD_VX = 32;
/** Downward speed the minis start with (they speed up under stepFreeAlien's fall acceleration). */
export const MINI_LAUNCH_VY = -55;
/** How far from the Splitter's centre each mini starts, so the pair doesn't overlap, art pixels. */
export const MINI_OFFSET_X = 4;
/**
 * A pair of divers heads for targets this far either side of the player's x, art pixels. Kept
 * under the ship's half-width plus a diver's (14) so a still ship is boxed in: both diver boxes
 * overlap it at the bottom of the swoop, and the player has to move to dodge.
 */
export const PAIR_DIVE_SPREAD = 8;

/** Seconds of white flash after a hit. */
export const HIT_FLASH_SECONDS = 0.08;
/** A diver is worth this many times its points while it's diving. */
export const DIVE_POINTS_MULTIPLIER = 2;
/** Seconds a dive takes from leaving the formation to the bottom of its swoop. */
export const DIVE_SECONDS = 2.5;
/** Where a dive bottoms out: just below the ship's row. */
export const DIVE_END_Y = SHIP_Y - 14;
/** Sideways swing of the dive curve, art pixels. */
export const DIVE_SWAY = 24;
/** Speed at which a diver flies back to its slot, art pixels per second. */
export const RETURN_SPEED = 110;

export function createAlien(kind: AlienKind, id: number, col: number, row: number, x: number, y: number): Alien {
  return { id, kind, hp: ALIEN_SPECS[kind].hp, col, row, x, y, mode: 'formation', modeTime: 0, flash: 0 };
}

export function alienBox(alien: Alien): Box {
  const spec = ALIEN_SPECS[alien.kind];
  return { x: alien.x, y: alien.y, halfWidth: spec.halfWidth, halfHeight: spec.halfHeight };
}

/** Points for killing this alien, before the combo multiplier. */
export function basePoints(alien: Alien): number {
  const base = ALIEN_SPECS[alien.kind].points;
  return alien.mode === 'diving' ? base * DIVE_POINTS_MULTIPLIER : base;
}

/** Reduces the alien's hit points and starts its flash. Returns true if that killed it. */
export function damageAlien(alien: Alien): boolean {
  alien.hp--;
  alien.flash = HIT_FLASH_SECONDS;
  return alien.hp <= 0;
}

/** Sends the alien swooping from where it is towards `targetX` (clamped to the field). */
export function startDive(alien: Alien, targetX: number): void {
  const limit = FIELD_WIDTH / 2 - ALIEN_SPECS[alien.kind].halfWidth;
  alien.mode = 'diving';
  alien.modeTime = 0;
  alien.dive = { fromX: alien.x, fromY: alien.y, toX: Math.min(limit, Math.max(-limit, targetX)) };
}

/**
 * Sends two neighbouring divers (from `pickDivePair`, in formation) swooping at the same moment
 * towards a spot either side of `targetX`: the left one aims PAIR_DIVE_SPREAD (8) to the left, the
 * right one PAIR_DIVE_SPREAD to the right, so their curves mirror each other and they arrive as
 * a pair. Both dives start at modeTime 0 and take DIVE_SECONDS. The fold-in emits a `diveStart`
 * event for each diver.
 */
export function startPairedDive(left: Alien, right: Alien, targetX: number): void {
  startDive(left, targetX - PAIR_DIVE_SPREAD);
  startDive(right, targetX + PAIR_DIVE_SPREAD);
}

/**
 * What a killed Splitter breaks into: two minis in mode 'free' at the Splitter's position,
 * flying down and outward (the left one with negative vx, the right one positive). They have no
 * slot (col and row -1). `newId` hands out their ids. The fold-in, when it kills an alien of kind
 * 'splitter' (any cause: a shot, the laser, a bomb), emits `alienSplit` for it and pushes these
 * onto `run.aliens`. Minis then move with boss.ts's stepFreeAlien like launched Drones, and
 * crash into ships like divers.
 */
export function splitAlien(alien: Alien, newId: () => number): Alien[] {
  return [-1, 1].map((side) => {
    const mini = createAlien('mini', newId(), -1, -1, alien.x + side * MINI_OFFSET_X, alien.y);
    mini.mode = 'free';
    mini.vx = side * MINI_SPREAD_VX;
    mini.vy = MINI_LAUNCH_VY;
    return mini;
  });
}

/** Where a dive is after `u` of its way (0 to 1): a swing out and back while sweeping to the target. */
export function divePosition(path: DivePath, u: number): { x: number; y: number } {
  const smooth = u * u * (3 - 2 * u);
  const sway = DIVE_SWAY * Math.sin(2 * Math.PI * u) * (1 - u) * Math.sign(path.toX - path.fromX || 1);
  const drop = 0.5 * u + 0.5 * u * u;
  return {
    x: path.fromX + (path.toX - path.fromX) * smooth + sway,
    y: path.fromY + (DIVE_END_Y - path.fromY) * drop,
  };
}

/**
 * Advances one alien by a step. `slot` is where its formation slot is right now: an alien in
 * formation sits on it, and a returning diver flies towards it.
 */
export function stepAlien(alien: Alien, slot: { x: number; y: number }, dt: number): void {
  alien.flash = Math.max(0, alien.flash - dt);

  if (alien.mode === 'formation') {
    alien.x = slot.x;
    alien.y = slot.y;
    return;
  }

  alien.modeTime += dt;
  if (alien.mode === 'diving' && alien.dive) {
    const u = Math.min(1, alien.modeTime / DIVE_SECONDS);
    const pos = divePosition(alien.dive, u);
    alien.x = pos.x;
    alien.y = pos.y;
    if (u >= 1) {
      alien.mode = 'returning';
      alien.modeTime = 0;
      delete alien.dive;
    }
    return;
  }

  // Returning: fly straight at the slot, which keeps moving with the formation.
  const dx = slot.x - alien.x;
  const dy = slot.y - alien.y;
  const dist = Math.hypot(dx, dy);
  const reach = RETURN_SPEED * dt;
  if (dist <= reach) {
    alien.x = slot.x;
    alien.y = slot.y;
    alien.mode = 'formation';
    alien.modeTime = 0;
  } else {
    alien.x += (dx / dist) * reach;
    alien.y += (dy / dist) * reach;
  }
}
