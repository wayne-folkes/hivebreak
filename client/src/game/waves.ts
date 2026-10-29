import type { WaveDef } from './types';

// The waves of a run, as data. Rows run top to bottom, one character per column:
// 'd' drone, 'w' warden, 'v' diver, '.' empty slot. At most 6 columns by 5 rows, so a formation
// always fits the field with room to march.

export const WAVES: readonly WaveDef[] = [
  // 1: drones only, slow and gentle.
  { rows: ['dddd', 'dddd', 'dddd'], marchSpeed: 12, fireRate: 0.25, diveRate: 0 },
  // 2: wardens join in the top row.
  { rows: ['.ww.', 'dddd', 'dddd', 'dddd'], marchSpeed: 14, fireRate: 0.4, diveRate: 0 },
  // 3: divers start breaking away.
  { rows: ['.www.', 'dvdvd', 'ddddd', 'ddddd'], marchSpeed: 16, fireRate: 0.5, diveRate: 0.12 },
  // 4: wider, faster, more of everything.
  { rows: ['wwwwww', 'dvddvd', 'dddddd', 'dddddd'], marchSpeed: 18, fireRate: 0.65, diveRate: 0.18 },
  // 5: the full mixed formation.
  { rows: ['wwwwww', 'vwddwv', 'dvddvd', 'dddddd', 'dddddd'], marchSpeed: 20, fireRate: 0.8, diveRate: 0.25 },
];

export const WAVE_COUNT = WAVES.length;

/** Columns in a wave's formation: its longest row. */
export function waveColumns(def: WaveDef): number {
  return Math.max(...def.rows.map((row) => row.length));
}

/** How many aliens a wave starts with. */
export function waveAlienCount(def: WaveDef): number {
  return def.rows.reduce((total, row) => total + [...row].filter((c) => c !== '.').length, 0);
}
