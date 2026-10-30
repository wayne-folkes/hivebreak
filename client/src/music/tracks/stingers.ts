import type { Stinger } from '../song';
import { bassTri, chime, fanfare, mourn, sparkle } from './instruments';

// The four stingers. They sit over (or replace) the track, so they stay in notes every track
// shares or tolerates.

/**
 * Wave clear (about 1.5 s, the track ducks under it): a bright rising run in E, using only notes
 * that fit both sector keys (E minor and C# Phrygian share E, F#, A and B).
 */
const waveClear: Stinger = {
  id: 'waveClear',
  bpm: 150,
  stepsPerBeat: 4,
  ends: false,
  channels: [
    { name: 'lead', instrument: fanfare, notes: 'E5 F#5 A5 B5 E6 - F#6 - E6 - - - - - -' },
    { name: 'bass', instrument: bassTri, notes: 'E3 - - - B3 - - - E4 - - - - - -', vol: 0.8 },
    { name: 'cymbal', instrument: 'drums', notes: 'k . . . . . . . . . . . o . .', vol: 0.6 },
  ],
};

/** Upgrade pick (about 1 s, the track ducks): a quick chime run up a pentatonic, with an echo. */
const upgrade: Stinger = {
  id: 'upgrade',
  bpm: 160,
  stepsPerBeat: 4,
  ends: false,
  channels: [
    { name: 'chime', instrument: chime, notes: 'E5 A5 B5 E6 F#6 A6 B6 - - - -' },
    { name: 'sparkle', instrument: sparkle, notes: '. . E5 A5 B5 E6 F#6 A6 B6 - -', pan: 0.4 },
  ],
};

/**
 * Victory (about 4.5 s, the track fades out): a G major fanfare, I - (IV, V) - I, in thirds with
 * a bass and drums, landing on a held G.
 */
const victory: Stinger = {
  id: 'victory',
  bpm: 132,
  stepsPerBeat: 4,
  ends: true,
  channels: [
    {
      name: 'lead',
      instrument: fanfare,
      notes: 'D5 . D5 D5 G5 - - - . . G5 G5 B5 - - - | E6 - - - C6 - - - D6 - - - F#6 - - - | G6 - - - - - - -',
    },
    {
      name: 'harmony',
      instrument: fanfare,
      notes: 'B4 . B4 B4 D5 - - - . . D5 D5 G5 - - - | C6 - - - G5 - - - A5 - - - D6 - - - | B5 - - - - - - -',
      vol: 0.7,
      pan: 0.3,
    },
    {
      name: 'bass',
      instrument: bassTri,
      notes: 'G2 - - - - - - - G2 - - - G2 - G2 - | C3 - - - - - - - D3 - - - - - - - | G2 - - - - - - -',
    },
    {
      name: 'drums',
      instrument: 'drums',
      notes: 'k . . . s . . . k . k . s . s s | k . . . s . . . k . s . s s s s | k . . . o . . .',
      vol: 0.8,
    },
  ],
};

/**
 * Game over (about 3 s, the track fades out): a sad D minor line falling A - G - F - E - D, over
 * a bass that drops D - A - D and settles low.
 */
const gameOver: Stinger = {
  id: 'gameOver',
  bpm: 96,
  stepsPerBeat: 4,
  ends: true,
  channels: [
    { name: 'lead', instrument: mourn, notes: 'A5 - - - G5 - F5 - E5 - - - D5 - - - - - - -' },
    { name: 'harmony', instrument: mourn, notes: 'F4 - - - - - - - E4 - - - - - - - D4 - - -', vol: 0.7, pan: -0.3 },
    { name: 'bass', instrument: bassTri, notes: 'D3 - - - - - - - A2 - - - - - - - D2 - - -' },
  ],
};

export const STINGERS = { waveClear, upgrade, victory, gameOver };
