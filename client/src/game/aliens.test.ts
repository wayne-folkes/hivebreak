import { describe, expect, it } from 'vitest';
import {
  ALIEN_SPECS,
  DIVE_END_Y,
  DIVE_SECONDS,
  HIT_FLASH_SECONDS,
  MINI_SPREAD_VX,
  PAIR_DIVE_SPREAD,
  RETURN_SPEED,
  alienBox,
  basePoints,
  createAlien,
  damageAlien,
  divePosition,
  splitAlien,
  startDive,
  startPairedDive,
  stepAlien,
} from './aliens';
import { freeAlienGone, stepFreeAlien } from './boss';
import { overlaps } from './collision';
import { SHIP_BOX_OFFSET_Y, SHIP_HALF_HEIGHT, SHIP_HALF_WIDTH, SHIP_Y } from './player';
import { chooseSpecial, createRun, stepRun } from './run';
import { WAVES } from './waves';

const DT = 1 / 120;

describe('alien specs', () => {
  it('has the agreed hit points, points and box sizes', () => {
    expect(ALIEN_SPECS.drone).toMatchObject({ hp: 1, points: 10, halfWidth: 7, halfHeight: 5 });
    expect(ALIEN_SPECS.warden).toMatchObject({ hp: 2, points: 30, halfWidth: 8, halfHeight: 6 });
    expect(ALIEN_SPECS.diver).toMatchObject({ hp: 1, points: 40, halfWidth: 6, halfHeight: 6 });
  });

  it('builds an alien in formation with its kind\'s hit points and box', () => {
    const a = createAlien('warden', 5, 1, 2, 10, 20);
    expect(a).toMatchObject({ id: 5, kind: 'warden', hp: 2, mode: 'formation', col: 1, row: 2 });
    expect(alienBox(a)).toEqual({ x: 10, y: 20, halfWidth: 8, halfHeight: 6 });
  });
});

describe('damageAlien', () => {
  it('needs two hits for a warden, flashing each time', () => {
    const a = createAlien('warden', 1, 0, 0, 0, 0);
    expect(damageAlien(a)).toBe(false);
    expect(a.flash).toBe(HIT_FLASH_SECONDS);
    expect(damageAlien(a)).toBe(true);
  });

  it('kills a drone in one', () => {
    expect(damageAlien(createAlien('drone', 1, 0, 0, 0, 0))).toBe(true);
  });

  it('lets the flash run out', () => {
    const a = createAlien('drone', 1, 0, 0, 0, 0);
    damageAlien(a);
    for (let t = 0; t < HIT_FLASH_SECONDS + 0.05; t += DT) stepAlien(a, { x: 0, y: 0 }, DT);
    expect(a.flash).toBe(0);
  });
});

describe('basePoints', () => {
  it('doubles a diver while it is diving', () => {
    const d = createAlien('diver', 1, 0, 0, 0, 0);
    expect(basePoints(d)).toBe(40);
    startDive(d, 0);
    expect(basePoints(d)).toBe(80);
    expect(basePoints(createAlien('drone', 2, 0, 0, 0, 0))).toBe(10);
  });
});

describe('formation mode', () => {
  it('sits on its slot', () => {
    const a = createAlien('drone', 1, 0, 0, 0, 0);
    stepAlien(a, { x: 12, y: 34 }, DT);
    expect(a).toMatchObject({ x: 12, y: 34 });
  });
});

