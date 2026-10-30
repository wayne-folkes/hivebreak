import { describe, expect, it } from 'vitest';
import { nearestPaletteIndex, PALETTE } from './palette';

describe('palette', () => {
  it('has a small set of distinct colours', () => {
    expect(PALETTE.length).toBe(28);
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it('maps every palette colour to itself', () => {
    PALETTE.forEach((c, i) => {
      expect(nearestPaletteIndex((c >> 16) & 255, (c >> 8) & 255, c & 255)).toBe(i);
    });
  });

  it('keeps the Helper green and the Slow purple apart from cyan and lavender', () => {
    expect(PALETTE).toContain(0x4fff9b);
    expect(PALETTE).toContain(0x9b7bff);
    expect(nearestPaletteIndex(0x4f, 0xff, 0x9b)).toBe(PALETTE.indexOf(0x4fff9b));
    expect(nearestPaletteIndex(0x9b, 0x7b, 0xff)).toBe(PALETTE.indexOf(0x9b7bff));
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
