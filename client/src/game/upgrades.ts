import type { Rng } from './rng';
import type { PlayerState, UpgradeDef, UpgradeId } from './types';

// The upgrade pool. Each upgrade changes a ship's stats (or lives) when picked, can be taken a
// limited number of times, and is offered at random, common ones more often than uncommon.

export const UPGRADES: readonly UpgradeDef[] = [
  { id: 'twinShot', name: 'Twin shot', description: 'Fire two shots side by side.', rarity: 'common', maxStacks: 2 },
  { id: 'rapidFire', name: 'Rapid fire', description: 'Shoot 25% faster.', rarity: 'common', maxStacks: 3 },
  { id: 'extraLife', name: 'Extra life', description: 'Gain one more life.', rarity: 'common', maxStacks: 3 },
  { id: 'piercing', name: 'Piercing shots', description: 'Shots pass through one more alien.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'shieldPulse', name: 'Shield pulse', description: 'A shield absorbs one more hit each wave.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'thrusters', name: 'Thrusters', description: 'Move 20% faster.', rarity: 'uncommon', maxStacks: 2 },
];

/** How likely each rarity is to be offered, relative to the others. */
export const RARITY_WEIGHT = { common: 3, uncommon: 2, rare: 1 } as const;

export function upgradeDef(id: UpgradeId): UpgradeDef {
  const def = UPGRADES.find((u) => u.id === id);
  if (!def) throw new Error(`Unknown upgrade '${id}'`);
  return def;
}

/** How many times this player has taken an upgrade. */
export function stackCount(player: PlayerState, id: UpgradeId): number {
  return player.upgrades.filter((u) => u === id).length;
}

/** Applies an upgrade to a ship. Returns false (and changes nothing) if it's already at its limit. */
export function applyUpgrade(player: PlayerState, id: UpgradeId): boolean {
  if (stackCount(player, id) >= upgradeDef(id).maxStacks) return false;
  const stats = player.stats;
  switch (id) {
    case 'twinShot':
      stats.shotsPerVolley += 1;
      break;
    case 'rapidFire':
      stats.fireInterval *= 0.75;
      break;
    case 'piercing':
      stats.pierce += 1;
      break;
    case 'extraLife':
      player.lives += 1;
      break;
    case 'shieldPulse':
      stats.shieldPerWave += 1;
      break;
    case 'thrusters':
      stats.speed *= 1.2;
      break;
  }
  player.upgrades.push(id);
  return true;
}

/**
 * Picks up to `count` different upgrades the player can still take, at random, weighted by
 * rarity. Offers fewer if fewer are eligible.
 */
export function offerUpgrades(rng: Rng, player: PlayerState, count = 3): UpgradeId[] {
  const pool = UPGRADES.filter((u) => stackCount(player, u.id) < u.maxStacks);
  const offer: UpgradeId[] = [];
  while (offer.length < count && pool.length > 0) {
    const total = pool.reduce((sum, u) => sum + RARITY_WEIGHT[u.rarity], 0);
    let roll = rng.next() * total;
    let index = pool.findIndex((u) => (roll -= RARITY_WEIGHT[u.rarity]) < 0);
    if (index < 0) index = pool.length - 1;
    offer.push(pool[index].id);
    pool.splice(index, 1);
  }
  return offer;
}
