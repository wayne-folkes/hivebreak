import { describe, expect, it } from 'vitest';
import { FIELD_WIDTH } from './playfield';
import { HOMING_MIN_ELEVATION, stepShot } from './shots';
import { SEEKERS_HOMING_CAP } from './synergies';
import type { Shot } from './types';

const DT = 1 / 120;
const W = FIELD_WIDTH / 2;

const shot = (over: Partial<Shot> = {}): Shot => ({
  id: 1, owner: 'player', kind: 'normal', playerId: 0, x: 0, y: 0, vx: 0, vy: 260, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: 1, ...over,
});

describe('stepShot', () => {
  it('flies straight by default', () => {
    const s = shot({ vx: 30 });
    stepShot(s, [{ x: 50, y: 100 }], 0.1);
    expect(s.x).toBeCloseTo(3, 6);
    expect(s.y).toBeCloseTo(26, 6);
    expect(s.vx).toBe(30);
  });

  it('flies enemy shots straight even if they have homing', () => {
    const s = shot({ owner: 'alien', kind: 'enemy', vx: 0, vy: -90, homing: 5 });
    stepShot(s, [{ x: 50, y: -200 }], DT);
    expect(s.vx).toBe(0);
  });
});

describe('homing', () => {
  it('turns toward a target off to the side, keeping its speed', () => {
    const s = shot({ homing: 2.5 });
    const speed = Math.hypot(s.vx, s.vy);
    for (let i = 0; i < 20; i++) stepShot(s, [{ x: 60, y: 120 }], DT);
    expect(s.vx).toBeGreaterThan(0);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(speed, 6);
    const left = shot({ homing: 2.5 });
    for (let i = 0; i < 20; i++) stepShot(left, [{ x: -60, y: 120 }], DT);
    expect(left.vx).toBeLessThan(0);
  });

  it('turns at no more than its rate', () => {
    const s = shot({ homing: 2 });
    stepShot(s, [{ x: 200, y: 10 }], DT);
    const angle = Math.atan2(s.vx, s.vy);
    expect(angle).toBeCloseTo(2 * DT, 5);
  });

  it('picks the nearest target above it and ignores ones below', () => {
    const s = shot({ homing: 2.5, y: 50 });
    for (let i = 0; i < 20; i++) stepShot(s, [{ x: -80, y: 0 }, { x: 40, y: 200 }, { x: -20, y: 90 }], DT);
    expect(s.vx).toBeLessThan(0);
    const only = shot({ homing: 2.5, y: 50 });
    for (let i = 0; i < 20; i++) stepShot(only, [{ x: 80, y: 0 }], DT);
    expect(only.vx).toBe(0);
  });

  it('with no targets flies straight', () => {
    const s = shot({ homing: 5 });
    stepShot(s, [], DT);
    expect(s.vx).toBe(0);
  });

  it('closes in on a target and eventually reaches it', () => {
    const s = shot({ homing: 4, x: -30 });
    const target = { x: 20, y: 140 };
    let best = Infinity;
    for (let i = 0; i < 120 && s.y < target.y; i++) {
      stepShot(s, [target], DT);
      best = Math.min(best, Math.abs(s.x - target.x));
    }
    expect(best).toBeLessThan(3);
  });

  it('never steers below a minimum elevation', () => {
    const s = shot({ homing: 50 });
    for (let i = 0; i < 20; i++) stepShot(s, [{ x: 500, y: 1 }], DT);
    expect(Math.atan2(s.vy, s.vx)).toBeGreaterThanOrEqual(HOMING_MIN_ELEVATION - 1e-9);
  });
});

describe('ricochet', () => {
  it('bounces off the right wall and uses up a bounce', () => {
    const s = shot({ x: W - 0.5, vx: 60, bouncesLeft: 2 });
    stepShot(s, [], 0.1);
    expect(s.vx).toBe(-60);
    expect(s.x).toBeLessThan(W);
    expect(s.x).toBeCloseTo(W - 5.5, 6);
    expect(s.bouncesLeft).toBe(1);
    expect(s.bounces).toBe(1);
  });

  it('bounces off the left wall', () => {
    const s = shot({ x: -W + 0.5, vx: -60, bouncesLeft: 1 });
    stepShot(s, [], 0.1);
    expect(s.vx).toBe(60);
    expect(s.bouncesLeft).toBe(0);
  });

  it('flies on through the wall once it has no bounces left', () => {
    const s = shot({ x: W - 0.5, vx: 60, bouncesLeft: 0 });
    stepShot(s, [], 0.1);
    expect(s.vx).toBe(60);
    expect(s.x).toBeGreaterThan(W);
  });

  it('does not boost a bounce without the seekers flag', () => {
    const s = shot({ x: W - 0.5, vx: 60, bouncesLeft: 1, homing: 2.5 });
    stepShot(s, [], 0.1);
    expect(s.homing).toBe(2.5);
    expect(s.bouncesLeft).toBe(0);
  });
});

describe('seekers', () => {
  it('doubles homing and adds a bounce on the first bounce only', () => {
    const s = shot({ x: W - 0.5, vx: 60, bouncesLeft: 1, homing: 2.5 });
    stepShot(s, [], 0.1, true);
    expect(s.homing).toBe(5);
    expect(s.bouncesLeft).toBe(1);
    // Bounce again off the left wall: no further boost, and the bounce is used up.
    s.x = -W + 0.5;
    s.vx = -60;
    stepShot(s, [], 0.1, true);
    expect(s.homing).toBe(5);
    expect(s.bouncesLeft).toBe(0);
    expect(s.bounces).toBe(2);
  });

  it('caps the boosted homing', () => {
    const s = shot({ x: W - 0.5, vx: 60, bouncesLeft: 1, homing: SEEKERS_HOMING_CAP });
    stepShot(s, [], 0.1, true);
    expect(s.homing).toBe(SEEKERS_HOMING_CAP);
  });
});
