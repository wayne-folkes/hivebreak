import { describe, expect, it } from 'vitest';
import { dropsTrail, exhaustScale, missileAngle } from './missile';

describe('missile orientation', () => {
  it('points the nose along the velocity', () => {
    expect(missileAngle(0, 100)).toBeCloseTo(0);
    // Flying up and to the right tips the nose clockwise: a negative rotation about z.
    expect(missileAngle(100, 100)).toBeCloseTo(-Math.PI / 4);
    expect(missileAngle(-100, 100)).toBeCloseTo(Math.PI / 4);
    expect(Math.abs(missileAngle(0, -100))).toBeCloseTo(Math.PI);
  });

  it('keeps its facing when it is not moving', () => {
    expect(missileAngle(0, 0, 0.7)).toBe(0.7);
  });
});

describe('exhaust', () => {
  it('always stretches (never flips) and varies with time and between missiles', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let t = 0; t < 2; t += 0.01) {
      const s = exhaustScale(t, 3);
      min = Math.min(min, s);
      max = Math.max(max, s);
    }
    expect(min).toBeGreaterThan(0.4);
    expect(max).toBeGreaterThan(1.3);
    expect(exhaustScale(0.5, 1)).not.toBe(exhaustScale(0.5, 2));
  });

  it('drops a trail every other frame, staggered by id', () => {
    expect(dropsTrail(0, 0)).not.toBe(dropsTrail(1, 0));
    expect(dropsTrail(4, 1)).not.toBe(dropsTrail(4, 2));
  });
});
