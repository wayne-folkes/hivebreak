import type { Instrument, Song } from '../song';
import { dangerPulse } from './instruments';
import { arpLine, bars, bassLine, hold, noteName, prog, voicing } from './util';

// Sector 3: F minor with a Phrygian flat-two (Gb), 144 bpm. The heart of the hive: the deepest,
// most intense stretch before the last boss, organic and pulsing. The kick plays a heartbeat,
// "lub-dub" (an accented kick, then a lighter one two sixteenths later) on every half bar, with
// a rest after, like a pulse at 72 beats a minute; the Hive Heart's own track takes that figure
// up. The bass, the swelling pads and the arpeggio all throb on the same beat. Acid and gold: a
// squelchy saw bass that slides into each note, a shimmering detuned arpeggio, a wobbling saw
// lead. One bar of intro (just the heartbeat), then a 16-bar loop: A (bars 1-8) creeps around F
// minor, with Gb leaning on the root, and B (bars 9-16) climbs and ends on a C7 dominant whose
// leading tone E pulls back up to F.
//
//   bars  1-8   Fm  Fm  Db  Gb  | Fm  Fm  Bbm C7
//   bars  9-16  Db  Ab  Gb  Fm  | Bbm Gb  C7  C7
//
// Layers: base = heartbeat drums + hats + bass; mid = swelling pads + arpeggio; high = lead;
// danger = fast pulse bursts, off-beat open hats and a racing extra kick.

/** Squelchy saw bass: filtered, sliding up into each note. */
const bassAcid: Instrument = { wave: 'sawtooth', vol: 0.2, attack: 0.02, decay: 0.14, sustain: 0.5, release: 0.05, cutoff: 800, slide: 2 };
/** Shimmering gold arpeggio: a chorused narrow pulse. */
const arpGold: Instrument = { wave: 'pulse25', vol: 0.085, attack: 0.003, decay: 0.16, sustain: 0.25, release: 0.1, cutoff: 3200, detune: 8 };
/** A wobbling acid lead: filtered saw, a slow deep vibrato. */
const leadAcid: Instrument = { wave: 'sawtooth', vol: 0.11, attack: 0.012, decay: 0.12, sustain: 0.6, release: 0.12, vibrato: { rate: 4.5, depth: 0.3 }, cutoff: 3000, detune: 8 };
/** The pad that swells with each heartbeat. */
const padBeat: Instrument = { wave: 'triangle', vol: 0.11, attack: 0.3, decay: 0.3, sustain: 0.75, release: 0.4, detune: 7 };

const chords = prog('Fm', 'Fm', 'Db', 'Gb', 'Fm', 'Fm', 'Bbm', 'C7', 'Db', 'Ab', 'Gb', 'Fm', 'Bbm', 'Gb', 'C7', 'C7');
const phraseEnd = (i: number) => i % 4 === 3;

// Bass: throbs on the heartbeat (hits on 0 and 2, again on 8 and 10), with pushes in the gaps;
// a busier turnaround at the end of each phrase.
const bassA = 'R - R . . . R . R - R . . . r .';
const bassB = 'R - R . . R . R R - R . . f . s';
const bassTurn = 'R - R . R . R . R - R . r r f r';
const bassPattern = chords.map((_, i) => (phraseEnd(i) ? bassTurn : i % 2 === 1 ? bassB : bassA));

// Drums: lub-dub on every half bar, a backbeat snare just after each; fills at phrase ends, a
// busier one on the last bar.
const beat = 'k! . k . s . . . k! . k . s . . .';
const fill = 'k! . k . s . . . k! . k . s . s s';
const lastFill = 'k! . k . . . k . k! . k s s s s s';
const drums = bars(...chords.map((_, i) => (i === 15 ? lastFill : phraseEnd(i) ? fill : beat)));
// Hats: loose and irregular, like breathing.
const hats = '. . h . . h . h . . h . . h . h';

// Pads: the chord's middle and top tones, re-struck on each heartbeat so they swell and fade.
const pad = (voice: 1 | 2) =>
  bars(
    ...chords.map((c) => {
      const note = noteName(voicing(c, 60)[voice]);
      return `${hold(note, 8)} ${hold(note, 8)}`;
    }),
  );

