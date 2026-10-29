import { describe, expect, it } from 'vitest';
import { approachAngle, lerp, Tracker, wrapAngle } from './interp';
import type { Sample } from './interp';

const out = (): Sample => ({ x: 0, y: 0, dx: 0, dy: 0 });

describe('lerp and angles', () => {
  it('blends linearly', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it('wraps angles to [-PI, PI)', () => {
    expect(wrapAngle(0)).toBeCloseTo(0);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(Math.PI / 2);
    expect(wrapAngle(-3 * Math.PI / 2)).toBeCloseTo(Math.PI / 2);
  });

  it('approaches an angle the short way round', () => {
    const next = approachAngle(Math.PI - 0.1, -Math.PI + 0.1, 1000, 1);
    expect(Math.abs(wrapAngle(next - (-Math.PI + 0.1)))).toBeLessThan(0.01);
    // A small step moves part of the way.
    const part = approachAngle(0, 1, 5, 0.1);
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(1);
  });
});

describe('Tracker', () => {
  it('blends between the last two steps', () => {
    const t = new Tracker();
    t.begin();
    t.push(1, 0, 0);
    t.end();
    t.begin();
    t.push(1, 10, -4);
    t.end();
    const s = out();
    expect(t.sample(1, 0.5, s)).toBe(true);
    expect(s).toEqual({ x: 5, y: -2, dx: 10, dy: -4 });
    t.sample(1, 0, s);
    expect(s.x).toBe(0);
    t.sample(1, 1, s);
    expect(s.x).toBe(10);
  });

  it('shows a new id where it is, without blending', () => {
    const t = new Tracker();
    t.begin();
    t.push(7, 50, 60);
    t.end();
    const s = out();
    t.sample(7, 0.3, s);
    expect(s).toEqual({ x: 50, y: 60, dx: 0, dy: 0 });
  });

  it('forgets ids that were not pushed in a step', () => {
    const t = new Tracker();
    t.begin();
    t.push(1, 0, 0);
    t.push(2, 5, 5);
    t.end();
    t.begin();
    t.push(2, 6, 5);
    t.end();
    const s = out();
    expect(t.sample(1, 0.5, s)).toBe(false);
    expect(t.sample(2, 0.5, s)).toBe(true);
  });

  it('reports unknown ids and clears', () => {
    const t = new Tracker();
    expect(t.sample(9, 0, out())).toBe(false);
    t.begin();
    t.push(1, 0, 0);
    t.end();
    t.clear();
    expect(t.sample(1, 0, out())).toBe(false);
  });
});
