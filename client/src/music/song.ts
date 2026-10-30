// The song format: what the composer writes and the music engine plays. Songs are plain data,
// synthesized live like the sound effects, so there are no audio files to download.
//
// Time is counted in steps. With `stepsPerBeat: 4` a step is a sixteenth note and a 4/4 bar is
// 16 steps. Each channel's notes are a pattern string (see pattern.ts for the grammar), e.g.
// `'C4 - - . E4 . G4 . | C5 - - - . . . .'`.
//
// A song plays its intro once, then its loop forever. Channels belong to layers, and the game
// turns layers on and off as play heats up (see Layer). Layer changes fade in or out rather than
// cutting, and never restart the song.

/** The four tracks. Both bosses share the boss track, which shifts up a gear at each phase. */
export type TrackId = 'title' | 'sector1' | 'sector2' | 'boss';

/** Short one-off phrases over (or instead of) the track. */
export type StingerId = 'waveClear' | 'upgrade' | 'victory' | 'gameOver';

/**
 * When a channel sounds:
 * - `base`: always.
 * - `mid`: intensity at least 1/3 (the wave is thinning).
 * - `high`: intensity at least 2/3 (the last few aliens).
 * - `danger`: on the last life.
 * - `phase2`, `phase3`: the boss track at that boss phase or later.
 */
export type Layer = 'base' | 'mid' | 'high' | 'danger' | 'phase2' | 'phase3';

/**
 * Oscillator shapes. `pulse25` and `pulse12` are narrow pulse waves (25% and 12.5% duty), the
 * thinner, nasal chiptune leads; `square` is the 50% one.
 */
export type Wave = 'square' | 'pulse25' | 'pulse12' | 'triangle' | 'sawtooth';

/** How a pitched channel sounds. Levels are 0 to 1, times are seconds. */
export interface Instrument {
  wave: Wave;
  /** Peak level of a note. Accented notes (`!`) play about 30% louder. */
  vol: number;
  attack: number;
  /** Time to fall from the peak to `sustain`. */
  decay: number;
  /** Level held, as a fraction of the peak, until the note ends. */
  sustain: number;
  /** Fade after the note ends. */
  release: number;
  /** Optional vibrato: rate in Hz, depth in semitones. Starts a little after the note does. */
  vibrato?: { rate: number; depth: number };
  /** Optional low-pass cutoff in Hz, to soften a bright wave. */
  cutoff?: number;
  /** Optional second oscillator this many cents sharp, for a fatter, chorused sound. */
  detune?: number;
  /** Optional slide into each note from this many semitones below (negative: above), over `attack`. */
  slide?: number;
}

/** Drum hits, synthesized from noise and a falling sine: kick, snare, closed hat, open hat. */
export type Drum = 'k' | 's' | 'h' | 'o';

export interface Channel {
  /** For the audition page and error messages. */
  name: string;
  /** A pitched instrument, or 'drums' (the pattern then holds drum letters, not notes). */
  instrument: Instrument | 'drums';
  layer: Layer;
  /** Played once before the loop. Exactly `song.introSteps` long; a channel without one rests through the intro. */
  intro?: string;
  /** Repeats after the intro. Its length must divide `song.loopSteps`, so short riffs repeat in time. */
  loop: string;
  /** Semitones added to every note (not drums). */
  transpose?: number;
  /** Channel level multiplier, default 1. */
  vol?: number;
  /** Stereo position, -1 (left) to 1 (right), default 0. */
  pan?: number;
}

/** A boss phase's gear: tempo and key. Index 0 of `Song.phases` is phase 1. */
export interface PhaseGear {
  bpm: number;
  /** Semitones added to every pitched channel. */
  transpose: number;
}

export interface Song {
  id: TrackId;
  /** Shown on the audition page. */
  title: string;
  bpm: number;
  stepsPerBeat: number;
  /** Steps per bar. Layer and phase changes land on bar lines. */
  stepsPerBar: number;
  /** Length of the intro in steps (a whole number of bars, 0 for none). */
  introSteps: number;
  /** Length of the loop in steps (a whole number of bars). */
  loopSteps: number;
  channels: Channel[];
  /** The boss track only: one gear per boss phase (the Hive Mind has three, the Brood Mother two). */
  phases?: PhaseGear[];
}

export interface StingerChannel {
  name: string;
  instrument: Instrument | 'drums';
  notes: string;
  transpose?: number;
  vol?: number;
  pan?: number;
}

export interface Stinger {
  id: StingerId;
  bpm: number;
  stepsPerBeat: number;
  channels: StingerChannel[];
  /**
   * true (victory, game over): the track fades out under it and stays stopped.
   * false (wave clear, upgrade): the track ducks under it and comes back.
   */
  ends: boolean;
}
