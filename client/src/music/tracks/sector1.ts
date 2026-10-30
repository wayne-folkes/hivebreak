import type { Song } from '../song';
import { arpBright, bassSaw, dangerPulse, leadPulse } from './instruments';
import { arpLine, bars, bassLine, prog } from './util';

// Sector 1: E minor, 132 bpm. Driving and heroic but tense. One bar of intro (kick and pedal
// bass) leading into a 16-bar loop: an A section (bars 1-8, i - bVI - bVII) and a B section
// (bars 9-16, bVI - bIII - bVII - i) that lifts the melody higher.
//
//   bars  1-8   Em  Em  C   D   | Em  Em  Am  B7
//   bars  9-16  C   G   D   Em  | C   Am  B7  B7
//
// Layers: base = drums + bass; mid = arpeggio; high = lead; danger = fast pulse bursts and an
// off-beat open hat.

const chords = prog('Em', 'Em', 'C', 'D', 'Em', 'Em', 'Am', 'B7', 'C', 'G', 'D', 'Em', 'C', 'Am', 'B7', 'B7');

// Bass: straight eighths with an octave pop; a rising turnaround on the last bar of each phrase.
const bassBar = 'R - R - r - R - R - R - r - f -';
const bassTurn = 'R - R - r - R - R - f - r - f -';
const bassPattern = chords.map((_, i) => (i % 4 === 3 ? bassTurn : bassBar));

// Drums: backbeat with an extra kick before the 4; fill on the last bar of each phrase.
const beat = 'k . h . s . h . k . h k s . h .';
const beatOpen = 'k . h . s . h . k . h . s . h o';
const fill = 'k . h . s . h . k . s . s . s s';
const drums = bars(...chords.map((_, i) => (i % 4 === 3 ? (i === 15 ? fill : beatOpen) : beat)));

// Arpeggio: sixteenths climbing the chord; B section is more broken; a run up at each phrase end.
const arpA = '1 2 3 2 4 3 2 3 1 2 3 2 4 3 2 3';
const arpB = '1 3 2 3 4 3 5 3 1 3 2 3 4 3 5 3';
const arpRun = '1 2 3 4 5 6 5 4 3 2 1 2 3 4 5 6';
const arps = chords.map((_, i) => (i % 4 === 3 ? arpRun : i < 8 ? arpA : arpB));

// Danger: anxious bursts of a high trill on the chord's fifth and octave, plus off-beat open hats.
const burst = '4 3 4 3 . . 4 3 4 3 4 3 . . 4 3';

export const sector1: Song = {
  id: 'sector1',
  title: 'Sector 1: Outer Hive',
  bpm: 132,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 256,
  channels: [
    {
      name: 'drums',
      instrument: 'drums',
      layer: 'base',
      intro: 'k . . . k . . . k . . . k . s s',
      loop: drums,
      vol: 0.85,
    },
    {
      name: 'bass',
      instrument: bassSaw,
      layer: 'base',
      intro: bassLine([chords[0]], 'R - R - R - R - R - R - r - r -'),
      loop: bassLine(chords, bassPattern),
    },
    { name: 'arp', instrument: arpBright, layer: 'mid', loop: arpLine(chords, arps, 57), pan: 0.3 },
    {
      name: 'lead',
      instrument: leadPulse,
      layer: 'high',
      loop: bars(
        // --- A: bars 1-8 ---
        // 1 Em
        'B4 - - - E5 - - G5 - - F#5 - E5 - - -',
        // 2 Em
        'D5 - - - B4 - - . . . B4 - D5 - E5 -',
        // 3 C
        'G5 - - - E5 - - - C5 - - - E5 - G5 -',
        // 4 D
        'A5 - - - F#5 - - - D5 - - - E5 - F#5 -',
        // 5 Em (answer, a step higher)
        'E5 - - - G5 - - B5 - - A5 - G5 - - -',
        // 6 Em
        'F#5 - - - D5 - - . . . D5 - F#5 - G5 -',
        // 7 Am
        'A5 - - - E5 - - - C5 - - - E5 - A5 -',
        // 8 B7 (leading tone D#, then a breath)
        'B5 - - - A5 - F#5 - D#5 - - - . . . .',
        // --- B: bars 9-16, soaring ---
        // 9 C
        'E5 - - - G5 - - - C6 - - - - - B5 -',
        // 10 G
        'A5 - G5 - - - D5 - G5 - - - - - . .',
        // 11 D
        'F#5 - - - A5 - - - D6 - - - - - C#6 -',
        // 12 Em
        'B5 - - - - - - - G5 - - - E5 - - -',
        // 13 C
        'E5 - G5 - C6 - - - B5 - G5 - E5 - - -',
        // 14 Am
        'A5 - C6 - E6 - - - D6 - C6 - A5 - - -',
        // 15 B7
        'D#6 - - - B5 - - - F#5 - - - A5 - B5 -',
        // 16 B7
        'B5 - - - - - - - . . . . . . . .',
      ),
      pan: -0.1,
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
