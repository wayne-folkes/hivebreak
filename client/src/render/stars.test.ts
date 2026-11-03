import { describe, expect, it } from 'vitest';
import { sectorWeights } from './stars';

describe('sectorWeights', () => {
  it('is all of one sector at 0, 1 and 2', () => {
    expect(sectorWeights(0, [])).toEqual([1, 0, 0]);
    expect(sectorWeights(1, [])).toEqual([0, 1, 0]);
    expect(sectorWeights(2, [])).toEqual([0, 0, 1]);
  });

  it('blends the two sectors either side of a value between, never the third, and always adds up to 1', () => {
    const early = sectorWeights(0.25, []);
    expect(early[2]).toBe(0);
    expect(early[0]).toBeCloseTo(0.75);
    const late = sectorWeights(1.5, []);
    expect(late[0]).toBe(0);
    expect(late[1]).toBeCloseTo(0.5);
    expect(late[2]).toBeCloseTo(0.5);
    for (let b = -0.5; b < 2.6; b += 0.1) {
      const w = sectorWeights(b, []);
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1);
    }
  });
});
