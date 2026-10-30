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
  OVERCHARGE_DAMAGE,
  OVERCHARGE_PIERCE,
  VOLLEY_SPACING,
  WINGMAN_OFFSET_X,
  createPlayer,
  hitPlayer,
  nearestPlayer,
  shipBox,
  stepPlayer,
  tryFire,
  wingmanXs,
  wingmanShots,
  currentFireInterval,
} from './player';
import { BULWARK_REGEN_SECONDS, LANCE_DAMAGE, LANCE_PIERCE, unlockSynergies } from './synergies';
import { VOLLEY_HIT } from './scoring';
import { applyUpgrade } from './upgrades';
import type { ShipInput } from './types';

const DT = 1 / 120;
const input = (over: Partial<ShipInput> = {}): ShipInput => ({ move: 0, drag: 0, fire: false, special: false, ...over });

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

describe('volley building', () => {
  const ids = () => {
    let n = 0;
    return () => ++n;
  };
  const fire = (p: ReturnType<typeof createPlayer>, next = ids()) => {
    p.cooldown = 0;
    return tryFire(p, input({ fire: true }), next);
  };
  const give = (p: ReturnType<typeof createPlayer>, ...list: Parameters<typeof applyUpgrade>[1][]) => {
    for (const id of list) applyUpgrade(p, id);
    unlockSynergies(p);
    return p;
  };

  it('fans twin shots out symmetrically by the spread angle, at full shot speed', () => {
    const p = give(createPlayer(0), 'twinShot', 'twinShot');
    const shots = fire(p);
    expect(shots).toHaveLength(3);
    const angles = shots.map((s) => Math.atan2(s.vx, s.vy));
    expect(angles[0]).toBeCloseTo(-0.12, 6);
    expect(angles[1]).toBeCloseTo(0, 6);
    expect(angles[2]).toBeCloseTo(0.12, 6);
    for (const s of shots) expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(BASE_STATS.shotSpeed, 6);
  });

  it('copies damage, homing and bounces from the stats', () => {
    const p = give(createPlayer(0), 'doubleTap', 'homing', 'ricochet', 'piercing');
    const [s] = fire(p);
    expect(s).toMatchObject({ damage: 2, homing: 2.5, bouncesLeft: 1, pierceLeft: 1, kind: 'normal' });
  });

  it('adds a big overcharge shot on every 5th volley, then every 4th with a second copy', () => {
    const p = give(createPlayer(0), 'overcharge');
    const kinds: number[] = [];
    for (let i = 1; i <= 10; i++) {
      const shots = fire(p);
      if (shots.some((s) => s.kind === 'overcharge')) kinds.push(i);
    }
    expect(kinds).toEqual([5, 10]);
    expect(p.volleys).toBe(10);
    const q = give(createPlayer(0), 'overcharge', 'overcharge');
    const hits: number[] = [];
    for (let i = 1; i <= 8; i++) if (fire(q).some((s) => s.kind === 'overcharge')) hits.push(i);
    expect(hits).toEqual([4, 8]);
  });

  it('makes the overcharge shot bigger and shares the volley', () => {
    const p = give(createPlayer(0), 'overcharge');
    p.volleys = 4;
    const shots = fire(p);
    const big = shots.find((s) => s.kind === 'overcharge')!;
    expect(big).toMatchObject({ damage: OVERCHARGE_DAMAGE, pierceLeft: OVERCHARGE_PIERCE, vx: 0 });
    expect(shots).toHaveLength(2);
  });

  it('adds a lance shot to every volley with the Lance synergy', () => {
    const p = give(createPlayer(0), 'twinShot', 'piercing');
    expect(p.synergies).toContain('lance');
    for (let i = 0; i < 3; i++) {
      const shots = fire(p);
      const lance = shots.filter((s) => s.kind === 'lance');
      expect(lance).toHaveLength(1);
      expect(lance[0]).toMatchObject({ damage: LANCE_DAMAGE, pierceLeft: LANCE_PIERCE, vx: 0 });
      expect(shots).toHaveLength(3);
    }
  });

  it('puts overcharge, lance and wingman shots in the VOLLEY_HIT volley, and only the fan counts', () => {
    const p = give(createPlayer(0), 'twinShot', 'piercing', 'wingman', 'overcharge');
    p.volleys = 4;
    const shots = fire(p);
    const fan = shots.filter((s) => s.kind === 'normal' && s.volley !== VOLLEY_HIT);
    expect(fan).toHaveLength(2);
    expect(new Set(fan.map((s) => s.volley)).size).toBe(1);
    const extras = shots.filter((s) => !fan.includes(s));
    expect(extras).toHaveLength(3);
    for (const s of extras) expect(s.volley).toBe(VOLLEY_HIT);
  });

  it('fires one straight shot from each wingman', () => {
    const p = give(createPlayer(0, 10), 'wingman');
    const shots = fire(p);
    expect(shots).toHaveLength(2);
    expect(shots.map((s) => s.x).sort((a, b) => a - b)).toEqual([10, 10 + WINGMAN_OFFSET_X]);
    expect(shots.every((s) => s.vx === 0 && s.vy === BASE_STATS.shotSpeed)).toBe(true);
  });

  it('gives every shot of a volley a unique id', () => {
    const p = give(createPlayer(0), 'twinShot', 'piercing', 'wingman', 'overcharge');
    p.volleys = 4;
    const shots = fire(p);
    expect(new Set(shots.map((s) => s.id)).size).toBe(shots.length);
  });
});

