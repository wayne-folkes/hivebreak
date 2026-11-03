import { describe, expect, it } from 'vitest';
import { midiToHz, parsePattern, rep, validateSong, validateStinger } from './pattern';
import type { Song } from './song';

describe('parsePattern', () => {
  it('reads notes, rests and holds, one token per step', () => {
    const p = parsePattern('C4 - . E4 | F#3 Bb2! - -');
    expect(p.steps).toBe(8);
    expect(p.notes).toEqual([
      { at: 0, len: 2, midi: 60, accent: false },
      { at: 3, len: 1, midi: 64, accent: false },
      { at: 4, len: 1, midi: 54, accent: false },
      { at: 5, len: 3, midi: 46, accent: true },
    ]);
  });

  it('reads drum hits on a drums channel', () => {
    const p = parsePattern('k . h s! o -', true);
    expect(p.steps).toBe(6);
    expect(p.notes.map((n) => [n.drum, n.at, n.len, n.accent])).toEqual([
      ['k', 0, 1, false],
      ['h', 2, 1, false],
      ['s', 3, 1, true],
      ['o', 4, 2, false],
    ]);
  });

  it('rejects bad tokens and holds with nothing to hold', () => {
    expect(() => parsePattern('C4 H4')).toThrow(/step 1: 'H4'/);
    expect(() => parsePattern('k')).toThrow(/not a note/);
    expect(() => parsePattern('C4', true)).toThrow(/not a drum hit/);
    expect(() => parsePattern('- C4')).toThrow(/step 0/);
    expect(() => parsePattern('C4 . -')).toThrow(/step 2/);
  });

  it('is empty for an empty string', () => {
    expect(parsePattern('  ')).toEqual({ steps: 0, notes: [] });
  });
});

describe('helpers', () => {
  it('converts MIDI to Hz', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(81)).toBeCloseTo(880);
    expect(midiToHz(60)).toBeCloseTo(261.63, 1);
  });

  it('repeats a pattern', () => {
    expect(parsePattern(rep('C4 . . .', 3)).steps).toBe(12);
  });
});

const song = (over: Partial<Song> = {}): Song => ({
  id: 'sector1',
  title: 'Test',
  bpm: 120,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 0,
  loopSteps: 32,
  channels: [{ name: 'lead', instrument: 'drums', layer: 'base', loop: rep('k . h .', 4) }],
  ...over,
});

describe('validateSong', () => {
  it('accepts a good song', () => {
    expect(validateSong(song())).toEqual([]);
  });

  it('finds loops that do not divide the song loop, bad intros and bad bars', () => {
    const errors = validateSong(
      song({
        introSteps: 16,
        loopSteps: 24,
        channels: [{ name: 'a', instrument: 'drums', layer: 'base', intro: 'k', loop: 'k . . . . . .' }],
      }),
    );
    expect(errors.join('\n')).toMatch(/loopSteps 24/);
    expect(errors.join('\n')).toMatch(/intro is 1 steps/);
    expect(errors.join('\n')).toMatch(/loop is 7 steps/);
  });

  it('wants three phases on the boss track only', () => {
    expect(validateSong(song({ id: 'boss' }))).toHaveLength(1);
    const gear = { bpm: 120, transpose: 0 };
    expect(validateSong(song({ id: 'boss', phases: [gear, gear, gear] }))).toEqual([]);
    expect(validateSong(song({ phases: [gear, gear, gear] }))).toHaveLength(1);
    expect(validateSong(song({ id: 'heart' }))).toHaveLength(1);
    expect(validateSong(song({ id: 'heart', phases: [gear, gear, gear] }))).toEqual([]);
  });

  it('reports a pattern that does not parse', () => {
    expect(validateSong(song({ channels: [{ name: 'a', instrument: 'drums', layer: 'base', loop: 'C4' }] }))[0]).toMatch(
      /channel 'a': loop step 0/,
    );
  });
});

describe('validateStinger', () => {
  it('reports bad patterns', () => {
    const bad = { id: 'upgrade' as const, bpm: 120, stepsPerBeat: 4, ends: false, channels: [{ name: 'x', instrument: 'drums' as const, notes: 'q' }] };
    expect(validateStinger(bad)).toHaveLength(1);
    expect(validateStinger({ ...bad, channels: [{ ...bad.channels[0], notes: 'k s' }] })).toEqual([]);
  });
});
