import type { Instrument, Song } from '../song';
import { dangerPulse, leadHeavy, padDark, siren } from './instruments';
import { arpLine, bars, bassLine, hold, noteName, padLine, prog, voicing } from './util';

// The Hive Heart: F minor with the Phrygian flat-two (Gb), 120 bpm. Sector 3's track grown darker
// and grander: the same "lub-dub" kick, but slow enough to be the boss's own pulse. The Heart
// beats every HEART_BEAT_SECONDS (1.0 s in phase 1), and at 120 bpm half a bar (8 steps, two
// beats) is exactly that: the lub lands on step 0 and step 8 of every bar, the dub two sixteenths
// after. Phase 2 beats 0.75 s apart, and 160 bpm is 120 / 0.75, so the lub-dub keeps landing on
// the beat. Phase 3 keeps that tempo (the beat doesn't change) and climbs a tone, with a
// doubled heart and a heavier lead. One bar of intro (two heartbeats and a bass swell), then a
// 16-bar loop: A (bars 1-8) circles F minor under the Gb, and B (bars 9-16) climbs through
// Db, Eb and Gb to a C7 whose leading tone E pulls back to F.
//
//   bars  1-8   Fm  Gb  Fm  Db  | Bbm Gb  Fm  C7
//   bars  9-16  Db  Eb  Gb  Fm  | Bbm Gb  C7  C7
//
// Layers: base = heartbeat drums + hats + bass + throbbing chord stabs; mid = pads that swell on
// each beat + arpeggio; high = lead; danger = fast pulse, off-beat open hats and a racing extra
// kick; phase2 = double-time hats, held dark chord, wailing siren; phase3 = a second, late dub
// and the lead doubled an octave down.

/** A deep, sliding saw bass, filtered darker than sector 3's. */
const bassFlesh: Instrument = { wave: 'sawtooth', vol: 0.2, attack: 0.02, decay: 0.16, sustain: 0.55, release: 0.08, cutoff: 700, slide: 2 };
/** Low chord stabs that land with the kick, like a second pulse. */
const throb: Instrument = { wave: 'sawtooth', vol: 0.09, attack: 0.004, decay: 0.2, sustain: 0.15, release: 0.12, cutoff: 1400 };
/** A pad that swells with each heartbeat. */
const padBeat: Instrument = { wave: 'triangle', vol: 0.11, attack: 0.3, decay: 0.3, sustain: 0.75, release: 0.4, detune: 7 };
/** A dark pulse-wave arpeggio, chorused. */
const arpDark: Instrument = { wave: 'pulse25', vol: 0.085, attack: 0.003, decay: 0.18, sustain: 0.25, release: 0.12, cutoff: 2800, detune: 8 };
/** A big, slow mourning lead: filtered saw with a wide vibrato. */
const leadHeart: Instrument = { wave: 'sawtooth', vol: 0.11, attack: 0.03, decay: 0.2, sustain: 0.7, release: 0.25, vibrato: { rate: 4.2, depth: 0.3 }, cutoff: 2800, detune: 8 };

const chords = prog('Fm', 'Gb', 'Fm', 'Db', 'Bbm', 'Gb', 'Fm', 'C7', 'Db', 'Eb', 'Gb', 'Fm', 'Bbm', 'Gb', 'C7', 'C7');
const phraseEnd = (i: number) => i % 4 === 3;

// Bass: throbs under the lub-dub (hits on 0 and 2, again on 8 and 10), with pushes in the gaps;
// a busier turnaround at the end of each phrase.
const bassA = 'R - R . . . . . R - R . . . . .';
const bassB = 'R - R . . . R . R - R . . R . f';
const bassTurn = 'R - R . . . R . R - R . R R f r';
const bassPattern = chords.map((_, i) => (phraseEnd(i) ? bassTurn : i % 2 === 1 ? bassB : bassA));

// Drums: the lub-dub on every half bar, a snare in the second half; fills at phrase ends, a
// busier one on the last bar. Every bar keeps its kicks on steps 0, 2, 8 and 10.
const beat = 'k! . k . . . . . k! . k . s . . .';
const beatSnare = 'k! . k . . . s . k! . k . s . . .';
const fill = 'k! . k . . . . . k! . k . s . s s';
const lastFill = 'k! . k . . . s . k! . k s s s s s';
const drums = bars(...chords.map((_, i) => (i === 15 ? lastFill : phraseEnd(i) ? fill : i % 2 === 1 ? beatSnare : beat)));
// Hats: sparse and irregular, like slow breathing.
const hats = '. . h . . . . h . . h . . . h .';

// Stabs: the chord's root and fifth, low, on the lub and the dub.
const stabs = '1! . 3 . . . . . 1! . 3 . . . . .';

// Pads: the chord's middle and top tones, re-struck on each heartbeat so they swell and fade.
const pad = (voice: 1 | 2) =>
  bars(
    ...chords.map((c) => {
      const note = noteName(voicing(c, 60)[voice]);
      return `${hold(note, 8)} ${hold(note, 8)}`;
    }),
  );

// Arpeggio: eighths climbing and falling; a longer climb at each phrase end.
const arpA = '1 . 3 . 5 . 6 . 5 . 3 . 6 . 5 3';
const arpB = '3 . 5 . 6 . 4 . 6 . 5 . 3 . 5 .';
const arpRun = '1 3 5 6 5 3 5 6 5 6 4 6 5 3 6 5';
const arps = chords.map((_, i) => (phraseEnd(i) ? arpRun : i < 8 ? arpA : arpB));

