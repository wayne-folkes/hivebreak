import type { Rng } from './rng';
import type { PlayerState, UpgradeDef, UpgradeId } from './types';

// The upgrade pool. Each upgrade changes a ship's stats (or lives) when picked, can be taken a
// limited number of times, and is offered at random: common ones most often, rares only rarely.
// Pairs of upgrades unlock synergies (see synergies.ts).

export const UPGRADES: readonly UpgradeDef[] = [
  // Common.
  { id: 'twinShot', name: 'Twin shot', description: 'Fire an extra shot, fanned out to the sides.', rarity: 'common', maxStacks: 2 },
  { id: 'rapidFire', name: 'Rapid fire', description: 'Shoot over 50% faster.', rarity: 'common', maxStacks: 3 },
  { id: 'extraLife', name: 'Extra life', description: 'Gain one more life.', rarity: 'common', maxStacks: 3 },
  { id: 'comboGuard', name: 'Combo guard', description: 'Each wave, forgive one miss before it breaks your combo.', rarity: 'common', maxStacks: 2 },
  { id: 'magnet', name: 'Magnet', description: 'Power-ups drift toward you from farther away.', rarity: 'common', maxStacks: 2 },
  { id: 'scavenger', name: 'Scavenger', description: 'Power-ups last 50% longer and drop 50% more often.', rarity: 'common', maxStacks: 1 },
  // Uncommon.
  { id: 'piercing', name: 'Piercing shots', description: 'Shots pass through one more alien.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'shieldPulse', name: 'Shield pulse', description: 'A shield absorbs one more hit each wave.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'thrusters', name: 'Thrusters', description: 'Move 30% faster.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'homing', name: 'Homing', description: 'Shots curve toward the nearest alien above them.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'ricochet', name: 'Ricochet', description: 'Shots bounce off the side walls once more.', rarity: 'uncommon', maxStacks: 2 },
  { id: 'bombOnKill', name: 'Bomb on kill', description: 'Kills have a 15% chance to burst and hurt nearby aliens.', rarity: 'uncommon', maxStacks: 3 },
  { id: 'overcharge', name: 'Overcharge', description: 'Every 5th volley adds a big piercing shot (every 4th with a second copy).', rarity: 'uncommon', maxStacks: 2 },
  { id: 'chainSpark', name: 'Chain spark', description: 'A hit arcs to a nearby alien for 1 damage (a second copy arcs to another).', rarity: 'uncommon', maxStacks: 2 },
  { id: 'overclock', name: 'Overclock', description: 'Your Special meter charges 30% faster.', rarity: 'uncommon', maxStacks: 2 },
  // Rare.
  { id: 'wingman', name: 'Wingman', description: 'A wingman drone flies beside you and fires with you.', rarity: 'rare', maxStacks: 1 },
  { id: 'slowField', name: 'Slow field', description: 'Enemy shots fly 25% slower.', rarity: 'rare', maxStacks: 1 },
  { id: 'doubleTap', name: 'Double tap', description: 'Your shots do one more damage.', rarity: 'rare', maxStacks: 1 },
  { id: 'lastStand', name: 'Last stand', description: 'On your last life, shoot 30% faster.', rarity: 'rare', maxStacks: 1 },
];

