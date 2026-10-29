import { describe, expect, it } from 'vitest';
import { FIELD_HEIGHT, FIELD_WIDTH, fitPlayfield } from './playfield';

describe('fitPlayfield', () => {
  it('scales by whole pixels on a portrait phone and leaves the spare height below', () => {
    // iPhone-sized viewport: 390 x 844 CSS pixels at 3x.
    const fit = fitPlayfield(390, 844, 3);
    expect(fit.scale).toBe(6);
    expect(fit.width).toBe((FIELD_WIDTH * 6) / 3);
    expect(fit.height).toBe((FIELD_HEIGHT * 6) / 3);
    expect(fit.top).toBe(0);
    expect(fit.height).toBeLessThan(844);
  });

  it('letterboxes and centres on a wide desktop window', () => {
    const fit = fitPlayfield(1440, 900, 2);
    expect(fit.scale).toBe(5);
    expect(fit.height).toBe(800);
    expect(fit.left).toBe((1440 - fit.width) / 2);
    expect(fit.top).toBe(50);
  });

  it('shrinks below one screen pixel per art pixel on a tiny viewport', () => {
    const fit = fitPlayfield(90, 160, 1);
    expect(fit.scale).toBe(0.5);
    expect(fit.width).toBe(90);
  });
});
