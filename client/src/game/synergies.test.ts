import { describe, expect, it } from 'vitest';
import { createPlayer } from './player';
import { createRng } from './rng';
import {
  BURST_DAMAGE,
  BURST_RADIUS,
  SYNERGIES,
  completesSynergy,
  hasSynergy,
  killBursts,
  synergyDef,
  unlockSynergies,
} from './synergies';
import { applyUpgrade } from './upgrades';
import type { PlayerState, SynergyId, UpgradeId } from './types';

const give = (p: PlayerState, ...ids: UpgradeId[]) => {
  for (const id of ids) applyUpgrade(p, id);
  return p;
};

describe('SYNERGIES', () => {
  it('lists the seven pairs', () => {
    const pairs = Object.fromEntries(SYNERGIES.map((s) => [s.id, [...s.needs].sort()]));
    expect(pairs).toEqual({
      lance: ['piercing', 'twinShot'],
      afterburner: ['rapidFire', 'thrusters'],
      bulwark: ['extraLife', 'shieldPulse'],
      seekers: ['homing', 'ricochet'],
      chainReaction: ['bombOnKill', 'overcharge'],
      storm: ['chainSpark', 'homing'],
      battery: ['overclock', 'scavenger'],
    });
    for (const s of SYNERGIES) expect(synergyDef(s.id)).toBe(s);
  });
});

describe('unlockSynergies', () => {
  const cases: [SynergyId, UpgradeId, UpgradeId][] = [
    ['lance', 'twinShot', 'piercing'],
    ['afterburner', 'rapidFire', 'thrusters'],
    ['bulwark', 'shieldPulse', 'extraLife'],
    ['seekers', 'homing', 'ricochet'],
    ['chainReaction', 'bombOnKill', 'overcharge'],
    ['storm', 'chainSpark', 'homing'],
    ['battery', 'overclock', 'scavenger'],
  ];

  it.each(cases)('unlocks %s when both halves are held, and only then', (id, a, b) => {
    const p = give(createPlayer(0), a);
    expect(unlockSynergies(p)).toEqual([]);
    expect(hasSynergy(p, id)).toBe(false);
    give(p, b);
    expect(unlockSynergies(p)).toEqual([id]);
    expect(p.synergies).toEqual([id]);
    expect(hasSynergy(p, id)).toBe(true);
  });

  it('reports a synergy once, and can unlock several at once', () => {
    const p = give(createPlayer(0), 'twinShot', 'piercing', 'rapidFire', 'thrusters');
    expect(unlockSynergies(p).sort()).toEqual(['afterburner', 'lance']);
    expect(unlockSynergies(p)).toEqual([]);
    expect(p.synergies).toHaveLength(2);
  });
});

describe('completesSynergy', () => {
  it('names the synergy a pick would complete', () => {
    const p = give(createPlayer(0), 'twinShot');
    expect(completesSynergy(p, 'piercing')).toBe('lance');
    expect(completesSynergy(p, 'thrusters')).toBeNull();
    expect(completesSynergy(p, 'twinShot')).toBeNull();
  });

  it('works whichever half is held', () => {
    expect(completesSynergy(give(createPlayer(0), 'ricochet'), 'homing')).toBe('seekers');
    expect(completesSynergy(give(createPlayer(0), 'homing'), 'ricochet')).toBe('seekers');
  });

  it('says nothing once the synergy is unlocked', () => {
    const p = give(createPlayer(0), 'twinShot', 'piercing');
    unlockSynergies(p);
    expect(completesSynergy(p, 'piercing')).toBeNull();
  });
});

describe('killBursts', () => {
  it('never bursts without the upgrade, and does not touch the rng', () => {
    const rng = createRng(1);
    const before = createRng(1).next();
    expect(killBursts(createPlayer(0), 'normal', rng)).toBe(false);
    expect(rng.next()).toBe(before);
  });

  it('bursts at about the bomb-on-kill chance', () => {
    const p = give(createPlayer(0), 'bombOnKill', 'bombOnKill');
    const rng = createRng(3);
    let bursts = 0;
    for (let i = 0; i < 4000; i++) if (killBursts(p, 'normal', rng)) bursts++;
    expect(bursts / 4000).toBeCloseTo(0.3, 1);
  });

  it('rolls the bomb chance for kills with no shot (laser, Pulse Bomb)', () => {
    const p = createPlayer(0);
    p.stats.bombOnKill = 1;
    expect(killBursts(p, null, createRng(1))).toBe(true);
    p.stats.bombOnKill = 0;
    expect(killBursts(p, null, createRng(1))).toBe(false);
  });

  it('always bursts for overcharge and lance kills with Chain reaction, but not for normal shots', () => {
    const p = give(createPlayer(0), 'bombOnKill', 'overcharge');
    p.stats.bombOnKill = 0;
    unlockSynergies(p);
    const rng = createRng(2);
    expect(killBursts(p, 'overcharge', rng)).toBe(true);
    expect(killBursts(p, 'lance', rng)).toBe(true);
    expect(killBursts(p, 'normal', rng)).toBe(false);
  });

  it('does not always burst for overcharge shots without Chain reaction', () => {
    const p = give(createPlayer(0), 'overcharge');
    expect(killBursts(p, 'overcharge', createRng(2))).toBe(false);
  });

  it('exports the burst size', () => {
    expect(BURST_RADIUS).toBe(28);
    expect(BURST_DAMAGE).toBe(1);
  });
});
