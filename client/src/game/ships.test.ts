import { describe, expect, it } from 'vitest';
import { BASE_STATS, createPlayer, tryFire } from './player';
import { SHIPS, SHIP_IDS, START_LIVES, shipDef } from './ships';
import { createRun } from './run';
import type { PlayerStats, ShipId } from './types';

describe('SHIPS', () => {
  it('lists the four ships in card order, each with a one-line trade-off ending in a full stop', () => {
    expect(SHIP_IDS).toEqual(['breaker', 'interceptor', 'lancer', 'bastion']);
    for (const id of SHIP_IDS) {
      const def = shipDef(id);
      expect(def.id).toBe(id);
      expect(def).toBe(SHIPS[id]);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.endsWith('.')).toBe(true);
      expect(def.description).not.toContain('\n');
    }
  });

  it('the Breaker is the base stats and three lives', () => {
    expect(shipDef('breaker').stats).toBe(BASE_STATS);
    expect(shipDef('breaker').lives).toBe(START_LIVES);
    expect(START_LIVES).toBe(3);
  });

  it('the Interceptor moves 35% faster and fires 15% faster, with two lives', () => {
    const def = shipDef('interceptor');
    expect(def.lives).toBe(2);
    expect(def.stats).toEqual({
      ...BASE_STATS,
      speed: BASE_STATS.speed * 1.35,
      fireInterval: BASE_STATS.fireInterval * 0.85,
    });
  });

  it('the Lancer fires two piercing shots side by side, 35% slower', () => {
    const def = shipDef('lancer');
    expect(def.lives).toBe(3);
    expect(def.stats).toEqual({
      ...BASE_STATS,
      shotsPerVolley: 2,
      spreadAngle: 0,
      pierce: 1,
      fireInterval: BASE_STATS.fireInterval * 1.35,
    });
  });

  it('the Bastion has a free shield every wave and moves 15% slower', () => {
    const def = shipDef('bastion');
    expect(def.lives).toBe(3);
    expect(def.stats).toEqual({ ...BASE_STATS, shieldPerWave: 1, speed: BASE_STATS.speed * 0.85 });
  });

  it('changes nothing else about a ship that the card does not say', () => {
    const named = ['speed', 'fireInterval', 'shotsPerVolley', 'spreadAngle', 'pierce', 'shieldPerWave'] as const;
    const rest = (stats: Readonly<PlayerStats>) => Object.fromEntries(Object.entries(stats).filter(([k]) => !(named as readonly string[]).includes(k)));
    for (const id of SHIP_IDS) expect(rest(shipDef(id).stats)).toEqual(rest(BASE_STATS));
  });
});

describe('createPlayer with a ship', () => {
  it('starts with the ship\'s lives and stats, as a copy', () => {
    const p = createPlayer(0, 0, 'interceptor');
    expect(p.ship).toBe('interceptor');
    expect(p.lives).toBe(2);
    expect(p.stats).toEqual(shipDef('interceptor').stats);
    p.stats.speed = 1;
    expect(shipDef('interceptor').stats.speed).toBeCloseTo(BASE_STATS.speed * 1.35, 9);
  });

  it('defaults to the Breaker', () => {
    expect(createPlayer(0).ship).toBe('breaker');
  });

  it('the Lancer\'s volley is two straight shots side by side that pierce one alien', () => {
    const p = createPlayer(0, 10, 'lancer');
    let id = 0;
    const shots = tryFire(p, { move: 0, drag: 0, fire: true, special: false }, () => ++id);
    expect(shots).toHaveLength(2);
    expect(shots.every((s) => s.vx === 0 && s.pierceLeft === 1)).toBe(true);
    expect(shots[0].x).toBeLessThan(10);
    expect(shots[1].x).toBeGreaterThan(10);
    expect(p.cooldown).toBeCloseTo(BASE_STATS.fireInterval * 1.35, 9);
  });
});

describe('createRun with options', () => {
  it('flies the chosen ship: lives, stats and the Bastion\'s shield from wave 1', () => {
    const run = createRun(1, 1, 0, { ships: ['bastion'] });
    const p = run.players[0];
    expect(p.ship).toBe('bastion');
    expect(p.stats).toEqual(shipDef('bastion').stats);
    expect(p.shield).toBe(1);
  });

  it('gives each player their own ship and defaults to the Breaker', () => {
    const ships: ShipId[] = ['interceptor'];
    const run = createRun(1, 2, 0, { ships });
    expect(run.players.map((p) => p.ship)).toEqual(['interceptor', 'breaker']);
    expect(run.players.map((p) => p.lives)).toEqual([2, 3]);
    expect(createRun(1).players[0].ship).toBe('breaker');
  });

  it('keeps the upgrade pool it is given, or every upgrade by default', () => {
    expect(createRun(1, 1, 0, { upgrades: ['twinShot', 'magnet'] }).upgradePool).toEqual(['twinShot', 'magnet']);
    expect(createRun(1).upgradePool).toHaveLength(19);
    expect(createRun(1).well).toBeNull();
  });
});
