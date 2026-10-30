import { describe, expect, it } from 'vitest';
import { BASE_STATS, createPlayer, currentFireInterval } from './player';
import { createRng } from './rng';
import {
  CHAIN_RANGE,
  LAST_STAND_FACTOR,
  OVERCLOCK_FACTOR,
  RARITY_WEIGHT,
  SCAVENGER_DROP_FACTOR,
  SCAVENGER_TIME_FACTOR,
  UPGRADES,
  applyUpgrade,
  offerUpgrades,
  stackCount,
  upgradeDef,
} from './upgrades';
import type { PlayerState, UpgradeId } from './types';

const take = (p: PlayerState, id: UpgradeId, times = 1) => {
  for (let i = 0; i < times; i++) applyUpgrade(p, id);
  return p;
};

describe('applyUpgrade', () => {
  it('twin shot adds a shot and fans them out', () => {
    const p = take(createPlayer(0), 'twinShot');
    expect(p.stats.shotsPerVolley).toBe(2);
    expect(p.stats.spreadAngle).toBeCloseTo(0.12, 6);
    take(p, 'twinShot');
    expect(p.stats.shotsPerVolley).toBe(3);
    expect(p.stats.spreadAngle).toBeCloseTo(0.12, 6);
  });

  it('rapid fire multiplies the fire interval by 0.65 per copy', () => {
    const p = take(createPlayer(0), 'rapidFire', 2);
    expect(p.stats.fireInterval).toBeCloseTo(BASE_STATS.fireInterval * 0.65 * 0.65, 6);
  });

  it('extra life adds a life', () => {
    expect(take(createPlayer(0), 'extraLife').lives).toBe(4);
  });

  it('combo guard adds a forgiven miss per wave', () => {
    expect(take(createPlayer(0), 'comboGuard', 2).stats.comboGuard).toBe(2);
  });

  it('magnet adds 40 px of pickup pull per copy', () => {
    expect(take(createPlayer(0), 'magnet', 2).stats.magnetRadius).toBe(80);
  });

  it('piercing adds pierce', () => {
    expect(take(createPlayer(0), 'piercing', 2).stats.pierce).toBe(2);
  });

  it('shield pulse adds a shield hit per wave', () => {
    expect(take(createPlayer(0), 'shieldPulse').stats.shieldPerWave).toBe(1);
  });

  it('thrusters multiply speed by 1.3 per copy', () => {
    expect(take(createPlayer(0), 'thrusters', 2).stats.speed).toBeCloseTo(BASE_STATS.speed * 1.3 * 1.3, 6);
  });

  it('homing adds 2.5 rad/s per copy', () => {
    expect(take(createPlayer(0), 'homing', 2).stats.homing).toBeCloseTo(5, 6);
  });

  it('ricochet adds a bounce', () => {
    expect(take(createPlayer(0), 'ricochet', 2).stats.ricochet).toBe(2);
  });

  it('bomb on kill adds 15% chance per copy', () => {
    expect(take(createPlayer(0), 'bombOnKill', 3).stats.bombOnKill).toBeCloseTo(0.45, 6);
  });

  it('overcharge fires every 5th volley, then every 4th', () => {
    const p = take(createPlayer(0), 'overcharge');
    expect(p.stats.overchargeEvery).toBe(5);
    take(p, 'overcharge');
    expect(p.stats.overchargeEvery).toBe(4);
  });

  it('wingman adds a wingman', () => {
    expect(take(createPlayer(0), 'wingman').stats.wingmen).toBe(1);
  });

  it('slow field slows enemy shots to 75%', () => {
    expect(take(createPlayer(0), 'slowField').stats.enemyShotSpeed).toBeCloseTo(0.75, 6);
  });

  it('double tap adds a point of damage', () => {
    expect(take(createPlayer(0), 'doubleTap').stats.damage).toBe(2);
  });

  it('chain spark adds an arc per copy and reaches about 40 px', () => {
    expect(take(createPlayer(0), 'chainSpark').stats.chain).toBe(1);
    expect(take(createPlayer(0), 'chainSpark', 2).stats.chain).toBe(2);
    expect(CHAIN_RANGE).toBe(40);
  });

  it('scavenger makes power-ups last and drop 50% more', () => {
    const p = take(createPlayer(0), 'scavenger');
    expect(p.stats.powerUpTime).toBeCloseTo(1.5, 6);
    expect(p.stats.dropRate).toBeCloseTo(1.5, 6);
    expect([SCAVENGER_TIME_FACTOR, SCAVENGER_DROP_FACTOR]).toEqual([1.5, 1.5]);
  });

  it('overclock multiplies the meter gain by 1.3 per copy', () => {
    expect(take(createPlayer(0), 'overclock').stats.chargeRate).toBeCloseTo(1.3, 6);
    expect(take(createPlayer(0), 'overclock', 2).stats.chargeRate).toBeCloseTo(1.69, 6);
    expect(OVERCLOCK_FACTOR).toBe(1.3);
  });

  it('last stand sets a 0.7 fire interval factor that only counts on the last life', () => {
    const p = take(createPlayer(0), 'lastStand');
    expect(p.stats.lastStand).toBeCloseTo(0.7, 6);
    expect(LAST_STAND_FACTOR).toBe(0.7);
    expect(currentFireInterval(p)).toBeCloseTo(BASE_STATS.fireInterval, 6);
    p.lives = 1;
    expect(currentFireInterval(p)).toBeCloseTo(BASE_STATS.fireInterval * 0.7, 6);
  });

  it('records what was taken, in order', () => {
    const p = take(take(createPlayer(0), 'wingman'), 'magnet');
    expect(p.upgrades).toEqual(['wingman', 'magnet']);
  });

  it('stacks up to the limit and then refuses, changing nothing', () => {
    const p = createPlayer(0);
    expect(applyUpgrade(p, 'twinShot')).toBe(true);
    expect(applyUpgrade(p, 'twinShot')).toBe(true);
    expect(applyUpgrade(p, 'twinShot')).toBe(false);
    expect(p.stats.shotsPerVolley).toBe(3);
    expect(stackCount(p, 'twinShot')).toBe(2);
    expect(applyUpgrade(take(p, 'wingman'), 'wingman')).toBe(false);
    expect(p.stats.wingmen).toBe(1);
  });

  it('has the agreed limits and rarities', () => {
    expect(UPGRADES).toHaveLength(19);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(19);
    const expected: Record<string, [string, number]> = {
      twinShot: ['common', 2], rapidFire: ['common', 3], extraLife: ['common', 3], comboGuard: ['common', 2], magnet: ['common', 2],
      piercing: ['uncommon', 2], shieldPulse: ['uncommon', 2], thrusters: ['uncommon', 2], homing: ['uncommon', 2],
      ricochet: ['uncommon', 2], bombOnKill: ['uncommon', 3], overcharge: ['uncommon', 2],
      wingman: ['rare', 1], slowField: ['rare', 1], doubleTap: ['rare', 1],
      scavenger: ['common', 1], chainSpark: ['uncommon', 2], overclock: ['uncommon', 2], lastStand: ['rare', 1],
    };
    for (const u of UPGRADES) {
      expect([u.rarity, u.maxStacks]).toEqual(expected[u.id]);
      expect(u.name.length).toBeGreaterThan(0);
      expect(u.description.length).toBeGreaterThan(0);
    }
    expect(upgradeDef('doubleTap').rarity).toBe('rare');
    expect(RARITY_WEIGHT.rare).toBe(1);
  });
});

