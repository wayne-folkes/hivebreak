import { damageAlien } from './aliens';
import { overlaps, shotBox } from './collision';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { SHIP_Y, isAlive, shipBox } from './player';
import { VOLLEY_HIT } from './scoring';
import type { Alien, PlayerState, RunEvent, RunState, Shot, SpecialId } from './types';

// The Special: one per run, chosen before wave 1. A meter fills from kills and boss parts; at
// full, the Special button fires it. Each Special is an entry in SPECIALS (what the choice card
// shows) and one in EFFECTS (what it does), so a fourth is a new SpecialId plus those two entries.

/** Every Special, in the order the choice card lists them. */
export const SPECIAL_IDS: readonly SpecialId[] = ['pulseBomb', 'shieldBurst', 'timeStop', 'missileSwarm', 'gravityWell'];

export const SPECIALS: Record<SpecialId, { name: string; description: string }> = {
  pulseBomb: {
    name: 'Pulse Bomb',
    description: 'A shockwave wipes every enemy shot, hits every alien and the boss, and stuns the swarm.',
  },
  shieldBurst: {
    name: 'Shield Burst',
    description: 'Three seconds untouchable, and every shot that hits you flies back at them.',
  },
  timeStop: {
    name: 'Time Stop',
    description: 'Aliens, the boss and their shots freeze for a couple of seconds while you keep firing.',
  },
  missileSwarm: {
    name: 'Missile Swarm',
    description: 'Eight homing missiles seek out the hive, two damage each.',
  },
  gravityWell: {
    name: 'Gravity Well',
    description: 'A vortex mid-field drags in enemy shots and loose aliens and grinds them up.',
  },
};

// Charging --------------------------------------------------------------------------------------

/** Meter gained per kill at combo x1. */
export const CHARGE_PER_KILL = 0.07;
/** Each combo step above x1 adds this fraction of a kill's charge. */
export const CHARGE_COMBO_BONUS = 0.15;
/** Meter gained when a boss part is destroyed. */
export const CHARGE_PER_BOSS_PART = 0.25;

/** The meter a kill gives at this combo: CHARGE_PER_KILL x (1 + CHARGE_COMBO_BONUS x (combo - 1)). */
export function killCharge(combo: number): number {
  return CHARGE_PER_KILL * (1 + CHARGE_COMBO_BONUS * (combo - 1));
}

export function specialReady(player: PlayerState): boolean {
  return player.special !== null && player.specialCharge >= 1;
}

/**
 * Adds `amount` to the ship's meter (use killCharge(run.combo) per kill and CHARGE_PER_BOSS_PART
 * per boss part). Nothing happens before a Special is chosen or while the meter is full. The
 * meter stops at 1, and the step that fills it returns a `specialReady` event, once.
 */
export function chargeSpecial(player: PlayerState, amount: number): RunEvent[] {
  if (player.special === null || player.specialCharge >= 1 || amount <= 0) return [];
  player.specialCharge += amount;
  // Close enough counts as full, so adding up kill after kill can't stop a hair short.
  if (player.specialCharge >= 1 - 1e-9) {
    player.specialCharge = 1;
    return [{ type: 'specialReady', playerId: player.id }];
  }
  return [];
}

// Effects ---------------------------------------------------------------------------------------

/** Damage a Pulse Bomb does to every alien. */
export const PULSE_ALIEN_DAMAGE = 2;
/** Fixed damage a Pulse Bomb does to a boss; the boss code applies it (see SpecialResult.bossDamage). */
export const PULSE_BOSS_DAMAGE = 12;
/** Seconds the formation and boss are stunned by a Pulse Bomb. */
export const PULSE_STUN_SECONDS = 1.2;
/** The blast ring's radius for the `blast` event: big enough to sweep the whole field from the ship. */
export const PULSE_RADIUS = Math.hypot(FIELD_WIDTH, FIELD_HEIGHT);
/** Seconds a Shield Burst lasts. */
export const BURST_SECONDS = 3;
/** Seconds Time Stop freezes the enemies. */
export const TIME_STOP_SECONDS = 2.5;
/** Speed and damage of a reflected shot. */
export const REFLECT_SPEED = 220;
export const REFLECT_DAMAGE = 2;

/** An alien a Pulse Bomb hit; `killed` aliens are at 0 hp and wait for the caller to award them and remove them. */
export interface PulseHit {
  alien: Alien;
  killed: boolean;
}

/** What firing a Special did beyond changing the run. */
export interface SpecialResult {
  /** `specialFired`, plus `blast` for a Pulse Bomb. Empty if the Special could not fire. */
  events: RunEvent[];
  /** Pulse Bomb: every alien it damaged, in the order of `run.aliens`. */
  hits: PulseHit[];
  /** Pulse Bomb: damage the boss takes (PULSE_BOSS_DAMAGE when a boss is up), for the boss code to apply. */
  bossDamage: number;
}