describe('wingmanXs', () => {
  it('is empty with no wingmen, then alternates sides', () => {
    const p = createPlayer(0, 0);
    expect(wingmanXs(p)).toEqual([]);
    p.stats.wingmen = 3;
    expect(wingmanXs(p)).toEqual([WINGMAN_OFFSET_X, -WINGMAN_OFFSET_X, 2 * WINGMAN_OFFSET_X]);
  });

  it('keeps wingmen inside the field', () => {
    const p = createPlayer(0, SHIP_X_LIMIT);
    p.stats.wingmen = 1;
    expect(wingmanXs(p)[0]).toBeLessThanOrEqual(90 - 4);
  });
});

describe('wingmanShots', () => {
  it('builds only the wingmen shots, outside any counted volley, without touching cooldown or volleys', () => {
    const p = createPlayer(0, 10);
    expect(wingmanShots(p, () => 1)).toEqual([]);
    p.stats.wingmen = 2;
    p.stats.damage = 2;
    p.stats.pierce = 1;
    let id = 100;
    const shots = wingmanShots(p, () => id++);
    expect(shots.map((s) => s.x)).toEqual(wingmanXs(p));
    expect(shots.map((s) => s.id)).toEqual([100, 101]);
    expect(shots.every((s) => s.volley === VOLLEY_HIT && s.kind === 'normal' && s.damage === 2 && s.pierceLeft === 1 && s.vx === 0)).toBe(true);
    expect(p.volleys).toBe(0);
    expect(p.cooldown).toBe(0);
  });

  it('is the same set of shots tryFire adds to a volley', () => {
    const p = createPlayer(0, 0);
    p.stats.wingmen = 1;
    const fired = tryFire(p, input({ fire: true }), () => 7);
    expect(fired.filter((s) => s.volley === VOLLEY_HIT).map((s) => s.x)).toEqual(wingmanXs(p));
  });
});

describe('afterburner', () => {
  it('shortens the fire interval only while moving fast', () => {
    const p = createPlayer(0);
    for (const id of ['rapidFire', 'thrusters'] as const) applyUpgrade(p, id);
    unlockSynergies(p);
    p.vx = 0;
    expect(currentFireInterval(p)).toBeCloseTo(p.stats.fireInterval, 9);
    p.vx = p.stats.speed * 0.5;
    expect(currentFireInterval(p)).toBeCloseTo(p.stats.fireInterval, 9);
    p.vx = -p.stats.speed * 0.7;
    expect(currentFireInterval(p)).toBeCloseTo(p.stats.fireInterval * 0.7, 9);
    tryFire(p, input({ fire: true }), () => 1);
    expect(p.cooldown).toBeCloseTo(p.stats.fireInterval * 0.7, 9);
  });

  it('does nothing without the synergy', () => {
    const p = createPlayer(0);
    applyUpgrade(p, 'rapidFire');
    p.vx = p.stats.speed;
    expect(currentFireInterval(p)).toBe(p.stats.fireInterval);
  });
});

describe('bulwark', () => {
  const bulwark = () => {
    const p = createPlayer(0);
    applyUpgrade(p, 'shieldPulse');
    applyUpgrade(p, 'extraLife');
    unlockSynergies(p);
    p.shield = p.stats.shieldPerWave;
    return p;
  };

  it('brings a used shield back after 8 seconds, once per wave', () => {
    const p = bulwark();
    expect(hitPlayer(p)).toBe('shield');
    expect(p.shield).toBe(0);
    run(p, input(), BULWARK_REGEN_SECONDS - 0.5);
    expect(p.shield).toBe(0);
    run(p, input(), 0.6);
    expect(p.shield).toBe(1);
    // A second used shield this wave does not come back.
    run(p, input(), 1);
    expect(hitPlayer(p)).toBe('shield');
    run(p, input(), BULWARK_REGEN_SECONDS + 1);
    expect(p.shield).toBe(0);
  });

  it('does nothing without the synergy', () => {
    const p = createPlayer(0);
    p.shield = 1;
    hitPlayer(p);
    run(p, input(), 12);
    expect(p.shield).toBe(0);
  });
});

describe('last stand', () => {
  it('shortens the fire interval only on the last life, and the cooldown follows', () => {
    const p = createPlayer(0);
    applyUpgrade(p, 'lastStand');
    expect(p.lives).toBe(3);
    expect(currentFireInterval(p)).toBe(p.stats.fireInterval);
    p.lives = 2;
    expect(currentFireInterval(p)).toBe(p.stats.fireInterval);
    p.lives = 1;
    tryFire(p, input({ fire: true }), () => 1);
    expect(p.cooldown).toBeCloseTo(p.stats.fireInterval * 0.7, 9);
  });

  it('does nothing without the upgrade', () => {
    const p = createPlayer(0);
    p.lives = 1;
    expect(currentFireInterval(p)).toBe(p.stats.fireInterval);
  });

  it('stacks with the Afterburner', () => {
    const p = createPlayer(0);
    for (const id of ['rapidFire', 'thrusters', 'lastStand'] as const) applyUpgrade(p, id);
    unlockSynergies(p);
    p.lives = 1;
    p.vx = p.stats.speed;
    expect(currentFireInterval(p)).toBeCloseTo(p.stats.fireInterval * 0.7 * 0.7, 9);
  });
});
