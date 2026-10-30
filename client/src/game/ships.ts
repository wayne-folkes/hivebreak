import type { PlayerStats, ShipDef, ShipId } from './types';

// The ships. PLACEHOLDER: every ship flies like the Breaker until the content worker gives each
// its trade-off (the draft is in docs/plan-slice-3.md).

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

export const SHIPS: Record<ShipId, ShipDef> = {
  breaker: { id: 'breaker', name: 'Breaker', description: 'Balanced. Three lives.', lives: START_LIVES, stats: BASE_STATS },
  interceptor: { id: 'interceptor', name: 'Interceptor', description: 'Placeholder.', lives: START_LIVES, stats: BASE_STATS },
  lancer: { id: 'lancer', name: 'Lancer', description: 'Placeholder.', lives: START_LIVES, stats: BASE_STATS },
  bastion: { id: 'bastion', name: 'Bastion', description: 'Placeholder.', lives: START_LIVES, stats: BASE_STATS },
};

export function shipDef(id: ShipId): ShipDef {
  return SHIPS[id];
}
