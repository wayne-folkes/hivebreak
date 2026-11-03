import type { Drum, Song, Stinger } from './song';

// The pattern grammar. A pattern is whitespace-separated tokens, one token per step:
//
//   C4  F#3  Bb2   a note: letter, optional # or b, octave 0-8 (C4 is middle C, MIDI 60)
//   k s h o        a drum hit (drums channels only): kick, snare, closed hat, open hat
//   .              a rest
//   -              holds the previous note (or hit) one more step
//   |              a bar line, for reading; it takes no time and is ignored
//
// A note or hit followed by `!` is accented: `C4!`, `k!`. A hold can't start a pattern or follow
// a rest.

/** One note or hit in a parsed pattern. */
export interface NoteEvent {
  /** Step it starts on, from the pattern's start. */
  at: number;
  /** Steps it lasts, counting its holds (at least 1). */
  len: number;
  /** MIDI note number, for a note. */
  midi?: number;
  /** The drum, for a hit. */
  drum?: Drum;
  accent: boolean;
}

export interface Pattern {
  /** Total length in steps, rests included. */
  steps: number;
  notes: NoteEvent[];
}

const NOTE = /^([A-G])([#b]?)([0-8])(!?)$/;
const DRUM = /^([ksho])(!?)$/;
const SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Parses a pattern. `drums` says whether it belongs to a drums channel (drum letters) or a pitched
 * one (notes). Throws an Error naming the bad token and its step.
 */
export function parsePattern(text: string, drums = false): Pattern {
  const notes: NoteEvent[] = [];
  let step = 0;
  let open: NoteEvent | null = null;
  for (const token of text.split(/\s+/)) {
    if (token === '' || token === '|') continue;
    if (token === '.') {
      open = null;
    } else if (token === '-') {
      if (!open) throw new Error(`step ${step}: '-' has no note to hold`);
      open.len++;
    } else {
      const event = drums ? parseDrum(token) : parseNote(token);
      if (!event) throw new Error(`step ${step}: '${token}' is not a ${drums ? 'drum hit' : 'note'}`);
      open = { at: step, len: 1, ...event };
      notes.push(open);
    }
    step++;
  }
  return { steps: step, notes };
}

function parseNote(token: string): Omit<NoteEvent, 'at' | 'len'> | null {
  const m = NOTE.exec(token);
  if (!m) return null;
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return { midi: 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + accidental, accent: m[4] === '!' };
}

function parseDrum(token: string): Omit<NoteEvent, 'at' | 'len'> | null {
  const m = DRUM.exec(token);
  return m ? { drum: m[1] as Drum, accent: m[2] === '!' } : null;
}

/** A note's pitch in Hz (A4, MIDI 69, is 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** A pattern written out `times` times, for repeating a bar or a riff. */
export function rep(pattern: string, times: number): string {
  return Array.from({ length: times }, () => pattern).join(' | ');
}

/** Everything wrong with a song, as messages; empty when it is fine to play. */
export function validateSong(song: Song): string[] {
  const errors: string[] = [];
  const where = (what: string) => `${song.id}: ${what}`;
  if (!(song.bpm > 0)) errors.push(where('bpm must be positive'));
  if (!(song.stepsPerBeat > 0) || !(song.stepsPerBar > 0)) errors.push(where('step counts must be positive'));
  if (song.introSteps < 0 || song.introSteps % song.stepsPerBar !== 0) {
    errors.push(where(`introSteps ${song.introSteps} is not a whole number of bars`));
  }
  if (song.loopSteps <= 0 || song.loopSteps % song.stepsPerBar !== 0) {
    errors.push(where(`loopSteps ${song.loopSteps} is not a whole number of bars`));
  }
  if (song.channels.length === 0) errors.push(where('has no channels'));
  if (song.id === 'boss' || song.id === 'heart' ? song.phases?.length !== 3 : song.phases !== undefined) {
    errors.push(where('the boss tracks (boss and heart) need exactly three phases, and no other track has any'));
  }
  for (const channel of song.channels) {
    const drums = channel.instrument === 'drums';
    const at = (what: string) => where(`channel '${channel.name}': ${what}`);
    if (channel.intro !== undefined) {
      try {
        const intro = parsePattern(channel.intro, drums);
        if (intro.steps !== song.introSteps) errors.push(at(`intro is ${intro.steps} steps, not ${song.introSteps}`));
      } catch (e) {
        errors.push(at(`intro ${(e as Error).message}`));
      }
    }
    try {
      const loop = parsePattern(channel.loop, drums);
      if (loop.steps === 0 || song.loopSteps % loop.steps !== 0) {
        errors.push(at(`loop is ${loop.steps} steps, which doesn't divide ${song.loopSteps}`));
      }
    } catch (e) {
      errors.push(at(`loop ${(e as Error).message}`));
    }
  }
  return errors;
}

/** Everything wrong with a stinger, as messages; empty when it is fine to play. */
export function validateStinger(stinger: Stinger): string[] {
  const errors: string[] = [];
  if (!(stinger.bpm > 0) || !(stinger.stepsPerBeat > 0)) errors.push(`${stinger.id}: bpm and stepsPerBeat must be positive`);
  if (stinger.channels.length === 0) errors.push(`${stinger.id}: has no channels`);
  for (const channel of stinger.channels) {
    try {
      parsePattern(channel.notes, channel.instrument === 'drums');
    } catch (e) {
      errors.push(`${stinger.id}: channel '${channel.name}': ${(e as Error).message}`);
    }
  }
  return errors;
}
