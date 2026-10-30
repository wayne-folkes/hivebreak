import { describe, expect, it } from 'vitest';
import { createAlien } from './aliens';
import { createBoss } from './boss';
import { FIELD_HEIGHT } from './playfield';
import { BASE_STATS, SHIP_BOX_OFFSET_Y, SHIP_TOP, SHIP_Y, createPlayer } from './player';
import {
  HELPER_FIRE_INTERVAL,
  KILL_DROP_CHANCE,
  LASER_DPS,
  LASER_TICK_SECONDS,
  PICKUP_FALL_SPEED,
  PICKUP_HALF_SIZE,
  POWER_UP_KINDS,
  POWER_UP_SECONDS,
  SPREAD_ANGLES,
  activatePowerUp,
  applyRunEffect,
  computeBeam,
  enemyTimeScale,
  hasPowerUp,
  helperPosition,
  helperShots,
  laserDamage,
  rollDrop,
  spawnPickup,
  spreadVolley,
  tickLaser,
  stepPickups,
  tickPowerUps,
  tickRunEffects,
} from './powerups';
import { createRng } from './rng';
import { createRun } from './run';
import { VOLLEY_HIT } from './scoring';

const DT = 1 / 120;
const ids = () => {
  let n = 100;
  return () => ++n;
};

describe('rollDrop', () => {
  it('always drops from a carrier, covering every kind', () => {
    const rng = createRng(1);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const drop = rollDrop('carrier', rng);
      expect(drop).not.toBeNull();
      seen.add(drop as string);
    }
    expect([...seen].sort()).toEqual([...POWER_UP_KINDS].sort());
  });

  it('drops from other kills about 3% of the time', () => {
    const rng = createRng(42);
    const n = 20000;
    let drops = 0;
    for (const kind of ['drone', 'warden', 'diver'] as const) {
      for (let i = 0; i < n; i++) if (rollDrop(kind, rng) !== null) drops++;
    }
    const rate = drops / (n * 3);
    expect(KILL_DROP_CHANCE).toBe(0.03);
    expect(rate).toBeGreaterThan(0.025);
    expect(rate).toBeLessThan(0.035);
  });
});

describe('stepPickups', () => {
  it('builds a pickup and lets it fall at the fall speed', () => {
    const pickup = spawnPickup('laser', 10, 50, 3);
    expect(pickup).toEqual({ id: 3, kind: 'laser', x: 10, y: 50 });
    const { kept, collected } = stepPickups([pickup], [createPlayer(0, -60)], 1);
    expect(kept).toEqual([pickup]);
    expect(collected).toEqual([]);
    expect(pickup.y).toBeCloseTo(50 - PICKUP_FALL_SPEED, 6);
    expect(pickup.x).toBe(10);
  });

  it('does no work with no pickups', () => {
    const none: never[] = [];
    const result = stepPickups(none, [createPlayer(0)], DT);
    expect(result.kept).toBe(none);
    expect(result.collected).toEqual([]);
  });

  it('drifts toward a ship inside its magnet radius, but not one outside it', () => {
    const near = createPlayer(0, 0);
    near.stats.magnetRadius = 80;
    const inside = spawnPickup('spread', 30, SHIP_Y + 40, 1);
    const outside = spawnPickup('spread', 30, SHIP_Y + 120, 2);
    stepPickups([inside, outside], [near], 0.1);
    expect(inside.x).toBeLessThan(30);
    expect(inside.y).toBeLessThan(SHIP_Y + 40);
    expect(inside.x).toBeGreaterThan(0);
    expect(outside.x).toBe(30);
    expect(outside.y).toBeCloseTo(SHIP_Y + 120 - PICKUP_FALL_SPEED * 0.1, 6);
  });

  it('does not drift with no magnet', () => {
    const pickup = spawnPickup('slow', 30, SHIP_Y + 40, 1);
    stepPickups([pickup], [createPlayer(0, 0)], 0.1);
    expect(pickup.x).toBe(30);
  });

  it('is caught when it touches the ship, by that ship', () => {
    const players = [createPlayer(0, -50), createPlayer(1, 50)];
    const pickup = spawnPickup('helper', 50 + 8 + PICKUP_HALF_SIZE - 1, SHIP_Y + SHIP_BOX_OFFSET_Y, 9);
    const { kept, collected } = stepPickups([pickup], players, DT);
    expect(kept).toEqual([]);
    expect(collected).toEqual([{ playerId: 1, pickup }]);
  });

  it('is not caught by a ship that is out of lives', () => {
    const player = createPlayer(0, 0);
    player.lives = 0;
    const pickup = spawnPickup('helper', 0, SHIP_Y, 9);
    const { kept, collected } = stepPickups([pickup], [player], DT);
    expect(collected).toEqual([]);
    expect(kept).toHaveLength(1);
  });

  it('leaves the field uncaught off the bottom', () => {
    const pickup = spawnPickup('spread', 70, -FIELD_HEIGHT / 2 - PICKUP_HALF_SIZE + 0.1, 1);
    const { kept, collected } = stepPickups([pickup], [createPlayer(0, -70)], DT);
    expect(kept).toEqual([]);
    expect(collected).toEqual([]);
  });
});