describe('offerUpgrades', () => {
  it('offers three different upgrades', () => {
    const rng = createRng(1);
    for (let i = 0; i < 50; i++) {
      const offer = offerUpgrades(rng, createPlayer(0));
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
    }
  });

  it('leaves out upgrades that are maxed out', () => {
    const p = take(createPlayer(0), 'piercing', 2);
    const rng = createRng(2);
    for (let i = 0; i < 100; i++) expect(offerUpgrades(rng, p)).not.toContain('piercing');
  });

  it('offers fewer when fewer are eligible, and none when all are maxed', () => {
    const p = createPlayer(0);
    for (const u of UPGRADES) while (applyUpgrade(p, u.id));
    expect(offerUpgrades(createRng(1), p)).toEqual([]);
    p.upgrades = p.upgrades.filter((u) => u !== 'thrusters' && u !== 'extraLife');
    expect(offerUpgrades(createRng(1), p).sort()).toEqual(['extraLife', 'thrusters']);
  });

  it('is repeatable for a seed', () => {
    expect(offerUpgrades(createRng(9), createPlayer(0))).toEqual(offerUpgrades(createRng(9), createPlayer(0)));
  });

  it('weights each upgrade by its rarity: common most, rare least', () => {
    const rng = createRng(4);
    const counts = new Map<UpgradeId, number>();
    const draws = 20000;
    for (let i = 0; i < draws; i++) {
      for (const id of offerUpgrades(rng, createPlayer(0), 1)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    // 6 commons x 3, 9 uncommons x 2 and 4 rares x 1 make a total weight of 40.
    const freq = (id: UpgradeId) => (counts.get(id) ?? 0) / draws;
    expect(freq('twinShot')).toBeCloseTo(3 / 40, 2);
    expect(freq('piercing')).toBeCloseTo(2 / 40, 2);
    expect(freq('wingman')).toBeCloseTo(1 / 40, 2);
    expect(freq('twinShot')).toBeGreaterThan(freq('piercing'));
    expect(freq('piercing')).toBeGreaterThan(freq('wingman'));
  });

  it('only rarely includes a rare without the guarantee', () => {
    const rng = createRng(5);
    let withRare = 0;
    const offers = 3000;
    for (let i = 0; i < offers; i++) {
      if (offerUpgrades(rng, createPlayer(0)).some((id) => upgradeDef(id).rarity === 'rare')) withRare++;
    }
    expect(withRare / offers).toBeLessThan(0.4);
    expect(withRare / offers).toBeGreaterThan(0.1);
  });

  describe('with guaranteeRare', () => {
    it('always includes a rare the player can still take, among three different upgrades', () => {
      const rng = createRng(6);
      for (let i = 0; i < 200; i++) {
        const offer = offerUpgrades(rng, createPlayer(0), 3, { guaranteeRare: true });
        expect(offer).toHaveLength(3);
        expect(new Set(offer).size).toBe(3);
        expect(offer.filter((id) => upgradeDef(id).rarity === 'rare').length).toBeGreaterThanOrEqual(1);
      }
    });

    it('skips rares the player already has', () => {
      const p = take(take(take(createPlayer(0), 'wingman'), 'slowField'), 'lastStand');
      const rng = createRng(7);
      for (let i = 0; i < 100; i++) {
        expect(offerUpgrades(rng, p, 3, { guaranteeRare: true })).toContain('doubleTap');
      }
    });

    it('falls back to a normal offer when no rare is left', () => {
      const p = take(take(take(take(createPlayer(0), 'wingman'), 'slowField'), 'doubleTap'), 'lastStand');
      const offer = offerUpgrades(createRng(8), p, 3, { guaranteeRare: true });
      expect(offer).toHaveLength(3);
      expect(offer.some((id) => upgradeDef(id).rarity === 'rare')).toBe(false);
    });
  });
});

describe('offerUpgrades with a pool', () => {
  it('offers only upgrades in the pool', () => {
    const pool: UpgradeId[] = ['twinShot', 'rapidFire', 'extraLife', 'piercing', 'wingman'];
    const rng = createRng(11);
    for (let i = 0; i < 200; i++) {
      for (const id of offerUpgrades(rng, createPlayer(0), 3, { pool })) expect(pool).toContain(id);
    }
  });

  it('offers fewer when the pool has fewer eligible upgrades than slots', () => {
    const p = createPlayer(0);
    expect(offerUpgrades(createRng(1), p, 3, { pool: ['wingman', 'homing'] }).sort()).toEqual(['homing', 'wingman']);
    expect(offerUpgrades(createRng(1), p, 3, { pool: [] })).toEqual([]);
    take(p, 'wingman');
    expect(offerUpgrades(createRng(1), p, 3, { pool: ['wingman', 'homing'] })).toEqual(['homing']);
  });

  it('a pool of every upgrade offers what no pool does', () => {
    const all = UPGRADES.map((u) => u.id);
    expect(offerUpgrades(createRng(3), createPlayer(0), 3, { pool: all })).toEqual(offerUpgrades(createRng(3), createPlayer(0)));
  });

  it('guaranteeRare takes a rare from the pool only', () => {
    const pool: UpgradeId[] = ['twinShot', 'piercing', 'lastStand', 'magnet'];
    const rng = createRng(12);
    for (let i = 0; i < 100; i++) {
      const offer = offerUpgrades(rng, createPlayer(0), 3, { guaranteeRare: true, pool });
      expect(offer).toContain('lastStand');
      for (const id of offer) expect(pool).toContain(id);
    }
  });

  it('guaranteeRare with no rare in the pool is a normal offer from the pool', () => {
    const pool: UpgradeId[] = ['twinShot', 'rapidFire', 'piercing', 'magnet'];
    const rng = createRng(13);
    for (let i = 0; i < 100; i++) {
      const offer = offerUpgrades(rng, createPlayer(0), 3, { guaranteeRare: true, pool });
      expect(offer).toHaveLength(3);
      expect(new Set(offer).size).toBe(3);
      for (const id of offer) expect(pool).toContain(id);
    }
  });
});