// Danger: anxious bursts of high chord tones, as in the other tracks.
const burst = '4 . 4 . 4 4 . 4 . 4 . 4 4 . 4 4';

const lead = bars(
  // --- A: bars 1-8 ---
  // 1 Fm
  'C5 - - - - - - - F5 - - - Ab5 - C6 -',
  // 2 Gb (the flat-two, right on the Heart's chord)
  'Db6 - - - - - - - Bb5 - - - Gb5 - - -',
  // 3 Fm (sighing down from Gb)
  'F5 - - - Gb5 - F5 - Eb5 - - - F5 - - -',
  // 4 Db
  'Ab5 - - - F5 - - - Db5 - - - F5 - Ab5 -',
  // 5 Bbm
  'Bb5 - - - Db6 - - - F6 - - - Db6 - Bb5 -',
  // 6 Gb
  'Gb5 - - - Bb5 - - - Db6 - - - Bb5 - Gb5 -',
  // 7 Fm
  'C6 - - - Ab5 - - - F5 - - - Gb5 - F5 -',
  // 8 C7 (the leading tone E, then G and Bb)
  'E5 - - - G5 - Bb5 - C6 - - - . . . .',
  // --- B: bars 9-16, climbing ---
  // 9 Db
  'F5 - Ab5 - Db6 - - - C6 - Ab5 - F5 - - -',
  // 10 Eb
  'G5 - Bb5 - Eb6 - - - D6 - Bb5 - G5 - - -',
  // 11 Gb
  'Db6 - - - Bb5 - - - Gb5 - - - Bb5 - Db6 -',
  // 12 Fm (up to the Gb and back to the root)
  'Ab5 - C6 - F6 - - - Gb6 - F6 - C6 - . .',
  // 13 Bbm
  'Db6 - - - F6 - - - Eb6 - Db6 - Bb5 - - -',
  // 14 Gb
  'Bb5 - Db6 - Gb6 - - - F6 - Db6 - Bb5 - Gb5 -',
  // 15 C7
  'Bb5 - G5 - E5 - G5 - Bb5 - C6 - E6 - - -',
  // 16 C7 (the leading tone, held, pulling to F)
  'Bb5 - - - G5 - - - E5 - - - - - . .',
);

export const heart: Song = {
  id: 'heart',
  title: 'The Hive Heart',
  bpm: 120,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 256,
  // 120 bpm: one heartbeat (1.0 s) is two beats. 160 bpm: 0.75 s, the phase 2 and 3 beat.
  phases: [
    { bpm: 120, transpose: 0 },
    { bpm: 160, transpose: 0 },
    { bpm: 160, transpose: 2 },
  ],
  channels: [
    // base
    { name: 'drums', instrument: 'drums', layer: 'base', intro: 'k! . k . . . . . k! . k . . . s s', loop: drums, vol: 0.9 },
    { name: 'hats', instrument: 'drums', layer: 'base', intro: '. . . . . . . . . . . . h . h h', loop: hats, vol: 0.5 },
    {
      name: 'bass',
      instrument: bassFlesh,
      layer: 'base',
      intro: bassLine([chords[0]], 'R - R . . . . . R - R . . . . .'),
      loop: bassLine(chords, bassPattern),
    },
    { name: 'riff', instrument: throb, layer: 'base', loop: arpLine(chords, stabs, 48), pan: -0.25 },
    // mid, high
    { name: 'pad middle', instrument: padBeat, layer: 'mid', loop: pad(1), vol: 0.5, pan: -0.3 },
    { name: 'pad top', instrument: padBeat, layer: 'mid', loop: pad(2), vol: 0.5, pan: 0.3 },
    { name: 'arp', instrument: arpDark, layer: 'mid', loop: arpLine(chords, arps, 57), pan: 0.3 },
    { name: 'lead', instrument: leadHeart, layer: 'high', loop: lead, pan: 0.1 },
    // danger
    { name: 'danger pulse', instrument: dangerPulse, layer: 'danger', loop: arpLine(chords, burst, 60), pan: 0.4 },
    { name: 'danger hat', instrument: 'drums', layer: 'danger', loop: '. . o . . . o . . . o . . . o .', vol: 0.55 },
    // The heart racing: an extra kick between the beats, at the half of each half bar.
    { name: 'danger heart', instrument: 'drums', layer: 'danger', loop: '. . . . k . . . . . . . k . . .', vol: 0.6 },
    // phase 2: something new joins
    { name: 'double-time hats', instrument: 'drums', layer: 'phase2', loop: 'h h h h h h h h h h h h h h h h', vol: 0.4 },
    { name: 'dark chord low', instrument: padDark, layer: 'phase2', loop: padLine(chords, 0, 52), vol: 0.9, pan: -0.3 },
    { name: 'dark chord high', instrument: padDark, layer: 'phase2', loop: padLine(chords, 2, 52), vol: 0.9, pan: 0.3 },
    { name: 'siren', instrument: siren, layer: 'phase2', loop: padLine(chords, 1, 76), vol: 0.9 },
    // phase 3: the heart doubles
    { name: 'second dub', instrument: 'drums', layer: 'phase3', loop: '. . . . . . k . . . . . . . k .', vol: 0.7 },
    { name: 'lead double', instrument: leadHeavy, layer: 'phase3', loop: lead, transpose: -12, pan: -0.1 },
  ],
};
