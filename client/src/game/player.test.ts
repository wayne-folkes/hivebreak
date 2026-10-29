import { describe, expect, it } from 'vitest';
import {
  ACCEL_SECONDS,
  BASE_STATS,
  DRAG_SPEED_FACTOR,
  INVULNERABLE_SECONDS,
  SHIP_BOX_OFFSET_Y,
  SHIP_HALF_HEIGHT,
  SHIP_TOP,
  SHIP_X_LIMIT,
  SHIP_Y,
  START_LIVES,
  VOLLEY_SPACING,
  createPlayer,
  hitPlayer,
  nearestPlayer,
  shipBox,
  stepPlayer,
  tryFire,
} from './player';
import type { ShipInput } from './types';

const DT = 1 / 120;
const input = (over: Partial<ShipInput> = {}): ShipInput => ({ move: 0, drag: 0, fire: false, ...over });

function run(p: ReturnType<typeof createPlayer>, i: ShipInput, seconds: number) {
  for (let t = 0; t < seconds; t += DT) stepPlayer(p, i, DT);
}

describe('createPlayer', () => {
  it('starts with base stats, full lives and no upgrades, without sharing the stats object', () => {
    const a = createPlayer(0);
    const b = createPlayer(1, 20);
    expect(a.lives).toBe(START_LIVES);
    expect(a.stats).toEqual(BASE_STATS);
    expect(b.x).toBe(20);
    a.stats.speed = 1;
    expect(b.stats.speed).toBe(BASE_STATS.speed);
    expect(shipBox(a).y).toBe(SHIP_Y + SHIP_BOX_OFFSET_Y);
    expect(shipBox(a).y + shipBox(a).halfHeight).toBe(SHIP_TOP);
    expect(SHIP_HALF_HEIGHT).toBe(7);
  });
});

describe('stepPlayer movement', () => {
  it('accelerates up to top speed rather than jumping to it', () => {
    const p = createPlayer(0);
    stepPlayer(p, input({ move: 1 }), DT);
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(BASE_STATS.speed);
    run(p, input({ move: 1 }), ACCEL_SECONDS * 2);
    expect(p.vx).toBeCloseTo(BASE_STATS.speed, 5);
  });

  it('slows to a stop when the key is released', () => {
    const p = createPlayer(0);
    run(p, input({ move: 1 }), 0.3);
    run(p, input(), 0.3);
    expect(p.vx).toBe(0);
  });

  it('stays inside the field with a margin and stops at the wall', () => {
    const p = createPlayer(0);
    run(p, input({ move: 1 }), 5);
    expect(p.x).toBe(SHIP_X_LIMIT);
    expect(p.vx).toBe(0);
    run(p, input({ move: -1 }), 5);
    expect(p.x).toBe(-SHIP_X_LIMIT);
  });

  it('plays a touch drag out over several steps, capped, and then stops dead', () => {
    const p = createPlayer(0);
    stepPlayer(p, input({ drag: 30 }), DT);
    const firstStep = p.x;
    expect(firstStep).toBeCloseTo(DRAG_SPEED_FACTOR * BASE_STATS.speed * DT, 6);
    expect(p.pendingDrag).toBeGreaterThan(0);
    expect(p.vx).toBeGreaterThan(0);
    run(p, input(), 0.5);
    expect(p.x).toBeCloseTo(30, 6);
    expect(p.pendingDrag).toBe(0);
    expect(p.vx).toBe(0);
  });

  it('is slower to drag with a slower ship', () => {
    const slow = createPlayer(0);
    const fast = createPlayer(1);
    fast.stats.speed *= 1.2;
    stepPlayer(slow, input({ drag: 50 }), DT);
    stepPlayer(fast, input({ drag: 50 }), DT);
    expect(fast.x).toBeGreaterThan(slow.x);
  });

  it('does not move a ship that is out of lives', () => {
    const p = createPlayer(0);
    p.lives = 0;
    run(p, input({ move: 1, drag: 20 }), 0.5);
    expect(p.x).toBe(0);
  });
});

describe('tryFire', () => {
  const ids = () => {
    let n = 0;
    return () => ++n;
  };

  it('fires one shot straight up, then waits for the cooldown', () => {
    const p = createPlayer(0, 10);
    const shots = tryFire(p, input({ fire: true }), ids());
    expect(shots).toHaveLength(1);
    expect(shots[0]).toMatchObject({ owner: 'player', playerId: 0, x: 10, y: SHIP_TOP, vx: 0, vy: BASE_STATS.shotSpeed, hits: 0 });
    expect(tryFire(p, input({ fire: true }), ids())).toEqual([]);
    run(p, input(), BASE_STATS.fireInterval + DT);
    expect(tryFire(p, input({ fire: true }), ids())).toHaveLength(1);
  });

  it('does not fire unless fire is held', () => {
    expect(tryFire(createPlayer(0), input(), ids())).toEqual([]);
  });

  it('spreads a volley of several shots side by side, centred on the ship', () => {
    const p = createPlayer(0, 0);
    p.stats.shotsPerVolley = 2;
    p.stats.pierce = 1;
    const shots = tryFire(p, input({ fire: true }), ids());
    expect(shots.map((s) => s.x)).toEqual([-VOLLEY_SPACING / 2, VOLLEY_SPACING / 2]);
    expect(new Set(shots.map((s) => s.id)).size).toBe(2);
    expect(shots[0].volley).toBe(shots[1].volley);
    expect(shots.map((s) => s.id)).not.toContain(shots[0].volley);
    expect(shots[0].pierceLeft).toBe(1);
  });

  it('gives each volley its own number', () => {
    const p = createPlayer(0);
    const next = ids();
    const first = tryFire(p, input({ fire: true }), next);
    run(p, input(), BASE_STATS.fireInterval + DT);
    const second = tryFire(p, input({ fire: true }), next);
    expect(first[0].volley).not.toBe(second[0].volley);
  });

  it('does not fire when out of lives', () => {
    const p = createPlayer(0);
    p.lives = 0;
    expect(tryFire(p, input({ fire: true }), ids())).toEqual([]);
  });
});

describe('hitPlayer', () => {
  it('costs a life and starts a safe moment', () => {
    const p = createPlayer(0);
    expect(hitPlayer(p)).toBe('life');
    expect(p.lives).toBe(START_LIVES - 1);
    expect(p.invulnerable).toBe(INVULNERABLE_SECONDS);
    expect(hitPlayer(p)).toBe('ignored');
    expect(p.lives).toBe(START_LIVES - 1);
  });

  it('is absorbed by a shield first', () => {
    const p = createPlayer(0);
    p.shield = 1;
    expect(hitPlayer(p)).toBe('shield');
    expect(p.shield).toBe(0);
    expect(p.lives).toBe(START_LIVES);
  });

  it('wears off with time', () => {
    const p = createPlayer(0);
    hitPlayer(p);
    run(p, input(), INVULNERABLE_SECONDS + 0.1);
    expect(p.invulnerable).toBe(0);
    expect(hitPlayer(p)).toBe('life');
  });
});

describe('nearestPlayer', () => {
  it('picks the closest living player', () => {
    const a = createPlayer(0, -40);
    const b = createPlayer(1, 40);
    expect(nearestPlayer([a, b], 30)).toBe(b);
    expect(nearestPlayer([a, b], -10)).toBe(a);
    b.lives = 0;
    expect(nearestPlayer([a, b], 30)).toBe(a);
    a.lives = 0;
    expect(nearestPlayer([a, b], 30)).toBeNull();
  });
});
