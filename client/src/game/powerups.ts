import { ALIEN_SPECS } from './aliens';
import { beamHitBoss } from './boss';
import { beamStopY } from './bunkers';
import { overlaps } from './collision';
import { FIELD_HEIGHT } from './playfield';
import { SHIP_BOX_OFFSET_Y, SHIP_TOP, SHIP_Y, isAlive, shipBox } from './player';
import type { Rng } from './rng';
import { VOLLEY_HIT } from './scoring';
import type { Alien, AlienKind, Beam, BossPart, BossState, Box, Bunker, Pickup, PlayerState, PowerUpKind, RunState, Shot } from './types';

// Power-ups: short, strong, timed boosts that fall as pickups. This file has the drop rules, the
// falling and catching of pickups, the timers, and what each power-up does (a spread fan, a laser
// beam, a helper drone, and the slow field), plus the run-wide time scale that freeze and slow use.
// All of it is pure functions over the state; run.ts calls them from its step.

export const POWER_UP_KINDS: readonly PowerUpKind[] = ['spread', 'laser', 'slow', 'helper'];

/** Seconds each power-up runs after being caught; catching another of the same kind resets the clock. */
export const POWER_UP_SECONDS: Record<PowerUpKind, number> = { spread: 9, laser: 8, slow: 8, helper: 10 };

/** Names for the HUD timer and the pickup toast. */
export const POWER_UP_NAMES: Record<PowerUpKind, string> = {
  spread: 'Spread shot',
  laser: 'Laser',
  slow: 'Time slow',
  helper: 'Helper drone',
};

/** Chance any kill other than a Carrier's drops a power-up. */
export const KILL_DROP_CHANCE = 0.03;

/** Pickups fall at this speed, art pixels per second. */
export const PICKUP_FALL_SPEED = 40;
/** A pickup inside a ship's magnet radius flies to the ship at this speed instead of falling. */
export const PICKUP_MAGNET_SPEED = 110;
/** Half the side of a pickup's square hit box, art pixels. */
export const PICKUP_HALF_SIZE = 5;

/**
 * What a destroyed alien drops: a Carrier always drops a random power-up, any other kind drops
 * one with a KILL_DROP_CHANCE chance, otherwise null. Call once per kill (a kill that is not a
 * crash into the ship) with `run.rng`.
 */
export function rollDrop(kind: AlienKind, rng: Rng): PowerUpKind | null {
  if (kind === 'carrier') return rng.pick(POWER_UP_KINDS);
  if (rng.next() < KILL_DROP_CHANCE) return rng.pick(POWER_UP_KINDS);
  return null;
}

/** A pickup of `kind` at (x, y); `id` comes from run.nextId. The caller pushes it onto run.pickups. */
export function spawnPickup(kind: PowerUpKind, x: number, y: number, id: number): Pickup {
  return { id, kind, x, y };
}

export function pickupBox(pickup: Pickup): Box {
  return { x: pickup.x, y: pickup.y, halfWidth: PICKUP_HALF_SIZE, halfHeight: PICKUP_HALF_SIZE };
}

const NO_CATCHES: readonly { playerId: number; pickup: Pickup }[] = [];

/**
 * Moves every pickup for one step: it falls, or if a living ship's magnet radius reaches it
 * (the nearest such ship, measured to the ship's box centre) it flies to that ship instead. A
 * pickup touching a living ship's box is caught by the first such ship; one that has fallen
 * off the bottom is dropped. Moves the pickups in place and returns the ones still in play and
 * the catches (for activatePowerUp, applyRunEffect and a `pickupCollected` event). With no
 * pickups it returns the same array and does no work.
 */
