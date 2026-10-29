import { describe, expect, it } from 'vitest';
import { FIELD_WIDTH } from './playfield';
import { SLOT_SPACING_X } from './formation';
import { WAVES, WAVE_COUNT, waveAlienCount, waveColumns } from './waves';

describe('WAVES', () => {
  it('has five waves', () => {
    expect(WAVE_COUNT).toBe(5);
  });

  it('fits every formation in at most 6 columns and 5 rows, with room to march', () => {
    for (const w of WAVES) {
      expect(waveColumns(w)).toBeLessThanOrEqual(6);
      expect(w.rows.length).toBeLessThanOrEqual(5);
      expect((waveColumns(w) - 1) * SLOT_SPACING_X + 16).toBeLessThan(FIELD_WIDTH - 12);
    }
  });

  it('uses only known alien letters', () => {
    for (const w of WAVES) for (const row of w.rows) expect(row).toMatch(/^[dwv.]+$/);
  });

  it('brings in wardens from wave 2 and divers from wave 3', () => {
    const kinds = (i: number) => new Set(WAVES[i].rows.join(''));
    expect(kinds(0).has('w') || kinds(0).has('v')).toBe(false);
    expect(kinds(1).has('w')).toBe(true);
    expect(kinds(1).has('v')).toBe(false);
    expect(kinds(2).has('v')).toBe(true);
    expect(kinds(4).has('w') && kinds(4).has('v') && kinds(4).has('d')).toBe(true);
  });

  it('only has divers dive when the wave has some', () => {
    for (const w of WAVES) if (w.diveRate > 0) expect(w.rows.join('')).toContain('v');
  });

  it('gets harder: more aliens, faster, more shots', () => {
    for (let i = 1; i < WAVES.length; i++) {
      expect(waveAlienCount(WAVES[i])).toBeGreaterThanOrEqual(waveAlienCount(WAVES[i - 1]));
      expect(WAVES[i].marchSpeed).toBeGreaterThan(WAVES[i - 1].marchSpeed);
      expect(WAVES[i].fireRate).toBeGreaterThan(WAVES[i - 1].fireRate);
    }
  });
});

describe('waveAlienCount', () => {
  it('counts the aliens, not the gaps', () => {
    expect(waveAlienCount({ rows: ['.ww.', 'dddd'], marchSpeed: 1, fireRate: 0, diveRate: 0 })).toBe(6);
    expect(waveColumns({ rows: ['.ww.', 'ddddd'], marchSpeed: 1, fireRate: 0, diveRate: 0 })).toBe(5);
  });
});
