import { describe, expect, it } from 'vitest';
import {
  SWIRL_RADIUS,
  WELL_COLLAPSE_SECONDS,
  WELL_GHOST_SECONDS,
  WELL_GROW_SECONDS,
  easeOutBack,
  ghostScale,
  swirlPoint,
  wellScale,
} from './wellview';

describe('well scale', () => {
  it('grows from nothing to full size over its first quarter second, with a little overshoot', () => {
    expect(wellScale(0, 3)).toBe(0);
    expect(wellScale(WELL_GROW_SECONDS, 3)).toBeCloseTo(1);
    let peak = 0;
    for (let a = 0; a <= WELL_GROW_SECONDS; a += 0.005) peak = Math.max(peak, wellScale(a, 3));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.3);
  });

  it('stays full size through the middle of its life', () => {
    expect(wellScale(1.5, 1.5)).toBeCloseTo(1);
    expect(wellScale(2.6, WELL_COLLAPSE_SECONDS)).toBeCloseTo(1);
  });

  it('collapses to nothing over its last moments', () => {
    const a = wellScale(2.8, WELL_COLLAPSE_SECONDS * 0.5);
    const b = wellScale(2.9, WELL_COLLAPSE_SECONDS * 0.2);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
    expect(wellScale(3, 0)).toBe(0);
    expect(wellScale(3, -0.1)).toBe(0);
  });

  it('shrinks a well that was cut short from where it stood', () => {
    expect(ghostScale(0.8, WELL_GHOST_SECONDS)).toBeCloseTo(0.8);
    expect(ghostScale(0.8, WELL_GHOST_SECONDS / 2)).toBeLessThan(0.8);
    expect(ghostScale(0.8, 0)).toBe(0);
  });

  it('easeOutBack runs 0 to 1', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(easeOutBack(2)).toBeCloseTo(1);
  });
});

describe('swirl', () => {
  const out = { x: 0, y: 0, s: 0 };

  it('keeps every mote inside the well reach, and always finite', () => {
    for (let i = 0; i < 28; i++) {
      for (let t = 0; t < 5; t += 0.07) {
        swirlPoint(i, t, out);
        expect(Math.hypot(out.x, out.y)).toBeLessThanOrEqual(SWIRL_RADIUS + 1e-6);
        expect(out.s).toBeGreaterThanOrEqual(0);
        expect(out.s).toBeLessThanOrEqual(1);
      }
    }
  });

  it('spirals inward: over most of a pass the mote only gets closer to the centre', () => {
    let last = Infinity;
    let inward = 0;
    let steps = 0;
    for (let t = 0; t < 1.0; t += 0.02) {
      swirlPoint(0, t, out);
      const r = Math.hypot(out.x, out.y);
      if (t > 0.05 && r < last) inward++;
      if (t > 0.05) steps++;
      last = r;
    }
    expect(inward / steps).toBeGreaterThan(0.8);
  });
});