describe('power-up timers', () => {
  it('has the agreed durations', () => {
    expect(POWER_UP_SECONDS).toEqual({ spread: 9, laser: 8, slow: 8, helper: 10 });
  });

  it('starts a power-up, and catching it again resets the clock rather than adding a second', () => {
    const p = createPlayer(0);
    activatePowerUp(p, 'laser');
    tickPowerUps(p, 3);
    expect(p.powerUps).toEqual([{ kind: 'laser', timeLeft: 5 }]);
    activatePowerUp(p, 'laser');
    expect(p.powerUps).toEqual([{ kind: 'laser', timeLeft: 8 }]);
    activatePowerUp(p, 'spread');
    expect(p.powerUps.map((u) => u.kind)).toEqual(['laser', 'spread']);
    expect(hasPowerUp(p, 'spread')).toBe(true);
    expect(hasPowerUp(p, 'helper')).toBe(false);
  });

  it('removes a power-up when it runs out and says which kinds ended', () => {
    const p = createPlayer(0);
    activatePowerUp(p, 'laser');
    activatePowerUp(p, 'spread');
    expect(tickPowerUps(p, 8.5)).toEqual(['laser']);
    expect(p.powerUps.map((u) => u.kind)).toEqual(['spread']);
    expect(tickPowerUps(p, 1)).toEqual(['spread']);
    expect(p.powerUps).toEqual([]);
    expect(tickPowerUps(p, 1)).toEqual([]);
  });

  it('sets the run-wide slow clock only for slow', () => {
    const run = createRun(1);
    applyRunEffect(run, 'laser');
    expect(run.slow).toBe(0);
    applyRunEffect(run, 'slow');
    expect(run.slow).toBe(POWER_UP_SECONDS.slow);
  });
});

describe('spreadVolley', () => {
  it('adds nothing without the power-up', () => {
    expect(spreadVolley(createPlayer(0), ids(), 5)).toEqual([]);
  });

  it('fires four more shots, fanned at +-0.175 and +-0.35 rad, in the volley it was given', () => {
    const p = createPlayer(0, 20);
    p.stats.damage = 2;
    p.stats.pierce = 1;
    activatePowerUp(p, 'spread');
    const shots = spreadVolley(p, ids(), 77);
    expect(shots).toHaveLength(4);
    expect(new Set(shots.map((s) => s.id)).size).toBe(4);
    expect(SPREAD_ANGLES[0]).toBe(-0.35);
    expect(SPREAD_ANGLES[3]).toBe(0.35);
    for (const s of shots) {
      expect(s).toMatchObject({ owner: 'player', kind: 'normal', playerId: 0, x: 20, y: SHIP_TOP, volley: 77, damage: 2, pierceLeft: 1 });
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(BASE_STATS.shotSpeed, 6);
    }
    expect(shots.every((s) => Math.abs(s.vx) > 1)).toBe(true); // none duplicates the straight shot
    expect(shots[0].vx).toBeLessThan(0);
    expect(shots[3].vx).toBeGreaterThan(0);
    expect(Math.atan2(shots[3].vx, shots[3].vy)).toBeCloseTo(0.35, 6);
    expect(shots[0].vx).toBeCloseTo(-shots[3].vx, 9);
    expect(shots[1].vx).toBeCloseTo(-shots[2].vx, 9);
  });
});

