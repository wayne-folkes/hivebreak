import { describe, expect, it } from 'vitest';
import {
  ALIEN_SPECS,
  DIVE_END_Y,
  DIVE_SECONDS,
  HIT_FLASH_SECONDS,
  RETURN_SPEED,
  alienBox,
  basePoints,
  createAlien,
  damageAlien,
  divePosition,
  startDive,
  stepAlien,
} from './aliens';
import { SHIP_Y } from './player';

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