describe('dives', () => {
  it('starts where the alien is and ends below the ship row at the target', () => {
    const path = { fromX: 20, fromY: 90, toX: -30 };
    expect(divePosition(path, 0)).toEqual({ x: 20, y: 90 });
    const end = divePosition(path, 1);
    expect(end.x).toBeCloseTo(-30, 6);
    expect(end.y).toBe(DIVE_END_Y);
    expect(DIVE_END_Y).toBeLessThan(SHIP_Y);
  });

  it('only ever goes down', () => {
    const path = { fromX: 0, fromY: 90, toX: 40 };
    let last = Infinity;
    for (let u = 0; u <= 1; u += 0.01) {
      const { y } = divePosition(path, u);
      expect(y).toBeLessThanOrEqual(last);
      last = y;
    }
  });

  it('clamps the target to the field', () => {
    const d = createAlien('diver', 1, 0, 0, 0, 50);
    startDive(d, 500);
    expect(d.dive?.toX).toBeLessThan(90);
  });

  it('follows its path, then returns to its slot and rejoins the formation', () => {
    const d = createAlien('diver', 1, 0, 0, 10, 100);
    startDive(d, -40);
    expect(d.mode).toBe('diving');
    const slot = { x: 10, y: 100 };
    for (let t = 0; t < DIVE_SECONDS - 0.05; t += DT) stepAlien(d, slot, DT);
    expect(d.mode).toBe('diving');
    expect(d.y).toBeLessThan(SHIP_Y + 30);
    for (let t = 0; t < 0.1; t += DT) stepAlien(d, slot, DT);
    expect(d.mode).toBe('returning');
    expect(d.dive).toBeUndefined();
    const flightSeconds = (100 - DIVE_END_Y) / RETURN_SPEED;
    for (let t = 0; t < flightSeconds + 1; t += DT) stepAlien(d, slot, DT);
    expect(d.mode).toBe('formation');
    expect(d).toMatchObject({ x: 10, y: 100 });
  });
});

describe('carrier', () => {
  it('is slow and tough: 4 hit points, 60 points, a wide box', () => {
    expect(ALIEN_SPECS.carrier).toEqual({ hp: 4, points: 60, halfWidth: 10, halfHeight: 7 });
    expect(createAlien('carrier', 1, 0, 0, 0, 0).hp).toBe(4);
  });

  it('needs four hits to kill', () => {
    const a = createAlien('carrier', 1, 0, 0, 0, 0);
    expect([damageAlien(a), damageAlien(a), damageAlien(a), damageAlien(a)]).toEqual([false, false, false, true]);
  });
});

describe('carrier in a run', () => {
  it('stays in the formation and never dives, even when dives are constant', () => {
    const wave = WAVES[0];
    const saved = wave.diveRate;
    wave.diveRate = 50;
    try {
      const run = createRun(7);
      chooseSpecial(run, 'pulseBomb');
      for (const a of run.aliens) a.kind = 'carrier';
      for (let t = 0; t < 8; t += DT) {
        stepRun(run, [{ move: 0, drag: 0, fire: false, special: false }], DT);
        if (run.phase === 'lost') break;
        expect(run.aliens.every((a) => a.mode === 'formation')).toBe(true);
      }
    } finally {
      wave.diveRate = saved;
    }
  });
});

describe('splitter and mini specs', () => {
  it('makes a splitter a bit bigger than a drone, with two hit points', () => {
    expect(ALIEN_SPECS.splitter.hp).toBe(2);
    expect(ALIEN_SPECS.splitter.halfWidth).toBeGreaterThan(ALIEN_SPECS.drone.halfWidth);
    expect(ALIEN_SPECS.splitter.halfHeight).toBeGreaterThan(ALIEN_SPECS.drone.halfHeight);
    expect(damageAlien(createAlien('splitter', 1, 0, 0, 0, 0))).toBe(false);
  });

  it('makes a mini small, one hit point and few points', () => {
    expect(ALIEN_SPECS.mini.hp).toBe(1);
    expect(ALIEN_SPECS.mini.halfWidth).toBeLessThan(ALIEN_SPECS.drone.halfWidth);
    expect(ALIEN_SPECS.mini.halfHeight).toBeLessThan(ALIEN_SPECS.drone.halfHeight);
    expect(ALIEN_SPECS.mini.points).toBeLessThanOrEqual(ALIEN_SPECS.drone.points);
    expect(damageAlien(createAlien('mini', 1, -1, -1, 0, 0))).toBe(true);
  });
});

