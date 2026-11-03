import { describe, expect, it } from 'vitest';
import { WARP_GHOST_SECONDS, ghostScale, warpProgress, warpScale, warpTint } from './warp';

describe('warp-in', () => {
  it('runs from 0 as the Warper lands to 1 when its warp runs out', () => {
    expect(warpProgress(0.35, 0.35)).toBe(0);
    expect(warpProgress(0.175, 0.35)).toBeCloseTo(0.5);
    expect(warpProgress(0, 0.35)).toBe(1);
    expect(warpProgress(undefined, 0.35)).toBe(1);
  });

  it('grows from small to full size, overshooting a little on the way', () => {
    expect(warpScale(0)).toBeLessThan(0.3);
    expect(warpScale(1)).toBe(1);
    let peak = 0;
    for (let p = 0; p < 1; p += 0.02) peak = Math.max(peak, warpScale(p));
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(1.25);
  });

  it('flashes white as it lands, flickers teal, and ends in its own colours', () => {
    expect(warpTint(0.05, 0)).toBe('white');
    expect(warpTint(0.3, 0)).toBe('teal');
    expect(warpTint(0.3, 2)).toBe('teal');
    expect(warpTint(0.7, 2)).toBe('none');
    expect(warpTint(0.7, 0)).toBe('teal');
    expect(warpTint(0.95, 0)).toBe('none');
    expect(warpTint(1, 0)).toBe('none');
  });

  it('shrinks an afterimage to nothing', () => {
    expect(ghostScale(0)).toBe(1);
    expect(ghostScale(WARP_GHOST_SECONDS)).toBe(0);
    expect(ghostScale(WARP_GHOST_SECONDS * 2)).toBe(0);
  });
});
