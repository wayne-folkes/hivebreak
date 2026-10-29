import { describe, expect, it } from 'vitest';
import { nearestPaletteIndex, PALETTE } from './palette';

describe('palette', () => {
  it('has about two dozen distinct colours', () => {
    expect(PALETTE.length).toBe(24);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it('maps every palette colour to itself', () => {
    PALETTE.forEach((c, i) => {
      expect(nearestPaletteIndex((c >> 16) & 255, (c >> 8) & 255, c & 255)).toBe(i);
    });
  });

  it('snaps near-colours to the closest entry', () => {
    const white = PALETTE.indexOf(0xffffff);
    expect(nearestPaletteIndex(250, 252, 255)).toBe(white);
    expect(nearestPaletteIndex(8, 5, 14)).toBe(0);
  });

  it('works with a custom palette', () => {
    expect(nearestPaletteIndex(200, 10, 10, [0x000000, 0xff0000, 0x00ff00])).toBe(1);
  });
});
