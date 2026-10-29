import { describe, expect, it } from 'vitest';
import { createAlien } from './aliens';
import { firstAlienHit, overlaps, shotBox } from './collision';
import type { Shot } from './types';

const shotAt = (x: number, y: number): Shot => ({ id: 1, owner: 'player', playerId: 0, x, y, vx: 0, vy: 260, pierceLeft: 0, hits: 0, volley: 0 });

describe('overlaps', () => {
  const a = { x: 0, y: 0, halfWidth: 5, halfHeight: 5 };

  it('is true for boxes that share space', () => {
    expect(overlaps(a, { x: 6, y: 0, halfWidth: 2, halfHeight: 2 })).toBe(true);
    expect(overlaps(a, a)).toBe(true);
  });

  it('is false for boxes that only touch or are apart', () => {
    expect(overlaps(a, { x: 7, y: 0, halfWidth: 2, halfHeight: 2 })).toBe(false);
    expect(overlaps(a, { x: 0, y: 20, halfWidth: 2, halfHeight: 2 })).toBe(false);
  });
});

describe('firstAlienHit', () => {
  it('finds the alien a shot is touching', () => {
    const drone = createAlien('drone', 1, 0, 0, 0, 50);
    expect(firstAlienHit(shotAt(3, 50), [drone])).toBe(drone);
    expect(firstAlienHit(shotAt(20, 50), [drone])).toBeNull();
    expect(firstAlienHit(shotAt(0, 80), [drone])).toBeNull();
  });

  it('prefers the lowest alien when a shot touches two', () => {
    const upper = createAlien('drone', 1, 0, 0, 0, 55);
    const lower = createAlien('drone', 2, 0, 1, 0, 47);
    expect(firstAlienHit(shotAt(0, 51), [upper, lower])).toBe(lower);
  });

  it('ignores aliens with no hit points left', () => {
    const dead = createAlien('drone', 1, 0, 0, 0, 50);
    dead.hp = 0;
    expect(firstAlienHit(shotAt(0, 50), [dead])).toBeNull();
  });

  it('gives a narrow box for a shot', () => {
    expect(shotBox(shotAt(4, 5))).toMatchObject({ x: 4, y: 5 });
    expect(shotBox(shotAt(0, 0)).halfWidth).toBeLessThan(shotBox(shotAt(0, 0)).halfHeight);
  });
});
