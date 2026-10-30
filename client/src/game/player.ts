import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import {
  AFTERBURNER_INTERVAL_FACTOR,
  AFTERBURNER_SPEED_FRACTION,
  BULWARK_REGEN_SECONDS,
  LANCE_DAMAGE,
  LANCE_PIERCE,
  hasSynergy,
} from './synergies';
import { shipDef } from './ships';
import { VOLLEY_HIT, type Box, type PlayerState, type ShipId, type ShipInput, type Shot } from './types';

// The Breaker's numbers and lives live with the other ships, in ships.ts.
export { BASE_STATS, START_LIVES } from './ships';

// The player's ship: steering with a little acceleration, touch drag played out over a few steps,
// the fire cooldown and the volley it builds (fan, overcharge, lance, wingmen), and what a hit
// does (shield, lives, a moment of safety afterwards).

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

/** How far a wingman flies to the side of the ship, art pixels; more wingmen stack outward. */
export const WINGMAN_OFFSET_X = 16;
/** Wingmen stay this far inside the side walls. */
export const WINGMAN_WALL_MARGIN = 4;
/** The overcharge shot: base damage and extra pierce (on top of the ship's own). */
export const OVERCHARGE_DAMAGE = 3;
export const OVERCHARGE_PIERCE = 2;


/** A ship at the start of a run: the ship's lives and starting stats. */
export function createPlayer(id: number, x = 0, ship: ShipId = 'breaker'): PlayerState {
  const def = shipDef(ship);
  return {
    id,
    ship,
    x,
    vx: 0,
    pendingDrag: 0,
    lives: def.lives,
    cooldown: 0,
    invulnerable: 0,
    shield: 0,
    comboGuardLeft: 0,
    volleys: 0,
    stats: { ...def.stats },
    upgrades: [],
    synergies: [],
    powerUps: [],
    special: null,
    specialCharge: 0,
    burst: 0,
    laserTimer: 0,
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
  if (player.shieldRegen && player.shieldRegen > 0) {
    player.shieldRegen = Math.max(0, player.shieldRegen - dt);
    if (player.shieldRegen === 0 && player.shield < player.stats.shieldPerWave) player.shield++;
  }
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

/** Seconds between volleys right now: the Afterburner synergy shortens it while the ship is moving fast. */
export function currentFireInterval(player: PlayerState): number {
  const fast = Math.abs(player.vx) > AFTERBURNER_SPEED_FRACTION * player.stats.speed;
  const boost = fast && hasSynergy(player, 'afterburner') ? AFTERBURNER_INTERVAL_FACTOR : 1;
  return player.stats.fireInterval * boost;
}

/** Sideways places of the ship's wingmen: first on the right, then the left, then further out. */
export function wingmanXs(player: PlayerState): number[] {
  const limit = FIELD_WIDTH / 2 - WINGMAN_WALL_MARGIN;
  return Array.from({ length: player.stats.wingmen }, (_, i) => {
    const side = i % 2 === 0 ? 1 : -1;
    const x = player.x + side * (Math.floor(i / 2) + 1) * WINGMAN_OFFSET_X;
    return clamp(x, -limit, limit);
  });
}

/**
 * Fires a volley if fire is held and the cooldown allows, returning the new shots. `newId`
 * hands out ids for the volley (shared by its shots) and for each shot. A volley is the ship's
 * fan of shots (spread out by `spreadAngle`), plus an overcharge shot on every Nth volley, a
 * lance bolt with the Lance synergy, and one straight shot from each wingman. The extras (overcharge,
 * lance, wingmen) are in the VOLLEY_HIT volley, so they never count as a miss; only the fan can.
 */
export function tryFire(player: PlayerState, input: ShipInput, newId: () => number): Shot[] {
  if (!input.fire || !isAlive(player) || player.cooldown > 0) return [];
  const stats = player.stats;
  player.cooldown = currentFireInterval(player);
  player.volleys++;
  const volley = newId();
  const shots: Shot[] = [];
  const make = (kind: Shot['kind'], x: number, vx: number, vy: number, over: Partial<Shot> = {}): Shot => ({
    id: newId(),
    owner: 'player',
    kind,
    playerId: player.id,
    x,
    y: SHIP_TOP,
    vx,
    vy,
    pierceLeft: stats.pierce,
    damage: stats.damage,
    homing: stats.homing,
    bouncesLeft: stats.ricochet,
    hits: 0,
    volley,
    ...over,
  });

  const count = stats.shotsPerVolley;
  for (let i = 0; i < count; i++) {
    const angle = (i - (count - 1) / 2) * stats.spreadAngle;
    const x = player.x + (i - (count - 1) / 2) * VOLLEY_SPACING;
    shots.push(make('normal', x, Math.sin(angle) * stats.shotSpeed, Math.cos(angle) * stats.shotSpeed));
  }
  if (stats.overchargeEvery > 0 && player.volleys % stats.overchargeEvery === 0) {
    shots.push(
      make('overcharge', player.x, 0, stats.shotSpeed, {
        damage: OVERCHARGE_DAMAGE + stats.damage - 1,
        pierceLeft: OVERCHARGE_PIERCE + stats.pierce,
        homing: 0,
        bouncesLeft: 0,
        volley: VOLLEY_HIT,
      }),
    );
  }
  if (hasSynergy(player, 'lance')) {
    shots.push(
      make('lance', player.x, 0, stats.shotSpeed, {
        damage: LANCE_DAMAGE + stats.damage - 1,
        pierceLeft: LANCE_PIERCE,
        homing: 0,
        bouncesLeft: 0,
        volley: VOLLEY_HIT,
      }),
    );
  }
  shots.push(...wingmanShots(player, newId));
  return shots;
}

/**
 * One straight shot from each wingman, all in the VOLLEY_HIT volley so they never count as a
 * miss. `tryFire` adds these to every volley; the run calls it alone while the laser replaces
 * the ship's own shots (it does not touch the cooldown or the volley count).
 */
export function wingmanShots(player: PlayerState, newId: () => number): Shot[] {
  const stats = player.stats;
  return wingmanXs(player).map((x) => ({
    id: newId(),
    owner: 'player' as const,
    kind: 'normal' as const,
    playerId: player.id,
    x,
    y: SHIP_TOP,
    vx: 0,
    vy: stats.shotSpeed,
    pierceLeft: stats.pierce,
    damage: stats.damage,
    homing: stats.homing,
    bouncesLeft: stats.ricochet,
    hits: 0,
    volley: VOLLEY_HIT,
  }));
}

/** What a hit did: nothing (safe moment or out of lives), used up a shield, or cost a life. */
export type HitResult = 'ignored' | 'shield' | 'life';

export function hitPlayer(player: PlayerState): HitResult {
  if (!isAlive(player) || player.invulnerable > 0) return 'ignored';
  if (player.shield > 0) {
    player.shield--;
    player.invulnerable = SHIELD_INVULNERABLE_SECONDS;
    // Bulwark: the first shield used each wave grows back after a while.
    if (hasSynergy(player, 'bulwark') && !player.bulwarkUsed) {
      player.bulwarkUsed = true;
      player.shieldRegen = BULWARK_REGEN_SECONDS;
    }
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