describe('computeBeam', () => {
  it('runs to the top of the field when nothing is in the way', () => {
    const p = createPlayer(0, 10);
    const { beam, target } = computeBeam(p, [createAlien('drone', 1, 0, 0, 80, 50)], null);
    expect(beam).toEqual({ playerId: 0, x: 10, topY: FIELD_HEIGHT / 2 });
    expect(target).toBeNull();
  });

  it('stops at the bottom of the first alien it touches', () => {
    const p = createPlayer(0, 0);
    const high = createAlien('drone', 1, 0, 0, 0, 100);
    const low = createAlien('drone', 2, 0, 1, 3, 40);
    const aside = createAlien('drone', 3, 0, 2, 40, 0);
    const { beam, target } = computeBeam(p, [high, low, aside], null);
    expect(target).toEqual({ alienId: 2 });
    expect(beam.topY).toBe(40 - 5);
  });

  it('is stopped by a boss part in front of an alien, and reports the part', () => {
    const p = createPlayer(0, 0);
    const boss = createBoss('broodMother', ids());
    boss.y = 100;
    boss.x = 0;
    const alien = createAlien('drone', 1, 0, 0, 0, 200);
    const { beam, target } = computeBeam(p, [alien], boss);
    expect(target?.alienId).toBeUndefined();
    expect(target?.part).toBeDefined();
    expect(beam.topY).toBeLessThan(200);
    expect(beam.topY).toBeGreaterThan(SHIP_TOP);
  });

  it('is stopped by an alien in front of the boss', () => {
    const p = createPlayer(0, 0);
    const boss = createBoss('broodMother', ids());
    boss.y = 100;
    boss.x = 0;
    const alien = createAlien('drone', 1, 0, 0, 0, 20);
    const { beam, target } = computeBeam(p, [alien], boss);
    expect(target).toEqual({ alienId: 1 });
    expect(beam.topY).toBe(15);
  });

  it('misses a boss that is out to the side', () => {
    const boss = createBoss('broodMother', ids());
    boss.y = 100;
    boss.x = 0;
    expect(computeBeam(createPlayer(0, 85), [], boss).target).toBeNull();
  });

  it('ignores dead aliens', () => {
    const p = createPlayer(0, 0);
    const dead = createAlien('drone', 1, 0, 0, 0, 40);
    dead.hp = 0;
    expect(computeBeam(p, [dead], null).target).toBeNull();
  });
});

describe('laserDamage', () => {
  it('does whole hits on a tick timer, LASER_DPS of them a second', () => {
    expect(LASER_DPS).toBe(6);
    const p = createPlayer(0);
    let total = 0;
    for (let t = 0; t < 2 - 1e-9; t += DT) {
      tickLaser(p, DT);
      total += laserDamage(p);
    }
    expect(total).toBe(12);
    expect(LASER_TICK_SECONDS).toBeCloseTo(1 / 6, 9);
  });

  it('hits for the ship\'s damage stat and then waits for the tick', () => {
    const p = createPlayer(0);
    p.stats.damage = 2;
    expect(laserDamage(p)).toBe(2);
    expect(laserDamage(p)).toBe(0);
    expect(p.laserTimer).toBe(LASER_TICK_SECONDS);
    expect(p.cooldown).toBe(0);
  });

  it('kills a drone in about a sixth of a second and a carrier in two thirds', () => {
    const p = createPlayer(0);
    const carrier = createAlien('carrier', 1, 0, 0, 0, 40);
    let t = 0;
    while (carrier.hp > 0) {
      tickLaser(p, DT);
      carrier.hp -= laserDamage(p);
      t += DT;
    }
    expect(t).toBeGreaterThan(0.45);
    expect(t).toBeLessThan(0.7);
  });
});