export function stepPickups(
  pickups: Pickup[],
  players: readonly PlayerState[],
  dt: number,
): { kept: Pickup[]; collected: readonly { playerId: number; pickup: Pickup }[] } {
  if (pickups.length === 0) return { kept: pickups, collected: NO_CATCHES };
  const kept: Pickup[] = [];
  const collected: { playerId: number; pickup: Pickup }[] = [];
  const living = players.filter(isAlive);

  for (const pickup of pickups) {
    let pull: { x: number; y: number; dist: number } | null = null;
    for (const p of living) {
      const radius = p.stats.magnetRadius;
      if (radius <= 0) continue;
      const dx = p.x - pickup.x;
      const dy = SHIP_Y + SHIP_BOX_OFFSET_Y - pickup.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= radius && (!pull || dist < pull.dist)) pull = { x: p.x, y: SHIP_Y + SHIP_BOX_OFFSET_Y, dist };
    }

    if (pull) {
      const reach = PICKUP_MAGNET_SPEED * dt;
      if (pull.dist <= reach) {
        pickup.x = pull.x;
        pickup.y = pull.y;
      } else {
        pickup.x += ((pull.x - pickup.x) / pull.dist) * reach;
        pickup.y += ((pull.y - pickup.y) / pull.dist) * reach;
      }
    } else {
      pickup.y -= PICKUP_FALL_SPEED * dt;
    }

    const box = pickupBox(pickup);
    const catcher = living.find((p) => overlaps(box, shipBox(p)));
    if (catcher) {
      collected.push({ playerId: catcher.id, pickup });
    } else if (pickup.y + PICKUP_HALF_SIZE >= -FIELD_HEIGHT / 2) {
      kept.push(pickup);
    }
  }
  return { kept, collected };
}

export function hasPowerUp(player: PlayerState, kind: PowerUpKind): boolean {
  return player.powerUps.some((u) => u.kind === kind);
}

/** Starts the power-up on the ship, or resets its clock if it's already running (one of each kind). */
export function activatePowerUp(player: PlayerState, kind: PowerUpKind): void {
  const seconds = POWER_UP_SECONDS[kind];
  const running = player.powerUps.find((u) => u.kind === kind);
  if (running) running.timeLeft = seconds;
  else player.powerUps.push({ kind, timeLeft: seconds });
}

/**
 * The part of a power-up that belongs to the whole run rather than one ship: 'slow' sets
 * `run.slow`. Call it right after activatePowerUp, for the same kind. Other kinds do nothing here.
 * (The player's own 'slow' entry is only the HUD timer; run.slow, counted down by
 * tickRunEffects, is what slows the enemies.)
 */
export function applyRunEffect(run: RunState, kind: PowerUpKind): void {
  if (kind === 'slow') run.slow = POWER_UP_SECONDS.slow;
}

/** Counts the ship's power-ups down and removes the finished ones, returning their kinds (for `powerUpEnded` events). */
export function tickPowerUps(player: PlayerState, dt: number): PowerUpKind[] {
  const ended: PowerUpKind[] = [];
  for (const u of player.powerUps) {
    u.timeLeft -= dt;
    if (u.timeLeft <= 0) ended.push(u.kind);
  }
  if (ended.length > 0) player.powerUps = player.powerUps.filter((u) => u.timeLeft > 0);
  return ended;
}

// Spread ----------------------------------------------------------------------------------------

/** Angles of the fan, radians from straight up: four shots at +-0.175 and +-0.35. The normal volley is the fifth way. */
export const SPREAD_ANGLES: readonly number[] = [-0.35, -0.175, 0.175, 0.35];

/**
 * Extra shots for the spread power-up: four shots fanned out from the nose, which with the
 * normal volley's straight shot make a 5-way fan. Call it each time `tryFire` returns a volley and the ship has no laser running, passing
 * that volley's id (`shots[0].volley`) so the fan and the volley count as one for misses. They
 * take the ship's damage, piercing, homing and ricochet. Returns [] if 'spread' isn't running.
 */
export function spreadVolley(player: PlayerState, newId: () => number, volley: number): Shot[] {
  if (!hasPowerUp(player, 'spread')) return [];
  const { shotSpeed, pierce, damage, homing, ricochet } = player.stats;
  return SPREAD_ANGLES.map((angle) => ({
    id: newId(),
    owner: 'player' as const,
    kind: 'normal' as const,
    playerId: player.id,
    x: player.x,
    y: SHIP_TOP,
    vx: Math.sin(angle) * shotSpeed,
    vy: Math.cos(angle) * shotSpeed,
    pierceLeft: pierce,
    damage,
    homing,
    bouncesLeft: ricochet,
    hits: 0,
    volley,
  }));
}

