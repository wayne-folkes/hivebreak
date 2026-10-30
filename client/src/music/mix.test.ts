import { describe, expect, it } from 'vitest';
import {
  MAX_MUSIC_LEVEL,
  OPEN_CUTOFF,
  PAUSE_CUTOFF,
  PAUSE_LEVEL,
  SLOW_CUTOFF,
  busCutoff,
  duckDepthAt,
  duckEnd,
  duckLevel,
  glide,
  liveDucks,
  makeDuck,
  masterLevel,
  scaleCutoff,
} from './mix';

const on = { enabled: true, soundOn: true, volume: 1, paused: false, hidden: false };

describe('masterLevel', () => {
  it('is the maximum at full volume and scales with the setting', () => {
    expect(masterLevel(on)).toBe(MAX_MUSIC_LEVEL);
    expect(masterLevel({ ...on, volume: 0.5 })).toBeCloseTo(MAX_MUSIC_LEVEL / 2);
  });

  it('is silent when music is off, the sound switch is off, or the tab is hidden', () => {
    expect(masterLevel({ ...on, enabled: false })).toBe(0);
    expect(masterLevel({ ...on, soundOn: false })).toBe(0);
    expect(masterLevel({ ...on, hidden: true })).toBe(0);
  });

  it('drops to 40% while paused', () => {
    expect(masterLevel({ ...on, paused: true })).toBeCloseTo(MAX_MUSIC_LEVEL * PAUSE_LEVEL);
  });

  it('clamps a wild volume', () => {
    expect(masterLevel({ ...on, volume: 9 })).toBe(MAX_MUSIC_LEVEL);
    expect(masterLevel({ ...on, volume: -1 })).toBe(0);
    expect(masterLevel({ ...on, volume: NaN })).toBe(0);
  });
});

describe('cutoff', () => {
  it('is wide open at normal speed and about 900 Hz at a quarter', () => {
    expect(scaleCutoff(1)).toBeCloseTo(OPEN_CUTOFF);
    expect(scaleCutoff(0.25)).toBeCloseTo(SLOW_CUTOFF);
  });

  it('closes steadily as the scale falls and stops at the floor', () => {
    expect(scaleCutoff(0.5)).toBeLessThan(scaleCutoff(0.75));
    expect(scaleCutoff(0.5)).toBeGreaterThan(scaleCutoff(0.3));
    expect(scaleCutoff(0.2)).toBeCloseTo(SLOW_CUTOFF);
  });

  it('takes the lower of the time-scale and pause cutoffs', () => {
    expect(busCutoff(1, true)).toBe(PAUSE_CUTOFF);
    expect(busCutoff(1, false)).toBeCloseTo(OPEN_CUTOFF);
    expect(busCutoff(0.25, true)).toBe(PAUSE_CUTOFF);
    expect(busCutoff(0.25, false)).toBeCloseTo(SLOW_CUTOFF);
    expect(busCutoff(0.6, true)).toBe(PAUSE_CUTOFF);
  });
});

describe('glide', () => {
  it('moves linearly from one value to the other', () => {
    expect(glide(1, 0.5, 10, 0.3, 9)).toBe(1);
    expect(glide(1, 0.5, 10, 0.3, 10.15)).toBeCloseTo(0.75);
    expect(glide(1, 0.5, 10, 0.3, 11)).toBe(0.5);
  });

  it('is at its target when it never started', () => {
    expect(glide(1, 0.5, -Infinity, 0.3, 0)).toBe(0.5);
  });
});

describe('ducks', () => {
  it('dips quickly, then recovers linearly over the given seconds', () => {
    const duck = makeDuck(10, 2, 0.6);
    expect(duckDepthAt(duck, 9.9)).toBe(0);
    expect(duckDepthAt(duck, 10.025)).toBeCloseTo(0.3);
    expect(duckDepthAt(duck, 10.05)).toBeCloseTo(0.6);
    expect(duckDepthAt(duck, 11.05)).toBeCloseTo(0.3);
    expect(duckDepthAt(duck, 12.05)).toBe(0);
    expect(duckEnd(duck)).toBeCloseTo(12.05);
  });

  it('gives a gain of one when nothing ducks it', () => {
    expect(duckLevel([], 5)).toBe(1);
  });

  it('takes the deeper of overlapping ducks', () => {
    const shallow = makeDuck(0, 4, 0.3);
    const deep = makeDuck(1, 1, 0.8);
    expect(duckLevel([shallow, deep], 1.05)).toBeCloseTo(0.2);
    // After the deep one is over only the shallow one is left.
    const t = 3;
    expect(duckLevel([shallow, deep], t)).toBeCloseTo(duckLevel([shallow], t));
    expect(duckLevel([shallow, deep], t)).toBeGreaterThan(0.6);
  });

  it('holds a stinger-style duck flat for its length', () => {
    const duck = { start: 0, depth: 0.7, hold: 2, recover: 0.4 };
    expect(duckDepthAt(duck, 1)).toBe(0.7);
    expect(duckDepthAt(duck, 2.05)).toBe(0.7);
    expect(duckDepthAt(duck, 2.25)).toBeCloseTo(0.35);
    expect(duckDepthAt(duck, 2.5)).toBe(0);
  });

  it('keeps a duck that has not started yet, and drops finished ones', () => {
    const past = makeDuck(0, 1, 0.5);
    const future = makeDuck(10, 1, 0.5);
    expect(duckLevel([future], 5)).toBe(1);
    expect(liveDucks([past, future], 5)).toEqual([future]);
  });

  it('clamps depth and gives a very short duck a minimum length', () => {
    expect(makeDuck(0, 1, 5).depth).toBe(1);
    expect(makeDuck(0, 1, -1).depth).toBe(0);
    expect(makeDuck(0, 0, 0.5).recover).toBeGreaterThan(0);
  });
});
