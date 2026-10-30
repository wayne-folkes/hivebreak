import type { WaveDef } from './types';

// The waves of a run, as data. Rows run top to bottom, one character per column:
// 'd' drone, 'w' warden, 'v' diver, 'c' carrier, '.' empty slot. At most 6 columns by 5 rows, so
// a formation always fits the field with room to march.

/**
 * Tuning intent (slice 2a retune): one step harder than slice 1. March speed is about 25% up,
 * the formation fires about 30% more, divers join from wave 2, and 1-2 Carriers (tough, 4 hp)
 * sit in waves 2-4 so some aliens take several hits. Wave 5 is the Brood Mother's boss wave, with
 * no formation. The scripted bot wins fewer runs with 3 lives than in slice 1,
 * but still clears every wave when it has lives to spare.
 */
export const WAVE_TUNING_NOTES = 'Slice 2a: ~25% faster march, ~30% more fire, divers from wave 2, carriers in waves 2-4.';

export const WAVES: readonly WaveDef[] = [
  // 1: drones only, a little brisker than before.
  { rows: ['dddd', 'dddd', 'dddd'], marchSpeed: 15, fireRate: 0.33, diveRate: 0, sector: 1 },
  // 2: a Carrier and a warden up top, and the first diver.
  { rows: ['.cw.', 'dvdd', 'dddd', 'dddd'], marchSpeed: 18, fireRate: 0.52, diveRate: 0.08, sector: 1 },
  // 3: more divers and a Carrier up front.
  { rows: ['.www.', 'dvcvd', 'ddddd', 'ddddd'], marchSpeed: 20, fireRate: 0.65, diveRate: 0.16, sector: 1 },
  // 4: wider, faster, two Carriers.
  { rows: ['wwwwww', 'dvccvd', 'dddddd', 'dddddd'], marchSpeed: 23, fireRate: 0.85, diveRate: 0.22, sector: 1 },
  // 5: the Brood Mother. No formation; the boss launches its own Drones, so the march, fire and
  // dive numbers are unused.
  { rows: [], boss: 'broodMother', marchSpeed: 0, fireRate: 0, diveRate: 0, sector: 1 },
];

export const WAVE_COUNT = WAVES.length;

/** Columns in a wave's formation: its longest row. */
export function waveColumns(def: WaveDef): number {
  return Math.max(0, ...def.rows.map((row) => row.length));
}

/** How many aliens a wave starts with. */
export function waveAlienCount(def: WaveDef): number {
  return def.rows.reduce((total, row) => total + [...row].filter((c) => c !== '.').length, 0);
}