// Laser -----------------------------------------------------------------------------------------

/** Half the beam's width for hit tests, art pixels. */
export const BEAM_HALF_WIDTH = 2;
/**
 * Damage per second the beam does to what it touches. It lands as whole hits on a timer, one
 * every LASER_TICK_SECONDS (each worth the ship's `stats.damage`), so hit points stay whole
 * numbers: at 6 a second a Drone dies in a sixth of a second and a Carrier in two thirds.
 */
export const LASER_DPS = 6;
export const LASER_TICK_SECONDS = 1 / LASER_DPS;

/** What a beam stopped at: an alien (by id), or a boss part (`blocked` when the shielded core stopped it, so it does no damage). */
export interface BeamTarget {
  alienId?: number;
  part?: BossPart;
  blocked?: boolean;
}

/**
 * The beam while the laser runs and fire is held: straight up from the nose to the first alien,
 * boss part or solid bunker pixel it touches (the lowest bottom edge above the nose, using
 * boss.ts's beamHitBoss for the boss and bunkers.ts's beamStopY for bunkers), or the top of the
 * field. A null target means it hit no alien or boss part. A bunker lower than or level with
 * them stops the beam first: the target is then null and `bunkerY` is the y it stopped at
 * (otherwise `bunkerY` is null). Push `beam` onto `run.beams` every step it fires and use
 * laserDamage to apply hits to the target; on a step laserDamage returns damage and `bunkerY`
 * is set, burn the bunker with `erodeColumn(bunkers, beam.x, bunkerY, BEAM_HALF_WIDTH * 2)` so it
 * erodes on damage ticks only, not every step.
 *
 * The laser replaces the ship's own shots, including lance and overcharge: while it fires, skip
 * the main volley of `tryFire`. Wingmen and the helper drone keep firing, so still fire the
 * wingman shots (player.ts's `wingmanXs`) and call helperShots.
 */
export function computeBeam(
  player: PlayerState,
  aliens: readonly Alien[],
  boss: BossState | null,
  bunkers: readonly Bunker[],
): { beam: Beam; target: BeamTarget | null; bunkerY: number | null } {
  let bottom = FIELD_HEIGHT / 2;
  let hit: Alien | null = null;
  for (const a of aliens) {
    if (a.hp <= 0) continue;
    const spec = ALIEN_SPECS[a.kind];
    if (Math.abs(a.x - player.x) >= spec.halfWidth + BEAM_HALF_WIDTH) continue;
    if (a.y + spec.halfHeight <= SHIP_TOP) continue; // wholly below the nose
    const low = Math.max(SHIP_TOP, a.y - spec.halfHeight);
    if (low < bottom || (hit !== null && low === bottom && a.id < hit.id)) {
      bottom = low;
      hit = a;
    }
  }

  let target: BeamTarget | null = hit ? { alienId: hit.id } : null;
  const onBoss = boss ? beamHitBoss(boss, player.x, SHIP_TOP) : null;
  if (onBoss && onBoss.y < bottom) {
    bottom = onBoss.y;
    target = { part: onBoss.part, blocked: onBoss.blocked };
  }

  const wall = bunkers.length > 0 ? beamStopY(bunkers, player.x, SHIP_TOP, 'up') : null;
  if (wall !== null && wall <= bottom) {
    return { beam: { playerId: player.id, x: player.x, topY: wall }, target: null, bunkerY: wall };
  }
  return { beam: { playerId: player.id, x: player.x, topY: bottom }, target, bunkerY: null };
}

/** Counts the laser's tick timer down. Call once per step for every ship (the laser's timer is `laserTimer`, apart from `cooldown`). */
export function tickLaser(player: PlayerState, dt: number): void {
  if (player.laserTimer > 0) player.laserTimer = Math.max(0, player.laserTimer - dt);
}

