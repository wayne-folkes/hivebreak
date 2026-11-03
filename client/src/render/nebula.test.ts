import { describe, expect, it } from 'vitest';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import { BLOBS3, NEBULA3_LEVELS, NEBULA_BLOCK, NEBULA_LEVELS, buildNebula, nebulaDensity, nebulaLevel } from './nebula';
import { PALETTE } from './palette';

describe('nebula', () => {
  it('is densest in the middle of a blob and fades to nothing far from them', () => {
    expect(nebulaDensity(40, 90)).toBeGreaterThan(nebulaDensity(100, 90));
    expect(nebulaLevel(nebulaDensity(179, 319))).toBe(0);
  });

  it('turns density into a few flat levels', () => {
    expect(nebulaLevel(0)).toBe(0);
    expect(nebulaLevel(0.2)).toBe(1);
    expect(nebulaLevel(0.4)).toBe(2);
    expect(nebulaLevel(2)).toBe(NEBULA_LEVELS.length);
  });

  it('builds the same texture every time, with only palette colours, in whole blocks', () => {
    const a = buildNebula();
    expect(a.length).toBe(FIELD_WIDTH * FIELD_HEIGHT * 4);
    expect(buildNebula()).toEqual(a);
    const seen = new Set<number>();
    let covered = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0) continue;
      covered++;
      seen.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    }
    expect(covered).toBeGreaterThan(FIELD_WIDTH * FIELD_HEIGHT * 0.1);
    expect(covered).toBeLessThan(FIELD_WIDTH * FIELD_HEIGHT * 0.9);
    for (const c of seen) expect(PALETTE).toContain(c);
    // The first block's pixels (top-left, so the top row of the texture) all match.
    const top = (FIELD_HEIGHT - 1) * FIELD_WIDTH * 4;
    for (let x = 1; x < NEBULA_BLOCK; x++) expect(a[top + x * 4 + 3]).toBe(a[top + 3]);
  });

  it('builds sector 3\'s green nebula from palette colours, in clouds of its own', () => {
    const green = buildNebula(FIELD_WIDTH, FIELD_HEIGHT, NEBULA_BLOCK, NEBULA3_LEVELS, BLOBS3);
    const red = buildNebula();
    expect(green).not.toEqual(red);
    let covered = 0;
    for (let i = 0; i < green.length; i += 4) {
      if (green[i + 3] === 0) continue;
      covered++;
      expect(PALETTE).toContain((green[i] << 16) | (green[i + 1] << 8) | green[i + 2]);
    }
    expect(covered).toBeGreaterThan(FIELD_WIDTH * FIELD_HEIGHT * 0.08);
    expect(covered).toBeLessThan(FIELD_WIDTH * FIELD_HEIGHT * 0.7);
  });
});
