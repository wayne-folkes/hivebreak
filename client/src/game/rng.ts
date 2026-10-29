// A small seeded random number generator (mulberry32), so a run with the same seed and the
// same inputs plays out the same way, and tests can pin exact outcomes.

export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number in [0, n). */
  int(n: number): number;
  /** A number in [min, max). */
  range(min: number, max: number): number;
  /** One item of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}