/**
 * How much damage the beam does this step: 0, or `stats.damage` once every LASER_TICK_SECONDS.
 * Call it only on a step the beam has a target (and the target isn't a `blocked` core), after
 * tickLaser. Apply each point of the result with `damageAlien`, or as that much damage to the
 * boss part. Because the timer only restarts on a hit, a beam sweeping onto a new target hurts
 * it at once if a tick is due.
 */
export function laserDamage(player: PlayerState): number {
  if (player.laserTimer > 0) return 0;
  player.laserTimer = LASER_TICK_SECONDS;
  return Math.max(1, Math.round(player.stats.damage));
}

// Helper drone ----------------------------------------------------------------------------------

/** Seconds between the helper drone's shots. */
export const HELPER_FIRE_INTERVAL = 0.4;
/** The helper's orbit round the ship: half-widths of the ellipse, art pixels, and radians per second. */
export const HELPER_ORBIT_X = 16;
export const HELPER_ORBIT_Y = 5;
export const HELPER_ORBIT_SPEED = 2.2;

/**
 * Where the helper drone is: it circles the ship, a pure function of the ship's x and a clock
 * (`time` is `run.time`, the clock that never resets), so the renderer draws it exactly where
 * the sim fires from.
 */
export function helperPosition(player: PlayerState, time: number): { x: number; y: number } {
  const angle = time * HELPER_ORBIT_SPEED;
  return {
    x: player.x + Math.cos(angle) * HELPER_ORBIT_X,
    y: SHIP_Y + 4 + Math.sin(angle) * HELPER_ORBIT_Y,
  };
}

/**
 * The helper's shots for a step: while 'helper' runs on a living ship it fires one straight up
 * shot from its position each time `run.time` crosses a multiple of HELPER_FIRE_INTERVAL during
 * the step. Pass `run.time` as it stands after this step's increment and the step's `dt`; each
 * step checks only the span (time - dt, time], so a boundary falls in exactly one step, and the
 * first step after a phase change (when run.time just keeps going) cannot add an extra shot. Its shots do one damage and sit in the
 * VOLLEY_HIT volley, so a miss never breaks the combo.
 */
export function helperShots(player: PlayerState, time: number, dt: number, newId: () => number): Shot[] {
  if (dt <= 0 || !hasPowerUp(player, 'helper') || !isAlive(player)) return [];
  if (Math.floor(time / HELPER_FIRE_INTERVAL) <= Math.floor((time - dt) / HELPER_FIRE_INTERVAL)) return [];
  const pos = helperPosition(player, time);
  return [
    {
      id: newId(),
      owner: 'player',
      kind: 'normal',
      playerId: player.id,
      x: pos.x,
      y: pos.y + 4,
      vx: 0,
      vy: player.stats.shotSpeed,
      pierceLeft: 0,
      damage: 1,
      homing: 0,
      bouncesLeft: 0,
      hits: 0,
      volley: VOLLEY_HIT,
    },
  ];
}

// Run-wide effects ------------------------------------------------------------------------------

/**
 * How fast the enemies' clocks run: 0 while Time Stop's freeze lasts, half speed while the slow
 * power-up lasts, otherwise 1. Multiply the alien, boss and enemy-shot `dt` by it (and fire
 * rolls, which are rates per second). A Pulse Bomb's `run.stun` is separate: while it's above 0
 * the formation and boss neither move nor fire.
 */
export function enemyTimeScale(run: RunState): number {
  if (run.freeze > 0) return 0;
  if (run.slow > 0) return 0.5;
  return 1;
}

/** Counts down the run's freeze, slow and stun clocks by real (unscaled) time. */
export function tickRunEffects(run: RunState, dt: number): void {
  run.freeze = Math.max(0, run.freeze - dt);
  run.slow = Math.max(0, run.slow - dt);
  run.stun = Math.max(0, run.stun - dt);
}