/** Numbers the upgrades use, collected here for tuning. */
export const TWIN_SHOT_SPREAD = 0.12;
export const RAPID_FIRE_FACTOR = 0.65;
export const COMBO_GUARD_PER_STACK = 1;
export const MAGNET_RADIUS_PER_STACK = 40;
export const THRUSTERS_FACTOR = 1.3;
export const HOMING_PER_STACK = 2.5;
export const BOMB_CHANCE_PER_STACK = 0.15;
/** Overcharge fires every Nth volley: the first copy 5, the second 4. */
export const OVERCHARGE_FIRST = 5;
export const OVERCHARGE_SECOND = 4;
export const SLOW_FIELD_FACTOR = 0.75;
/** Chain Spark: how far a spark reaches from the alien it hit, art pixels, and the damage it does. */
export const CHAIN_RANGE = 40;
export const CHAIN_DAMAGE = 1;
/** Scavenger: multipliers on power-up duration and on the chance a kill drops one. */
export const SCAVENGER_TIME_FACTOR = 1.5;
export const SCAVENGER_DROP_FACTOR = 1.5;
/** Overclock: multiplier on Special meter gains, per copy. */
export const OVERCLOCK_FACTOR = 1.3;
/** Last Stand: multiplier on the fire interval while on the last life. */
export const LAST_STAND_FACTOR = 0.7;

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
  const owned = stackCount(player, id);
  if (owned >= upgradeDef(id).maxStacks) return false;
  const stats = player.stats;
  switch (id) {
    case 'twinShot':
      stats.shotsPerVolley += 1;
      stats.spreadAngle = TWIN_SHOT_SPREAD;
      break;
    case 'rapidFire':
      stats.fireInterval *= RAPID_FIRE_FACTOR;
      break;
    case 'extraLife':
      player.lives += 1;
      break;
    case 'comboGuard':
      stats.comboGuard += COMBO_GUARD_PER_STACK;
      break;
    case 'magnet':
      stats.magnetRadius += MAGNET_RADIUS_PER_STACK;
      break;
    case 'piercing':
      stats.pierce += 1;
      break;
    case 'shieldPulse':
      stats.shieldPerWave += 1;
      break;
    case 'thrusters':
      stats.speed *= THRUSTERS_FACTOR;
      break;
    case 'homing':
      stats.homing += HOMING_PER_STACK;
      break;
    case 'ricochet':
      stats.ricochet += 1;
      break;
    case 'bombOnKill':
      stats.bombOnKill = Math.min(1, stats.bombOnKill + BOMB_CHANCE_PER_STACK);
      break;
    case 'overcharge':
      stats.overchargeEvery = owned === 0 ? OVERCHARGE_FIRST : OVERCHARGE_SECOND;
      break;
    case 'wingman':
      stats.wingmen += 1;
      break;
    case 'slowField':
      stats.enemyShotSpeed *= SLOW_FIELD_FACTOR;
      break;
    case 'doubleTap':
      stats.damage += 1;
      break;
    case 'chainSpark':
      // The arcs themselves are made by the run (see chainSparks in run.ts).
      stats.chain += 1;
      break;
    case 'scavenger':
      stats.powerUpTime *= SCAVENGER_TIME_FACTOR;
      stats.dropRate *= SCAVENGER_DROP_FACTOR;
      break;
    case 'overclock':
      stats.chargeRate *= OVERCLOCK_FACTOR;
      break;
    case 'lastStand':
      stats.lastStand *= LAST_STAND_FACTOR;
      break;
  }
  player.upgrades.push(id);
  return true;
}

/** Draws one upgrade from `pool` (weighted by rarity), removing it from the pool. */
function drawWeighted(rng: Rng, pool: UpgradeDef[]): UpgradeId {
  const total = pool.reduce((sum, u) => sum + RARITY_WEIGHT[u.rarity], 0);
  let roll = rng.next() * total;
  let index = pool.findIndex((u) => (roll -= RARITY_WEIGHT[u.rarity]) < 0);
  if (index < 0) index = pool.length - 1;
  return pool.splice(index, 1)[0].id;
}

/**
 * Picks up to `count` different upgrades the player can still take, at random, weighted by
 * rarity. Offers fewer if fewer are eligible. Only upgrades in `options.pool` (the player's
 * unlocked ones; default: all) are offered. With `guaranteeRare`, one slot (the last) is always
 * a rare in the pool that the player can still take, if there is one; the rest are drawn as usual.
 */
export function offerUpgrades(
  rng: Rng,
  player: PlayerState,
  count = 3,
  options: { guaranteeRare?: boolean; pool?: readonly UpgradeId[] } = {},
): UpgradeId[] {
  const allowed = options.pool;
  const pool = UPGRADES.filter((u) => (!allowed || allowed.includes(u.id)) && stackCount(player, u.id) < u.maxStacks);
  const offer: UpgradeId[] = [];
  let rare: UpgradeId | null = null;
  if (options.guaranteeRare && count > 0) {
    const rares = pool.filter((u) => u.rarity === 'rare');
    if (rares.length > 0) {
      const pick = rng.pick(rares);
      rare = pick.id;
      pool.splice(pool.indexOf(pick), 1);
    }
  }
  const normalCount = rare ? count - 1 : count;
  while (offer.length < normalCount && pool.length > 0) offer.push(drawWeighted(rng, pool));
  if (rare) offer.push(rare);
  return offer;
}
