import type { PlayerStats, ShipDef, ShipId } from './types';

// The ships. Each is a starting point (lives and stats) that upgrades build on; every ship but
// the Breaker trades one strength for a weakness (the draft table is in docs/plan-slice-3.md).

export const START_LIVES = 3;

/** The Breaker's stats: every ship's starting point. */
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
  chain: 0,
  powerUpTime: 1,
  dropRate: 1,
  chargeRate: 1,
  lastStand: 1,
};

/** Every ship, in the order the ship card lists them. */
export const SHIP_IDS: readonly ShipId[] = ['breaker', 'interceptor', 'lancer', 'bastion'];

/** Interceptor: top speed and fire interval factors, and its lives. */
export const INTERCEPTOR_SPEED_FACTOR = 1.35;
export const INTERCEPTOR_INTERVAL_FACTOR = 0.85;
export const INTERCEPTOR_LIVES = 2;
/** Lancer: shots per volley, pierce, and the fire interval factor (slower). */
export const LANCER_SHOTS = 2;
export const LANCER_PIERCE = 1;
export const LANCER_INTERVAL_FACTOR = 1.35;
/** Bastion: a free shield each wave, and the speed factor (slower). */
export const BASTION_SHIELD = 1;
export const BASTION_SPEED_FACTOR = 0.85;

export const SHIPS: Record<ShipId, ShipDef> = {
  breaker: { id: 'breaker', name: 'Breaker', description: 'Balanced. Three lives.', lives: START_LIVES, stats: BASE_STATS },
  interceptor: {
    id: 'interceptor',
    name: 'Interceptor',
    description: 'Faster to move and to fire, but only two lives.',
    lives: INTERCEPTOR_LIVES,
    stats: {
      ...BASE_STATS,
      speed: BASE_STATS.speed * INTERCEPTOR_SPEED_FACTOR,
      fireInterval: BASE_STATS.fireInterval * INTERCEPTOR_INTERVAL_FACTOR,
    },
  },
  lancer: {
    id: 'lancer',
    name: 'Lancer',
    description: 'Twin shots that pierce an alien, but it fires slowly.',
    lives: START_LIVES,
    stats: {
      ...BASE_STATS,
      shotsPerVolley: LANCER_SHOTS,
      spreadAngle: 0,
      pierce: LANCER_PIERCE,
      fireInterval: BASE_STATS.fireInterval * LANCER_INTERVAL_FACTOR,
    },
  },
  bastion: {
    id: 'bastion',
    name: 'Bastion',
    description: 'A free shield every wave, but slower to move.',
    lives: START_LIVES,
    stats: { ...BASE_STATS, shieldPerWave: BASTION_SHIELD, speed: BASE_STATS.speed * BASTION_SPEED_FACTOR },
  },
};

export function shipDef(id: ShipId): ShipDef {
  return SHIPS[id];
}
