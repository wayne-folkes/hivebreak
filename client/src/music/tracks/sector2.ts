import type { Song } from '../song';
import { arpNebula, bassSquare, dangerPulse, leadPulse } from './instruments';
import { arpLine, bars, bassLine, prog } from './util';

// Sector 2: C# Phrygian, 140 bpm. The nebula: darker and stranger. Syncopated 3-3-2 bass, a
// breakbeat, and the flat-two (D major over a C# root) as the signature colour. One bar of
// intro, then a 16-bar loop: A (bars 1-8) and B (bars 9-16, ending on a G# dominant that pulls
// back to C#).
//
//   bars  1-8   C#m  D   C#m  D   | E   D   B   C#m
//   bars  9-16  C#m7 D   E    B   | A   B   D   G#
//
// Layers: base = drums + hats + bass; mid = arpeggio; high = lead; danger = high pulse bursts
// and off-beat open hats.

const chords = prog('C#m', 'D', 'C#m', 'D', 'E', 'D', 'B', 'C#m', 'C#m7', 'D', 'E', 'B', 'A', 'B', 'D', 'G#');

// Bass: 3-3-2-3-3-2 hits, with octave and fifth colour; a busier last bar per phrase.
const bassA = 'R . . R . . R - R . . R . . r -';
const bassB = 'R . . r . . R - R . . f . . r -';
const bassFill = 'R . . R . . R . R . r . R . f .';
const bassPattern = chords.map((_, i) => (i % 4 === 3 ? bassFill : i % 2 === 1 ? bassB : bassA));

// Drums: breakbeat kick/snare, and a separate 16th hat channel with gaps.
const kickSnare = 'k . . k s . k . . . k . s . h .';
const kickFill = 'k . . k s . k . k . s . s s s s';
const kicks = bars(...chords.map((_, i) => (i % 4 === 3 ? kickFill : kickSnare)));
const hats = 'h . h . h . h h h . h . h . h h';

// Arpeggio echoes the bass's 3-3-2 shape; a run at each phrase end.
const arpA = '1 . . 3 . . 5 . 6 . . 5 . . 3 .';
const arpB = '5 . 3 . 1 . 3 . 5 . 6 . 5 . 3 .';
const arpRun = '1 3 5 6 5 3 1 3 5 6 5 3 5 6 5 3';
const arps = chords.map((_, i) => (i % 4 === 3 ? arpRun : i < 8 ? arpA : arpB));

const burst = '4 . 4 4 . 4 4 . 4 . 4 4 . 4 4 .';

export const sector2: Song = {
  id: 'sector2',
  title: 'Sector 2: Nebula',
  bpm: 140,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 256,
  channels: [
    {
      name: 'drums',
      instrument: 'drums',
      layer: 'base',
      intro: 'k . . . . . . . k . . k . . s s',
      loop: kicks,
      vol: 0.85,
    },
    { name: 'hats', instrument: 'drums', layer: 'base', intro: '. . . . h . . . h . . . h . h h', loop: hats, vol: 0.5 },
    {
      name: 'bass',
      instrument: bassSquare,
      layer: 'base',
      intro: bassLine([chords[0]], 'R . . R . . R - R . . R . . r -'),
      loop: bassLine(chords, bassPattern),
    },
    { name: 'arp', instrument: arpNebula, layer: 'mid', loop: arpLine(chords, arps, 57), pan: -0.4 },
    {
      name: 'lead',
      instrument: leadPulse,
      layer: 'high',
      loop: bars(
        // --- A: bars 1-8 ---
        // 1 C#m
        'G#4 - - - C#5 - - - D5 - C#5 - - - . .',
        // 2 D
        'F#5 - - - E5 - D5 - . . A4 - D5 - - -',
        // 3 C#m
        'E5 - - - C#5 - - - G#4 - - - C#5 - D5 -',
        // 4 D (C# over D: the major seventh)
        'C#5 - - - - - D5 - F#5 - - - - - . .',
        // 5 E
        'G#5 - - - E5 - - - B4 - - - E5 - F#5 -',
        // 6 D
        'A5 - - - F#5 - - - D5 - - - F#5 - - .',
        // 7 B
        'D#5 - F#5 - B5 - - - A5 - F#5 - D#5 - - -',
        // 8 C#m
        'C#5 - - - - - - - . . . . G#4 - C#5 -',
        // --- B: bars 9-16 ---
        // 9 C#m7
        'E5 - - - D5 - C#5 - B4 - - - G#4 - - -',
        // 10 D
        'A4 - D5 - F#5 - - - E5 - D5 - C#5 - - -',
        // 11 E
        'B4 - E5 - G#5 - - - B5 - - - G#5 - E5 -',
        // 12 B
        'F#5 - - - D#5 - - - B4 - - - D#5 - F#5 -',
        // 13 A
        'E5 - - - C#5 - - - A4 - - - C#5 - E5 -',
        // 14 B
        'F#5 - - - D#5 - B4 - D#5 - F#5 - B5 - - -',
        // 15 D
        'A5 - - - F#5 - - - D5 - - - E5 - D5 -',
        // 16 G# (dominant: the leading tone C pulls up to C#)
        'D#5 - - - G#5 - - - C5 - - - . . . .',
      ),
      pan: 0.1,
    },
    { name: 'danger pulse', instrument: dangerPulse, layer: 'danger', loop: arpLine(chords, burst, 60), pan: 0.4 },
    {
      name: 'danger hat',
      instrument: 'drums',
      layer: 'danger',
      loop: '. . o . . . o . . . o . . . o .',
      vol: 0.55,
    },
  ],
};
