import { describe, expect, it } from 'vitest';
import { MAX_ARC_POINTS, arcPointCount, arcPoints, arcThickness, stripVertices } from './arcs';

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('arc points', () => {
  it('starts and ends exactly on the two aliens', () => {
    const out = new Float32Array(MAX_ARC_POINTS * 2);
    const n = arcPoints(-30, 40, 25, -10, seeded(1), out);
    expect(out[0]).toBe(-30);
    expect(out[1]).toBe(40);
    expect(out[(n - 1) * 2]).toBe(25);
    expect(out[(n - 1) * 2 + 1]).toBe(-10);
  });

  it('gives longer arcs more points, within the buffer and with a kink in the middle at least', () => {
    expect(arcPointCount(0)).toBeGreaterThanOrEqual(4);
    expect(arcPointCount(30)).toBeLessThan(arcPointCount(60));
    expect(arcPointCount(10000)).toBe(MAX_ARC_POINTS);
  });

  it('keeps every point near the straight line, and jags it', () => {
    const out = new Float32Array(MAX_ARC_POINTS * 2);
    const n = arcPoints(0, 0, 60, 0, seeded(7), out);
    let jagged = false;
    for (let i = 0; i < n; i++) {
      expect(Math.abs(out[i * 2 + 1])).toBeLessThanOrEqual(5.0001);
      if (i > 0 && i < n - 1 && Math.abs(out[i * 2 + 1]) > 0.1) jagged = true;
    }
    expect(jagged).toBe(true);
  });

  it('is repeatable with the same random source, and a zero-length arc does not blow up', () => {
    const a = new Float32Array(MAX_ARC_POINTS * 2);
    const b = new Float32Array(MAX_ARC_POINTS * 2);
    arcPoints(1, 2, 40, 30, seeded(3), a);
    arcPoints(1, 2, 40, 30, seeded(3), b);
    expect(Array.from(a)).toEqual(Array.from(b));
    const n = arcPoints(5, 5, 5, 5, seeded(3), a);
    for (let i = 0; i < n * 2; i++) expect(Number.isFinite(a[i])).toBe(true);
  });
});

describe('strip vertices', () => {
  it('puts the two vertices of a point half a width either side of a straight line', () => {
    const points = new Float32Array([0, 0, 10, 0, 20, 0]);
    const out = new Float32Array(18);
    stripVertices(points, 3, 1.5, 2, out);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 6]).toBeCloseTo(i * 10);
      expect(out[i * 6 + 3]).toBeCloseTo(i * 10);
      expect(Math.abs(out[i * 6 + 1] - out[i * 6 + 4])).toBeCloseTo(3);
      expect(out[i * 6 + 2]).toBe(2);
    }
  });
});

describe('arc thickness', () => {
  it('stays full for half its life and then thins to nothing', () => {
    expect(arcThickness(0)).toBe(1);
    expect(arcThickness(0.5)).toBe(1);
    expect(arcThickness(0.75)).toBeCloseTo(0.5);
    expect(arcThickness(1)).toBe(0);
  });
});
