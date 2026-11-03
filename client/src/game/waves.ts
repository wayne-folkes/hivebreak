import type { WaveDef } from './types';

// The waves of a run, as data. Rows run top to bottom, one character per column:
// 'd' drone, 'w' warden, 'v' diver, 'c' carrier, 's' splitter, 't' warper, 'm' mender, '.' empty slot. At most 6 columns by
// 5 rows, so a formation always fits the field with room to march.
//
// A run is three sectors of five waves, each ending in a boss: the Brood Mother (wave 5), the Hive
// Mind (wave 10) and the Hive Heart (wave 15). The run is won after the last wave; WAVE_COUNT is
// the length of this list, so it follows. Boss Rush plays only the boss waves (see run.ts).

/**
 * Tuning intent (slice 2a retune): one step harder than slice 1. March speed is about 25% up,
 * the formation fires about 30% more, divers join from wave 2, and 1-2 Carriers (tough, 4 hp)
 * sit in waves 2-4 so some aliens take several hits. Wave 5 is the Brood Mother's boss wave, with
 * no formation. The scripted bot wins fewer runs with 3 lives than in slice 1,
 * but still clears every wave when it has lives to spare.
 */
export const WAVE_TUNING_NOTES = 'Slice 2a: ~25% faster march, ~30% more fire, divers from wave 2, carriers in waves 2-4. Slice 2b: sector 2 (waves 6-9) marches, fires and dives faster still, each with a twist.';

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

  // Sector 2: the hive. Every formation wave is faster and busier than wave 4 (23, 0.85, 0.22).
  // 6: the Splitters arrive. Kill one and two minis drop out of it, so the fire is the twist.
  { rows: ['.ssss.', 'wddddw', 'dvddvd', 'dddddd'], marchSpeed: 25, fireRate: 0.95, diveRate: 0.22, sector: 2 },
  // 7: the formation splits in two, marches apart and closes up again; shoot through the gap.
  {
    rows: ['.www.', 'sdsds', 'dvdvd', 'ddddd'],
    marchSpeed: 27,
    fireRate: 1.05,
    diveRate: 0.2,
    sector: 2,
    behaviours: ['split'],
  },
  // 8: Divers dive in pairs, with Carriers up front and Splitters on the flanks.
  {
    rows: ['swccws', 'dvvvvd', 'dsddsd', 'dddddd'],
    marchSpeed: 29,
    fireRate: 1.15,
    diveRate: 0.28,
    sector: 2,
    behaviours: ['pairedDives'],
  },
  // 9: everything at once, five rows deep: it splits, its divers pair up, Splitters and a Carrier.
  {
    rows: ['wwcww', 'sdsds', 'dvvvd', 'dsdsd', 'ddddd'],
    marchSpeed: 31,
    fireRate: 1.3,
    diveRate: 0.3,
    sector: 2,
    behaviours: ['split', 'pairedDives'],
  },
  // 10: the Hive Mind. No formation; the boss has its own shots, so these numbers are unused.
  { rows: [], boss: 'hiveMind', marchSpeed: 0, fireRate: 0, diveRate: 0, sector: 2 },
  // Sector 3, the heart of the hive, ending in the Hive Heart. Its aliens
  // are armoured: one extra hit point each. A player who reaches sector 3 is well upgraded, and
  // without it the bot cleared these waves in two or three seconds, before a mine or acid column
  // had even arrived.
  // 11: the pincer: the formation flies in as two halves and docks. Warpers ('t') join.
  {
    rows: ['.wttw.', 'dvddvd', 'tddddt', 'dddddd'],
    marchSpeed: 30,
    fireRate: 1.2,
    diveRate: 0.25,
    sector: 3,
    behaviours: ['pincer'],
    armour: 1,
  },
  // 12: the weave: rows march in opposite directions, so gaps open and close. Menders ('m') join.
  {
    rows: ['wwmww', 'dsdsd', 'mdvdm', 'ddddd'],
    marchSpeed: 30,
    fireRate: 1.25,
    diveRate: 0.26,
    sector: 3,
    behaviours: ['weave'],
    armour: 1,
  },
  // 13: mines drift down through a dense formation.
  {
    rows: ['wtwwtw', 'dmddmd', 'svddvs', 'dddddd', 'dddddd'],
    marchSpeed: 32,
    fireRate: 1.3,
    diveRate: 0.28,
    sector: 3,
    mineRate: 0.35,
    armour: 1,
  },
  // 14: everything: the weave, Warpers, Menders and mines, plus acid rain.
  {
    rows: ['wtmmtw', 'sdvvds', 'dmddmd', 'tddddt', 'dddddd'],
    marchSpeed: 33,
    fireRate: 1.4,
    diveRate: 0.3,
    sector: 3,
    behaviours: ['weave', 'pairedDives'],
    mineRate: 0.3,
    acidRate: 0.25,
    armour: 1,
  },
  // 15: the Hive Heart. No formation; the boss has its own attacks, so these numbers are unused.
  { rows: [], boss: 'hiveHeart', marchSpeed: 0, fireRate: 0, diveRate: 0, sector: 3 },
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
