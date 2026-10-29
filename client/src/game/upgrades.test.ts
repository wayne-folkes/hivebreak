import { describe, expect, it } from 'vitest';
import { BASE_STATS, createPlayer } from './player';
import { createRng } from './rng';
import { UPGRADES, applyUpgrade, offerUpgrades, stackCount, upgradeDef } from './upgrades';
import type { UpgradeId } from './types';

describe('applyUpgrade', () => {
  it('changes the stats as described', () => {
    const p = createPlayer(0);
    applyUpgrade(p, 'twinShot');
    applyUpgrade(p, 'rapidFire');
    applyUpgrade(p, 'piercing');
    applyUpgrade(p, 'extraLife');
    applyUpgrade(p, 'shieldPulse');
    applyUpgrade(p, 'thrusters');
    expect(p.stats.shotsPerVolley).toBe(2);
    expect(p.stats.fireInterval).toBeCloseTo(BASE_STATS.fireInterval * 0.75, 6);
    expect(p.stats.pierce).toBe(1);
    expect(p.lives).toBe(4);
    expect(p.stats.shieldPerWave).toBe(1);
    expect(p.stats.speed).toBeCloseTo(BASE_STATS.speed * 1.2, 6);
    expect(p.upgrades).toEqual(['twinShot', 'rapidFire', 'piercing', 'extraLife', 'shieldPulse', 'thrusters']);
  });

  it('stacks up to the limit and then refuses', () => {
    const p = createPlayer(0);
    expect(applyUpgrade(p, 'twinShot')).toBe(true);
    expect(applyUpgrade(p, 'twinShot')).toBe(true);
    expect(applyUpgrade(p, 'twinShot')).toBe(false);
    expect(p.stats.shotsPerVolley).toBe(3);
    expect(stackCount(p, 'twinShot')).toBe(2);
  });

  it('has the agreed limits and rarities', () => {
    expect(UPGRADES).toHaveLength(6);
    expect(UPGRADES.map((u) => u.maxStacks)).toEqual([2, 3, 3, 2, 2, 2]);
    for (const id of ['rapidFire', 'twinShot', 'extraLife'] as const) expect(upgradeDef(id).rarity).toBe('common');
    for (const id of ['piercing', 'shieldPulse', 'thrusters'] as const) expect(upgradeDef(id).rarity).toBe('uncommon');
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
    const p = createPlayer(0);
    applyUpgrade(p, 'piercing');
    applyUpgrade(p, 'piercing');
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

  it('offers common upgrades more often than uncommon ones', () => {
    const rng = createRng(4);
    const counts = new Map<UpgradeId, number>();
    for (let i = 0; i < 3000; i++) {
      for (const id of offerUpgrades(rng, createPlayer(0), 1)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const common = (counts.get('twinShot') ?? 0) / 3000;
    const uncommon = (counts.get('piercing') ?? 0) / 3000;
    expect(common).toBeCloseTo(3 / 15, 1);
    expect(uncommon).toBeCloseTo(2 / 15, 1);
    expect(common).toBeGreaterThan(uncommon);
  });
});
