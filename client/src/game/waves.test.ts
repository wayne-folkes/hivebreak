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
    for (const w of WAVES) for (const row of w.rows) expect(row).toMatch(/^[dwvc.]+$/);
  });

  it('brings in wardens, carriers and divers from wave 2', () => {
    const kinds = (i: number) => new Set(WAVES[i].rows.join(''));
    for (const k of ['w', 'v', 'c']) expect(kinds(0).has(k)).toBe(false);
    for (const i of [1, 2, 3]) for (const k of ['w', 'v', 'c']) expect(kinds(i).has(k)).toBe(true);
  });

  it('makes wave 5 the Brood Mother: a boss and no formation', () => {
    expect(WAVES[4].boss).toBe('broodMother');
    expect(WAVES[4].rows).toEqual([]);
    expect(waveAlienCount(WAVES[4])).toBe(0);
    expect(waveColumns(WAVES[4])).toBe(0);
    for (const w of WAVES.slice(0, 4)) expect(w.boss).toBeUndefined();
  });

  it('has one or two carriers in waves 2 to 4', () => {
    for (const i of [1, 2, 3]) {
      const carriers = [...WAVES[i].rows.join('')].filter((c) => c === 'c').length;
      expect(carriers).toBeGreaterThanOrEqual(1);
      expect(carriers).toBeLessThanOrEqual(2);
    }
  });

  it('has divers dive from wave 2', () => {
    expect(WAVES[0].diveRate).toBe(0);
    for (let i = 1; i < 4; i++) expect(WAVES[i].diveRate).toBeGreaterThan(0);
  });

  it('is about 25% faster marching and 30% busier firing than slice 1', () => {
    const slice1 = { march: [12, 14, 16, 18, 20], fire: [0.25, 0.4, 0.5, 0.65, 0.8] };
    WAVES.slice(0, 4).forEach((w, i) => {
      expect(w.marchSpeed / slice1.march[i]).toBeGreaterThan(1.2);
      expect(w.marchSpeed / slice1.march[i]).toBeLessThan(1.35);
      expect(w.fireRate / slice1.fire[i]).toBeGreaterThan(1.25);
      expect(w.fireRate / slice1.fire[i]).toBeLessThan(1.4);
    });
  });

  it('only has divers dive when the wave has some', () => {
    for (const w of WAVES) if (w.diveRate > 0) expect(w.rows.join('')).toContain('v');
  });

  it('gets harder through the formation waves: more aliens, faster, more shots', () => {
    for (let i = 1; i < 4; i++) {
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