// Arpeggio: a lub-dub pair then a skipping run; a longer climb at each phrase end.
const arpA = '1 . 3 . 5 . . 3 1 . 3 . 5 . 6 5';
const arpB = '3 . 5 . 6 . . 5 3 . 5 . 6 . 5 3';
const arpRun = '1 3 5 6 5 3 5 6 5 6 5 3 6 5 3 1';
const arps = chords.map((_, i) => (phraseEnd(i) ? arpRun : i < 8 ? arpA : arpB));

// Danger: anxious bursts of high chord tones, as in the other sectors.
const burst = '4 . 4 . 4 4 . 4 . 4 . 4 4 . 4 4';

export const sector3: Song = {
  id: 'sector3',
  title: 'Sector 3: The Heart of the Hive',
  bpm: 144,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 256,
  channels: [
    {
      name: 'drums',
      instrument: 'drums',
      layer: 'base',
      intro: 'k! . k . . . . . k! . k . . . s s',
      loop: drums,
      vol: 0.85,
    },
    { name: 'hats', instrument: 'drums', layer: 'base', intro: '. . . . . . . . . . . . h . h h', loop: hats, vol: 0.5 },
    {
      name: 'bass',
      instrument: bassAcid,
      layer: 'base',
      intro: bassLine([chords[0]], 'R - R . . . . . R - R . . . R R'),
      loop: bassLine(chords, bassPattern),
    },
    { name: 'pad middle', instrument: padBeat, layer: 'mid', loop: pad(1), vol: 0.5, pan: -0.3 },
    { name: 'pad top', instrument: padBeat, layer: 'mid', loop: pad(2), vol: 0.5, pan: 0.3 },
    { name: 'arp', instrument: arpGold, layer: 'mid', loop: arpLine(chords, arps, 57), pan: -0.2 },
    {
      name: 'lead',
      instrument: leadAcid,
      layer: 'high',
      loop: bars(
        // --- A: bars 1-8 ---
        // 1 Fm
        'C5 - - - Ab5 - - Ab5 - G5 - F5 - - . .',
        // 2 Fm (the Gb creeps in over the root)
        'Eb5 - - - F5 - - Gb5 - F5 - - C5 - - -',
        // 3 Db
        'Db5 - - - F5 - - - Ab5 - - - F5 - Db5 -',
        // 4 Gb (leaning down onto F)
        'Bb5 - - - Gb5 - - - Db5 - - - Gb5 - Ab5 -',
        // 5 Fm (the answer, higher)
        'C6 - - - C6 . Ab5 - F5 - - - Ab5 - C6 -',
        // 6 Fm
        'Db6 - - - C6 - Ab5 - C6 - - - . . F5 -',
        // 7 Bbm
        'Db6 - - - Bb5 - - - F5 - - - Bb5 - Db6 -',
        // 8 C7 (the leading tone E, then Bb and G)
        'E6 - - - Bb5 - G5 - E5 - - - . . . .',
        // --- B: bars 9-16, climbing ---
        // 9 Db
        'F5 - Ab5 - Db6 - - - C6 - Ab5 - F5 - - -',
        // 10 Ab
        'Eb6 - - - C6 - - - Ab5 - - - C6 - Eb6 -',
        // 11 Gb
        'Db6 - - - Bb5 - - - Gb5 - - - Bb5 - Db6 -',
        // 12 Fm (up to the Gb and back to the root)
        'C6 - - - - - Gb6 - F6 - - - C6 - . .',
        // 13 Bbm
        'Db6 - Db6 . Bb5 - - - F5 - - - Bb5 - - -',
        // 14 Gb
        'Bb5 - - - Db6 - - - Gb6 - - - Db6 - Bb5 -',
        // 15 C7
        'G5 - Bb5 - E6 - - - D6 - C6 - Bb5 - G5 -',
        // 16 C7 (the leading tone, held, pulling to F)
        'E5 - - - - - - - . . . . . . . .',
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
    // The heart racing: an extra kick in the rest after each dub.
    { name: 'danger heart', instrument: 'drums', layer: 'danger', loop: '. . . . . . k . . . . . . . k .', vol: 0.6 },
  ],
};
