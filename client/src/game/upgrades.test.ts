import { describe, expect, it } from 'vitest';
import { BASE_STATS, createPlayer } from './player';
import { createRng } from './rng';
import { RARITY_WEIGHT, UPGRADES, applyUpgrade, offerUpgrades, stackCount, upgradeDef } from './upgrades';
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
    expect(UPGRADES).toHaveLength(15);
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(15);
    const expected: Record<string, [string, number]> = {
      twinShot: ['common', 2], rapidFire: ['common', 3], extraLife: ['common', 3], comboGuard: ['common', 2], magnet: ['common', 2],
      piercing: ['uncommon', 2], shieldPulse: ['uncommon', 2], thrusters: ['uncommon', 2], homing: ['uncommon', 2],
      ricochet: ['uncommon', 2], bombOnKill: ['uncommon', 3], overcharge: ['uncommon', 2],
      wingman: ['rare', 1], slowField: ['rare', 1], doubleTap: ['rare', 1],
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
    // 5 commons x 3, 7 uncommons x 2 and 3 rares x 1 make a total weight of 32.
    const freq = (id: UpgradeId) => (counts.get(id) ?? 0) / draws;
    expect(freq('twinShot')).toBeCloseTo(3 / 32, 2);
    expect(freq('piercing')).toBeCloseTo(2 / 32, 2);
    expect(freq('wingman')).toBeCloseTo(1 / 32, 2);
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
      const p = take(take(createPlayer(0), 'wingman'), 'slowField');
      const rng = createRng(7);
      for (let i = 0; i < 100; i++) {
        expect(offerUpgrades(rng, p, 3, { guaranteeRare: true })).toContain('doubleTap');
      }
    });

    it('falls back to a normal offer when no rare is left', () => {
      const p = take(take(take(createPlayer(0), 'wingman'), 'slowField'), 'doubleTap');
      const offer = offerUpgrades(createRng(8), p, 3, { guaranteeRare: true });
      expect(offer).toHaveLength(3);
      expect(offer.some((id) => upgradeDef(id).rarity === 'rare')).toBe(false);
    });
  });
});
