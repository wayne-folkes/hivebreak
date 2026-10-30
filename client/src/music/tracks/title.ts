import type { Song } from '../song';
import { arpSoft, bassTri, leadMoody, padSoft } from './instruments';
import { arpLine, bars, bassLine, chord, hold, noteName, padLine, prog, rest, voicing } from './util';

// Title: D minor, 96 bpm. Two-bar intro of a pad swelling in, then a 16-bar loop in four
// four-bar phrases. Everything is on the base layer (the title screen never changes intensity).
//
//   bars  1-4   Dm  Bb  F   C
//   bars  5-8   Dm  Bb  Gm  A
//   bars  9-12  Bb  F   C   Dm
//   bars 13-16  Bb  Gm  A   A7

const chords = prog('Dm', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A', 'Bb', 'F', 'C', 'Dm', 'Bb', 'Gm', 'A', 'A7');
const dm = chord('D', 'm');

// A held pad across the intro: the same Dm for two bars.
const introPad = (voice: 0 | 1 | 2) => `${hold(noteName(voicing(dm, 57)[voice]), 16)} | ${rest(16).replace(/\./g, '-')}`;

const arp = ['1 . 2 . 3 . 5 . 3 . 2 . 3 . 2 .', '1 . 3 . 5 . 6 . 5 . 3 . 5 . 3 .'];
const bass = 'R - - - - - - - - - - - R - r .';

// Light, half-time drums; the last bar of each four has a little fill.
const beat = 'k . h . . . h . s . k . h . h .';
const fill = 'k . h . . . h . s . k . h . s s';
const drums = bars(...chords.map((_, i) => (i % 4 === 3 ? fill : beat)));

export const title: Song = {
  id: 'title',
  title: 'Hivebreak (title)',
  bpm: 96,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 32,
  loopSteps: 256,
  channels: [
    { name: 'pad low', instrument: padSoft, layer: 'base', intro: introPad(0), loop: padLine(chords, 0, 57), vol: 0.9, pan: -0.2 },
    { name: 'pad mid', instrument: padSoft, layer: 'base', intro: introPad(1), loop: padLine(chords, 1, 57), vol: 0.8, pan: 0.2 },
    { name: 'pad high', instrument: padSoft, layer: 'base', intro: introPad(2), loop: padLine(chords, 2, 57), vol: 0.7 },
    {
      name: 'arp',
      instrument: arpSoft,
      layer: 'base',
      intro: bars(rest(16), arpLine([dm], arp[0])),
      loop: arpLine(chords, arp),
      pan: 0.35,
    },
    {
      name: 'bass',
      instrument: bassTri,
      layer: 'base',
      intro: bars(rest(16), bassLine([dm], bass)),
      loop: bassLine(chords, bass),
    },
    { name: 'drums', instrument: 'drums', layer: 'base', loop: drums, vol: 0.6 },
    {
      name: 'lead',
      instrument: leadMoody,
      layer: 'base',
      loop: bars(
        // 1 Dm
        '. . . . . . . . A4 - - - C5 - D5 -',
        // 2 Bb
        'F5 - - - - - - - D5 - Bb4 - . . . .',
        // 3 F
        'A4 - - - C5 - - - F5 - - - E5 - D5 -',
        // 4 C
        'C5 - - - - - - - . . . . G4 - A4 -',
        // 5 Dm (the second phrase climbs)
        'A4 - - - D5 - - - F5 - - - A5 - - -',
        // 6 Bb
        'G5 - - - F5 - - - D5 - - - . . . .',
        // 7 Gm
        'D5 - - - Bb4 - - - D5 - F5 - G5 - - -',
        // 8 A
        'A5 - - - - - E5 - D5 - E5 - C#5 - . .',
        // 9 Bb
        '. . . . D5 - - - F5 - - - A5 - G5 -',
        // 10 F
        'F5 - - - - - - - C5 - - - A4 - - -',
        // 11 C
        'G5 - - - E5 - - - C5 - - - E5 - G5 -',
        // 12 Dm
        'D5 - - - - - - - . . . . F5 - E5 -',
        // 13 Bb
        'D5 - - - F5 - - - Bb5 - - - A5 - - -',
        // 14 Gm
        'G5 - - - D5 - - - Bb4 - - - D5 - - -',
        // 15 A
        'E5 - - - A5 - - - G5 - F5 - E5 - D5 -',
        // 16 A7 (leading tone, then a pickup into the loop)
        'C#5 - - - - - - - . . . . A4 - - -',
      ),
      pan: -0.1,
    },
  ],
};