describe('helper drone', () => {
  it('orbits the ship deterministically from the clock', () => {
    const p = createPlayer(0, 15);
    expect(helperPosition(p, 1.3)).toEqual(helperPosition(p, 1.3));
    const a = helperPosition(p, 0);
    const b = helperPosition(p, 1);
    expect(a.x).toBeCloseTo(31, 6);
    expect(b).not.toEqual(a);
    expect(Math.abs(b.x - 15)).toBeLessThanOrEqual(16 + 1e-9);
    const moved = createPlayer(0, 45);
    expect(helperPosition(moved, 1).x - helperPosition(p, 1).x).toBeCloseTo(30, 9);
    expect(helperPosition(moved, 1).y).toBe(helperPosition(p, 1).y);
  });

  it('fires nothing without the power-up', () => {
    expect(helperShots(createPlayer(0), 0.4, DT, ids())).toEqual([]);
  });

  it('fires a straight shot about every 0.4 s from the drone, without breaking combos', () => {
    const p = createPlayer(0, 0);
    activatePowerUp(p, 'helper');
    const newId = ids();
    const shotTimes: number[] = [];
    let time = 0;
    for (let i = 0; i < 120 * 4.2; i++) {
      time += DT;
      const shots = helperShots(p, time, DT, newId);
      for (const s of shots) {
        shotTimes.push(time);
        const pos = helperPosition(p, time);
        expect(s).toMatchObject({ owner: 'player', kind: 'normal', playerId: 0, vx: 0, vy: BASE_STATS.shotSpeed, damage: 1, volley: VOLLEY_HIT });
        expect(s.x).toBeCloseTo(pos.x, 9);
      }
    }
    expect(shotTimes).toHaveLength(10);
    for (let i = 1; i < shotTimes.length; i++) expect(shotTimes[i] - shotTimes[i - 1]).toBeCloseTo(HELPER_FIRE_INTERVAL, 1);
  });
});

describe('helper drone clock', () => {
  it('fires each boundary in exactly one step, whatever the step size', () => {
    const p = createPlayer(0);
    activatePowerUp(p, 'helper');
    for (const dt of [1 / 120, 1 / 60, 0.07]) {
      let count = 0;
      let time = 0.013;
      const end = 4.013;
      while (time < end) {
        time += dt;
        count += helperShots(p, time, dt, ids()).length;
      }
      expect(Math.abs(count - Math.floor(time / HELPER_FIRE_INTERVAL))).toBeLessThanOrEqual(1);
    }
  });

  it('adds no shot for a step of no length, or when the span holds no boundary', () => {
    const p = createPlayer(0);
    activatePowerUp(p, 'helper');
    expect(helperShots(p, 0.8, 0, ids())).toEqual([]);
    expect(helperShots(p, 0.5, DT, ids())).toEqual([]);
    expect(helperShots(p, 0.8 + DT / 2, DT, ids())).toHaveLength(1);
    expect(helperShots(p, 0.8 + DT / 2 + DT, DT, ids())).toEqual([]);
  });
});

describe('enemy time scale', () => {
  it('is 1 normally, half under slow, 0 under freeze (freeze wins)', () => {
    const run = createRun(1);
    expect(enemyTimeScale(run)).toBe(1);
    run.slow = 3;
    expect(enemyTimeScale(run)).toBe(0.5);
    run.freeze = 1;
    expect(enemyTimeScale(run)).toBe(0);
  });

  it('counts freeze, slow and stun down to zero', () => {
    const run = createRun(1);
    run.freeze = 1;
    run.slow = 2;
    run.stun = 0.5;
    tickRunEffects(run, 0.75);
    expect(run.freeze).toBeCloseTo(0.25, 9);
    expect(run.slow).toBeCloseTo(1.25, 9);
    expect(run.stun).toBe(0);
    tickRunEffects(run, 5);
    expect([run.freeze, run.slow, run.stun]).toEqual([0, 0, 0]);
  });
});
