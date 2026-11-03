import { describe, expect, it } from 'vitest';
import { nearestPaletteIndex, PALETTE } from './palette';

describe('palette', () => {
  it('has a small set of distinct colours', () => {
    expect(PALETTE.length).toBe(57);
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

  it('keeps sector 2\'s reds, and appends them after the sector 1 palette', () => {
    expect(PALETTE.slice(0, 28)[0]).toBe(0x07040f);
    expect(PALETTE.indexOf(0x4fff9b)).toBe(24);
    for (const red of [0x12040a, 0x4a0f24, 0xc0392b, 0xd04a64, 0xff5a5a, 0x3fd6a0]) {
      expect(PALETTE.indexOf(red)).toBeGreaterThanOrEqual(28);
      expect(nearestPaletteIndex((red >> 16) & 255, (red >> 8) & 255, red & 255)).toBe(PALETTE.indexOf(red));
    }
  });

  it('keeps sector 3\'s acid greens, golds and teal, appended after sector 2\'s palette', () => {
    for (const c of [0x090f05, 0x18290c, 0xc6f23c, 0x4f6e18, 0xf5c542, 0x8a6a1a, 0x3fe8d0]) {
      expect(PALETTE.indexOf(c)).toBeGreaterThanOrEqual(44);
      expect(nearestPaletteIndex((c >> 16) & 255, (c >> 8) & 255, c & 255)).toBe(PALETTE.indexOf(c));
    }
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