describe('splitAlien', () => {
  const splitter = () => createAlien('splitter', 7, 2, 1, 12, 60);

  it('makes two free minis at the splitter, flying down and outward', () => {
    let n = 100;
    const minis = splitAlien(splitter(), () => ++n);
    expect(minis).toHaveLength(2);
    expect(minis.map((m) => m.id)).toEqual([101, 102]);
    for (const m of minis) {
      expect(m).toMatchObject({ kind: 'mini', hp: 1, mode: 'free', col: -1, row: -1 });
      expect(m.y).toBe(60);
      expect(Math.abs(m.x - 12)).toBeGreaterThan(0);
      expect(Math.abs(m.x - 12)).toBeLessThan(8);
      expect(m.vy).toBeLessThan(0);
    }
    const [left, right] = minis;
    expect(left.vx).toBe(-MINI_SPREAD_VX);
    expect(right.vx).toBe(MINI_SPREAD_VX);
    expect(left.x).toBeLessThan(right.x);
  });

  it('flies the minis apart and down under stepFreeAlien, and they keep going until they leave', () => {
    const [left, right] = splitAlien(splitter(), (() => { let n = 0; return () => ++n; })());
    for (let i = 0; i < 60; i++) {
      stepFreeAlien(left, null, DT * 2);
      stepFreeAlien(right, null, DT * 2);
    }
    expect(right.x - left.x).toBeGreaterThan(10);
    expect(left.y).toBeLessThan(60);
    for (let i = 0; i < 120 * 10 && !freeAlienGone(left); i++) stepFreeAlien(left, null, DT);
    expect(freeAlienGone(left)).toBe(true);
  });

  it('does not touch the splitter', () => {
    const s = splitter();
    splitAlien(s, () => 1);
    expect(s).toMatchObject({ kind: 'splitter', hp: 2, mode: 'formation', x: 12, y: 60 });
  });
});

describe('startPairedDive', () => {
  it('sends two divers to either side of the target, mirrored', () => {
    const a = createAlien('diver', 1, 1, 1, -12, 50);
    const b = createAlien('diver', 2, 2, 1, 12, 50);
    startPairedDive(a, b, 0);
    expect(a.mode).toBe('diving');
    expect(b.mode).toBe('diving');
    expect(a.dive?.toX).toBe(-PAIR_DIVE_SPREAD);
    expect(b.dive?.toX).toBe(PAIR_DIVE_SPREAD);
    // Same moment, same path length, so they bottom out together side by side.
    const end = [divePosition(a.dive!, 1), divePosition(b.dive!, 1)];
    expect(end[0].y).toBeCloseTo(end[1].y, 6);
    expect(end[1].x - end[0].x).toBeCloseTo(2 * PAIR_DIVE_SPREAD, 6);
  });

  it('boxes in a still ship at the target: at least one diver hits it along the way', () => {
    const a = createAlien('diver', 1, 1, 1, -12, 50);
    const b = createAlien('diver', 2, 2, 1, 12, 50);
    startPairedDive(a, b, 0);
    const ship = { x: 0, y: SHIP_Y + SHIP_BOX_OFFSET_Y, halfWidth: SHIP_HALF_WIDTH, halfHeight: SHIP_HALF_HEIGHT };
    let hit = false;
    for (let t = 0; t <= DIVE_SECONDS; t += DT) {
      for (const d of [a, b]) {
        const pos = divePosition(d.dive!, t / DIVE_SECONDS);
        if (overlaps(ship, { x: pos.x, y: pos.y, halfWidth: ALIEN_SPECS.diver.halfWidth, halfHeight: ALIEN_SPECS.diver.halfHeight })) hit = true;
      }
    }
    expect(hit).toBe(true);
  });
});
