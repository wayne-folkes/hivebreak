import { describe, expect, it } from 'vitest';
import { FIELD_WIDTH } from './playfield';
import { ALIEN_SPECS } from './aliens';
import { SLOT_SPACING_X, spawnFormation } from './formation';
import { WAVES, WAVE_COUNT, waveAlienCount, waveColumns } from './waves';

describe('WAVES', () => {
  it('has fourteen waves: sector 1 is waves 1-5, sector 2 waves 6-10 and sector 3 waves 11-14', () => {
    expect(WAVE_COUNT).toBe(14);
    WAVES.forEach((w, i) => expect(w.sector).toBe(i < 5 ? 1 : i < 10 ? 2 : 3));
  });

  it('fits every formation in at most 6 columns and 5 rows, with room to march', () => {
    for (const w of WAVES) {
      expect(waveColumns(w)).toBeLessThanOrEqual(6);
      expect(w.rows.length).toBeLessThanOrEqual(5);
      expect((waveColumns(w) - 1) * SLOT_SPACING_X + 16).toBeLessThan(FIELD_WIDTH - 12);
    }
  });

  it('uses only known alien letters', () => {
    for (const w of WAVES) for (const row of w.rows) expect(row).toMatch(/^[dwvcstm.]+$/);
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

  it('makes wave 10 the Hive Mind: a boss and no formation, in sector 2', () => {
    expect(WAVES[9]).toMatchObject({ boss: 'hiveMind', rows: [], sector: 2 });
    for (const w of WAVES.slice(5, 9)) expect(w.boss).toBeUndefined();
  });

  it('keeps sector 1 as it was: no splitters and no behaviours', () => {
    for (const w of WAVES.slice(0, 5)) {
      expect(w.rows.join('')).not.toContain('s');
      expect(w.behaviours).toBeUndefined();
    }
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

describe('sector 2 waves', () => {
  const sector2 = WAVES.slice(5, 9);
  const withBehaviour = (b: 'split' | 'pairedDives') => sector2.filter((w) => w.behaviours?.includes(b));

  it('puts Splitters in several waves', () => {
    expect(sector2.filter((w) => w.rows.join('').includes('s')).length).toBeGreaterThanOrEqual(3);
  });

  it("has the 'split' behaviour on at least two waves and 'pairedDives' on at least two", () => {
    expect(withBehaviour('split').length).toBeGreaterThanOrEqual(2);
    expect(withBehaviour('pairedDives').length).toBeGreaterThanOrEqual(2);
  });

  it('gives every behaviour wave something to work with: split halves, and adjacent divers', () => {
    for (const w of withBehaviour('split')) expect(waveColumns(w)).toBeGreaterThanOrEqual(4);
    for (const w of withBehaviour('pairedDives')) expect(w.rows.some((r) => r.includes('vv'))).toBe(true);
  });

  it('brings Carriers here and there', () => {
    expect(sector2.filter((w) => w.rows.join('').includes('c')).length).toBeGreaterThanOrEqual(2);
  });

  it('is harder than wave 4 in march, fire and dive pressure, and gets harder wave to wave', () => {
    for (const w of sector2) {
      expect(w.marchSpeed).toBeGreaterThan(WAVES[3].marchSpeed);
      expect(w.fireRate).toBeGreaterThan(WAVES[3].fireRate);
      expect(w.diveRate).toBeGreaterThan(0);
    }
    for (let i = 1; i < sector2.length; i++) {
      expect(sector2[i].marchSpeed).toBeGreaterThan(sector2[i - 1].marchSpeed);
      expect(sector2[i].fireRate).toBeGreaterThan(sector2[i - 1].fireRate);
    }
  });
});

describe('waveAlienCount', () => {
  it('counts the aliens, not the gaps', () => {
    expect(waveAlienCount({ rows: ['.ww.', 'dddd'], marchSpeed: 1, fireRate: 0, diveRate: 0, sector: 1 })).toBe(6);
    expect(waveColumns({ rows: ['.ww.', 'ddddd'], marchSpeed: 1, fireRate: 0, diveRate: 0, sector: 1 })).toBe(5);
  });

  it('armours sector 3: each alien gets one extra hit point when the wave spawns', () => {
    for (const w of WAVES) expect(w.armour ?? 0).toBe(w.sector === 3 ? 1 : 0);
    const { aliens } = spawnFormation(WAVES[11], ((id) => () => id++)(1));
    for (const a of aliens) expect(a.hp).toBe(ALIEN_SPECS[a.kind].hp + 1);
  });
});
