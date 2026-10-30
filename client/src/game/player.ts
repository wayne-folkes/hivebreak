import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import type { Box, PlayerState, PlayerStats, ShipInput, Shot } from './types';

// The player's ship: steering with a little acceleration, touch drag played out over a few steps,
// the fire cooldown, and what a hit does (shield, lives, a moment of safety afterwards).

/** Where the ship sits, up from the bottom of the field. */
export const SHIP_Y = -FIELD_HEIGHT / 2 + 28;
/** Half sizes of the ship's hit box, art pixels. */
export const SHIP_HALF_WIDTH = 8;
export const SHIP_HALF_HEIGHT = 7;
/** The hit box's centre sits this far above SHIP_Y, so it covers the model's nose. */
export const SHIP_BOX_OFFSET_Y = 2;
/** The top of the ship's hit box; shots start here and the invasion line is measured from it. */
export const SHIP_TOP = SHIP_Y + SHIP_BOX_OFFSET_Y + SHIP_HALF_HEIGHT;
/** Gap kept between the ship's box and the side of the field. */
export const SHIP_MARGIN = 6;
/** The furthest the ship's centre can go from the middle of the field. */
export const SHIP_X_LIMIT = FIELD_WIDTH / 2 - SHIP_MARGIN - SHIP_HALF_WIDTH;

export const START_LIVES = 3;
/** Seconds of safety after losing a life. */
export const INVULNERABLE_SECONDS = 1.5;
/** Seconds of safety after a shield absorbs a hit, so one volley can't strip shield and life together. */
export const SHIELD_INVULNERABLE_SECONDS = 0.5;
/** Seconds the ship takes to reach top speed from a standstill. */
export const ACCEL_SECONDS = 0.1;
/** Touch drag plays out at up to this many times the ship's top speed. */
export const DRAG_SPEED_FACTOR = 2.5;
/** Distance between the shots of one volley, art pixels. */
export const VOLLEY_SPACING = 4;

export const BASE_STATS: Readonly<PlayerStats> = {
  speed: 110,
  fireInterval: 0.32,
  shotSpeed: 260,
  shotsPerVolley: 1,
  spreadAngle: 0,
  pierce: 0,
  damage: 1,
  homing: 0,
  ricochet: 0,
  shieldPerWave: 0,
  comboGuard: 0,
  magnetRadius: 0,
  bombOnKill: 0,
  overchargeEvery: 0,
  wingmen: 0,
  enemyShotSpeed: 1,
};

export function createPlayer(id: number, x = 0): PlayerState {
  return {
    id,
    x,
    vx: 0,
    pendingDrag: 0,
    lives: START_LIVES,
    cooldown: 0,
    invulnerable: 0,
    shield: 0,
    comboGuardLeft: 0,
    volleys: 0,
    stats: { ...BASE_STATS },
    upgrades: [],
    synergies: [],
    powerUps: [],
    special: null,
    specialCharge: 0,
    burst: 0,
  };
}

/** True while the player still has lives left. */
export function isAlive(player: PlayerState): boolean {
  return player.lives > 0;
}

export function shipBox(player: PlayerState): Box {
  return { x: player.x, y: SHIP_Y + SHIP_BOX_OFFSET_Y, halfWidth: SHIP_HALF_WIDTH, halfHeight: SHIP_HALF_HEIGHT };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Moves the ship and runs its timers for one step. A touch drag takes over from the keys or
 * stick while it's being played out, at up to DRAG_SPEED_FACTOR times top speed.
 */
export function stepPlayer(player: PlayerState, input: ShipInput, dt: number): void {
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  if (!isAlive(player)) {
    player.vx = 0;
    player.pendingDrag = 0;
    return;
  }

  player.pendingDrag += input.drag;
  const before = player.x;
  const dragging = player.pendingDrag !== 0;
  if (dragging) {
    const maxStep = DRAG_SPEED_FACTOR * player.stats.speed * dt;
    const step = clamp(player.pendingDrag, -maxStep, maxStep);
    player.pendingDrag -= step;
    player.x += step;
  } else {
    const target = clamp(input.move, -1, 1) * player.stats.speed;
    const maxChange = (player.stats.speed / ACCEL_SECONDS) * dt;
    player.vx += clamp(target - player.vx, -maxChange, maxChange);
    player.x += player.vx * dt;
  }

  const clamped = clamp(player.x, -SHIP_X_LIMIT, SHIP_X_LIMIT);
  const hitWall = clamped !== player.x;
  player.x = clamped;
  if (hitWall) {
    player.vx = 0;
    player.pendingDrag = 0;
  } else if (dragging) {
    // Report the real speed for banking, but don't let it carry on once the drag is done.
    player.vx = player.pendingDrag === 0 ? 0 : (player.x - before) / dt;
  }
}

/**
 * Fires a volley if fire is held and the cooldown allows, returning the new shots. `newId`
 * hands out ids for the volley (shared by its shots) and for each shot.
 */
export function tryFire(player: PlayerState, input: ShipInput, newId: () => number): Shot[] {
  if (!input.fire || !isAlive(player) || player.cooldown > 0) return [];
  player.cooldown = player.stats.fireInterval;
  const count = player.stats.shotsPerVolley;
  const volley = newId();
  const shots: Shot[] = [];
  for (let i = 0; i < count; i++) {
    shots.push({
      id: newId(),
      owner: 'player',
      kind: 'normal',
      playerId: player.id,
      x: player.x + (i - (count - 1) / 2) * VOLLEY_SPACING,
      y: SHIP_TOP,
      vx: 0,
      vy: player.stats.shotSpeed,
      pierceLeft: player.stats.pierce,
      damage: player.stats.damage,
      homing: player.stats.homing,
      bouncesLeft: player.stats.ricochet,
      hits: 0,
      volley,
    });
  }
  return shots;
}

/** What a hit did: nothing (safe moment or out of lives), used up a shield, or cost a life. */
export type HitResult = 'ignored' | 'shield' | 'life';

export function hitPlayer(player: PlayerState): HitResult {
  if (!isAlive(player) || player.invulnerable > 0) return 'ignored';
  if (player.shield > 0) {
    player.shield--;
    player.invulnerable = SHIELD_INVULNERABLE_SECONDS;
    return 'shield';
  }
  player.lives--;
  player.invulnerable = INVULNERABLE_SECONDS;
  return 'life';
}

/** The living player closest sideways to `x`, or null if everyone is out. */
export function nearestPlayer(players: readonly PlayerState[], x: number): PlayerState | null {
  let best: PlayerState | null = null;
  for (const p of players) {
    if (!isAlive(p)) continue;
    if (!best || Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  }
  return best;
}