type Effect = (run: RunState, player: PlayerState, result: SpecialResult) => void;

const EFFECTS: Record<SpecialId, Effect> = {
  pulseBomb(run, player, result) {
    // Every enemy shot goes; every alien takes PULSE_ALIEN_DAMAGE, which the caller awards points for.
    run.shots = run.shots.filter((s) => s.owner !== 'alien');
    for (const alien of run.aliens) {
      if (alien.hp <= 0) continue;
      let killed = false;
      for (let i = 0; i < PULSE_ALIEN_DAMAGE && !killed; i++) killed = damageAlien(alien);
      result.hits.push({ alien, killed });
    }
    run.stun = Math.max(run.stun, PULSE_STUN_SECONDS);
    if (run.boss) {
      run.boss.stun = Math.max(run.boss.stun, PULSE_STUN_SECONDS);
      result.bossDamage = PULSE_BOSS_DAMAGE;
    }
    result.events.push({ type: 'blast', x: player.x, y: SHIP_Y, radius: PULSE_RADIUS });
  },
  shieldBurst(_run, player) {
    player.burst = BURST_SECONDS;
    player.invulnerable = Math.max(player.invulnerable, BURST_SECONDS);
  },
  timeStop(run) {
    run.freeze = Math.max(run.freeze, TIME_STOP_SECONDS);
  },
  // PLACEHOLDERS until the content worker writes them.
  missileSwarm() {},
  gravityWell() {},
};

/**
 * Fires the ship's Special if it can: the run is `playing`, the ship is alive, a Special is
 * chosen and the meter is full. Empties the meter and applies the effect to `run` and `player`.
 * See SpecialResult for what the caller finishes: for a Pulse Bomb, award points for the
 * `hits` that `killed` (scoring.awardKill and an `alienKilled` event each, `alienHit` events for
 * the rest), drop dead aliens from `run.aliens`, and apply `bossDamage` to the boss (boss.ts's
 * `damageBossFixed`). Those kills score and may drop pickups (rollDrop), but they do not charge
 * the meter and do not trigger bomb-on-kill bursts.
 */
export function fireSpecial(run: RunState, player: PlayerState): SpecialResult {
  const result: SpecialResult = { events: [], hits: [], bossDamage: 0 };
  if (run.phase !== 'playing' || !isAlive(player) || !specialReady(player) || player.special === null) return result;

  player.specialCharge = 0;
  result.events.push({ type: 'specialFired', playerId: player.id, special: player.special, x: player.x, y: SHIP_Y });
  EFFECTS[player.special](run, player, result);
  return result;
}

// Shield Burst ----------------------------------------------------------------------------------

export function isBursting(player: PlayerState): boolean {
  return player.burst > 0 && isAlive(player);
}

/** Counts the burst down. Call once per step for every ship; the ship's `invulnerable` runs out alongside it. */
export function tickBurst(player: PlayerState, dt: number): void {
  if (player.burst > 0) player.burst = Math.max(0, player.burst - dt);
}

/**
 * Turns an enemy shot into the ship's own: flies up (sideways speed mirrored), does
 * REFLECT_DAMAGE, and sits in the VOLLEY_HIT volley so a miss never breaks the combo.
 */
export function reflectShot(shot: Shot, playerId: number): void {
  shot.owner = 'player';
  shot.kind = 'reflected';
  shot.playerId = playerId;
  shot.vx = -shot.vx;
  shot.vy = REFLECT_SPEED;
  shot.damage = REFLECT_DAMAGE;
  shot.pierceLeft = 0;
  shot.homing = 0;
  shot.bouncesLeft = 0;
  shot.hits = 0;
  shot.volley = VOLLEY_HIT;
}

/**
 * Reflects every enemy shot touching a bursting ship's box and returns a `shotReflected` event
 * for each. Call it each step after enemy shots move and before they are tested against the
 * ships, so the burst takes the shot before a hit is counted.
 */
export function reflectShots(run: RunState): RunEvent[] {
  const events: RunEvent[] = [];
  const bursting = run.players.filter(isBursting);
  if (bursting.length === 0) return events;
  for (const shot of run.shots) {
    if (shot.owner !== 'alien') continue;
    const box = shotBox(shot);
    const ship = bursting.find((p) => overlaps(box, shipBox(p)));
    if (!ship) continue;
    events.push({ type: 'shotReflected', x: shot.x, y: shot.y });
    reflectShot(shot, ship.id);
  }
  return events;
}
