import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays in range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const k = rng.int(5);
      expect(Number.isInteger(k) && k >= 0 && k < 5).toBe(true);
      const r = rng.range(-3, 3);
      expect(r >= -3 && r < 3).toBe(true);
    }
    expect(['a', 'b', 'c']).toContain(rng.pick(['a', 'b', 'c']));
  });
});
