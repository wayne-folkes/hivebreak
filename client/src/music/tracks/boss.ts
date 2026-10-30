import type { Song } from '../song';
import { arpBright, bassSaw, dangerPulse, leadHeavy, leadSaw, padDark, siren, stab } from './instruments';
import { arpLine, bars, bassLine, padLine, prog } from './util';

// Boss: G minor, 148 bpm (phase 2 is 156 bpm a semitone up, phase 3 is 164 bpm a tone up).
// Heavy and urgent. One bar of intro (a snare build and a pedal), then a 16-bar loop. Shared by
// both bosses; the Brood Mother reaches phase 2 and the Hive Mind phase 3.
//
//   bars  1-8   Gm  Gm  Eb  D   | Gm  Gm  Cm  D7
//   bars  9-16  Eb  F   Gm  D   | Cm  Bb  D   D
//
// Layers: base = drums + hats + bass + stab riff; mid = arpeggio; high = lead; danger = fast
// pulse and off-beat open hats; phase2 = double-time hats, held dark chord, wailing siren;
// phase3 = a double kick and the lead doubled an octave down.

const chords = prog('Gm', 'Gm', 'Eb', 'D', 'Gm', 'Gm', 'Cm', 'D7', 'Eb', 'F', 'Gm', 'D', 'Cm', 'Bb', 'D', 'D');
const phraseEnd = (i: number) => i % 4 === 3;

// Bass: a gallop of sixteenths with octave jumps; a rest-and-hit turnaround at phrase ends.
const bassGallop = 'R R r R R R r R R R r R R R r R';
const bassTurn = 'R R r R R R r R R . R . f . s .';
const bassPattern = chords.map((_, i) => (phraseEnd(i) ? bassTurn : bassGallop));

// Drums: heavy kick on the 3-3-2 and a hard backbeat.
const beat = 'k . . k s . . . k . k . s . . .';
const fill = 'k . . k s . . . k . k . s s s s';
const drums = bars(...chords.map((_, i) => (phraseEnd(i) ? fill : beat)));
const hats = '. . h . . . h . . . h . . . h .';

// The menacing riff: saw stabs on the chord's root and fifth, on the 3-3-2 hits.
const riffA = '1 - . 1 - . 3 - 1 - . 3 - . 3 -';
const riffB = '1 - . 1 - . 3 - 4 - . 3 - . 1 .';
const riffs = chords.map((_, i) => (phraseEnd(i) ? riffB : riffA));

// Arpeggio: sixteenths, up and back; a run at phrase ends.
const arpA = '1 2 3 4 3 2 3 4 1 2 3 4 3 2 3 4';
const arpRun = '1 2 3 4 5 6 5 4 3 4 5 6 5 4 3 2';
const arps = chords.map((_, i) => (phraseEnd(i) ? arpRun : arpA));

const lead = bars(
  // --- A: bars 1-8 ---
  // 1 Gm
  'G5 - G5 . Bb5 - A5 . G5 - F5 . D5 - - .',
  // 2 Gm
  'G5 - G5 . A5 - Bb5 . D6 - - - C6 - Bb5 -',
  // 3 Eb
  'G5 - - - Bb5 - - - Eb6 - - - D6 - C6 -',
  // 4 D
  'A5 - - - F#5 - - - D5 - - - . . F#5 -',
  // 5 Gm
  'D6 - - - D6 . Bb5 - G5 - - - Bb5 - D6 -',
  // 6 Gm
  'F6 - - - D6 - - - Bb5 - - - D6 - F6 -',
  // 7 Cm
  'G5 - - - Eb6 - - - D6 - C6 - G5 - - -',
  // 8 D7
  'F#5 - A5 - C6 - - - D6 - - - . . . .',
  // --- B: bars 9-16 ---
  // 9 Eb
  'Bb5 - - - G5 - - - Eb5 - - - G5 - Bb5 -',
  // 10 F
  'C6 - - - A5 - - - F5 - - - A5 - C6 -',
  // 11 Gm
  'D6 - - - Bb5 - G5 - Bb5 - D6 - D6 - - -',
  // 12 D
  'F#6 - - - D6 - - - A5 - - - F#5 - A5 -',
  // 13 Cm
  'G5 - Eb6 - D6 - C6 - G5 - Eb5 - G5 - C6 -',
  // 14 Bb
  'D6 - - - Bb5 - - - F5 - - - Bb5 - D6 -',
  // 15 D
  'A5 - D6 - F#6 - - - D6 - A5 - F#5 - - -',
  // 16 D
  'D6 - - - - - - - . . . . . . . .',
);

export const boss: Song = {
  id: 'boss',
  title: 'Boss',
  bpm: 148,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 256,
  phases: [
    { bpm: 148, transpose: 0 },
    { bpm: 156, transpose: 1 },
    { bpm: 164, transpose: 2 },
  ],
  channels: [
    // base
    { name: 'drums', instrument: 'drums', layer: 'base', intro: 's . . . s . . . s . s . s s s s', loop: drums, vol: 0.9 },
    { name: 'hats', instrument: 'drums', layer: 'base', loop: hats, vol: 0.5 },
    {
      name: 'bass',
      instrument: bassSaw,
      layer: 'base',
      intro: bassLine([chords[0]], 'R - - - - - - - R - - - R R R R'),
      loop: bassLine(chords, bassPattern),
    },
    { name: 'riff', instrument: stab, layer: 'base', loop: arpLine(chords, riffs, 55), pan: -0.25 },
    // mid, high
    { name: 'arp', instrument: arpBright, layer: 'mid', loop: arpLine(chords, arps, 57), pan: 0.3 },
    { name: 'lead', instrument: leadSaw, layer: 'high', loop: lead, pan: 0.1 },
    // danger
    {
      name: 'danger pulse',
      instrument: dangerPulse,
      layer: 'danger',
      loop: arpLine(chords, '4 . 4 4 . 4 4 . 4 . 4 4 . 4 4 .', 60),
      pan: 0.4,
    },
    { name: 'danger hat', instrument: 'drums', layer: 'danger', loop: '. . o . . . o . . . o . . . o .', vol: 0.55 },
    // phase 2: something new joins
    { name: 'double-time hats', instrument: 'drums', layer: 'phase2', loop: 'h h h h h h h h h h h h h h h h', vol: 0.4 },
    { name: 'dark chord low', instrument: padDark, layer: 'phase2', loop: padLine(chords, 0, 52), vol: 0.9, pan: -0.3 },
    { name: 'dark chord high', instrument: padDark, layer: 'phase2', loop: padLine(chords, 2, 52), vol: 0.9, pan: 0.3 },
    { name: 'siren', instrument: siren, layer: 'phase2', loop: padLine(chords, 1, 76), vol: 0.9 },
    // phase 3: full force
    { name: 'double kick', instrument: 'drums', layer: 'phase3', loop: '. . k . . . k . . . . k . . k .', vol: 0.8 },
    { name: 'lead double', instrument: leadHeavy, layer: 'phase3', loop: lead, transpose: -12, pan: -0.1 },
  ],
};
