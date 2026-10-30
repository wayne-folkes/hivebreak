import { describe, expect, it } from 'vitest';
import { rep } from './pattern';
import type { Song, Stinger } from './song';
import {
  activeLayers,
  clampPhase,
  clampTimeScale,
  eventsAtStep,
  eventsInWindow,
  gearFor,
  isBarLine,
  layerOn,
  nextBeatTime,
  parseSong,
  parseStinger,
  resumeTime,
  skipBehind,
  stepSeconds,
  stingerSeconds,
} from './timeline';

const lead = { wave: 'square', vol: 0.1, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } as const;

// A 2-bar intro, a 2-bar loop; the drums repeat every bar inside the loop, the lead plays an
// intro of its own, and the bass rests through the intro.
const song: Song = {
  id: 'sector1',
  title: 'test',
  bpm: 120,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 32,
  loopSteps: 32,
  channels: [
    { name: 'drums', instrument: 'drums', layer: 'base', intro: rep('k . . .', 8), loop: 'k . . . s . . . k . . . s . . .' },
    { name: 'lead', instrument: lead, layer: 'mid', intro: rep('C5 - - -', 8), loop: rep('E5 - . .', 8) },
    { name: 'bass', instrument: lead, layer: 'base', loop: rep('C2 - - - . . . .', 4) },
  ],
};

describe('stepSeconds', () => {
  it('is a sixteenth note at 120 bpm: 0.125 s', () => {
    expect(stepSeconds(120, 4)).toBeCloseTo(0.125);
  });

  it('stretches as the time scale falls', () => {
    expect(stepSeconds(120, 4, 0.5)).toBeCloseTo(0.25);
    expect(stepSeconds(120, 4, 0.25)).toBeCloseTo(0.5);
  });
});

describe('clamps', () => {
  it('keeps the time scale in 0.2 to 1', () => {
    expect(clampTimeScale(0)).toBe(0.2);
    expect(clampTimeScale(3)).toBe(1);
    expect(clampTimeScale(0.5)).toBe(0.5);
    expect(clampTimeScale(NaN)).toBe(1);
  });

  it('keeps the boss phase in 1 to 3', () => {
    expect(clampPhase(0)).toBe(1);
    expect(clampPhase(2.4)).toBe(2);
    expect(clampPhase(9)).toBe(3);
  });
});

describe('gearFor', () => {
  it('uses the phase entry on a track with phases, and the song tempo on one without', () => {
    const boss: Song = { ...song, id: 'boss', phases: [{ bpm: 150, transpose: 0 }, { bpm: 160, transpose: 2 }, { bpm: 172, transpose: 4 }] };
    expect(gearFor(boss, 1)).toEqual({ bpm: 150, transpose: 0 });
    expect(gearFor(boss, 3)).toEqual({ bpm: 172, transpose: 4 });
    expect(gearFor(boss, 7)).toEqual({ bpm: 172, transpose: 4 });
    expect(gearFor(song, 3)).toEqual({ bpm: 120, transpose: 0 });
  });

  it('stays inside a boss with only two phases', () => {
    const brood: Song = { ...song, id: 'boss', phases: [{ bpm: 150, transpose: 0 }, { bpm: 160, transpose: 2 }] };
    expect(gearFor(brood, 3).bpm).toBe(160);
  });
});

describe('layers', () => {
  const base = { intensity: 0, danger: false, phase: 1 };

  it('plays only base at the start', () => {
    expect([...activeLayers(base)]).toEqual(['base']);
  });

  it('brings in mid at a third and high at two thirds', () => {
    expect(layerOn('mid', { ...base, intensity: 0.33 })).toBe(false);
    expect(layerOn('mid', { ...base, intensity: 1 / 3 })).toBe(true);
    expect(layerOn('high', { ...base, intensity: 0.66 })).toBe(false);
    expect(layerOn('high', { ...base, intensity: 2 / 3 })).toBe(true);
    expect(activeLayers({ ...base, intensity: 1 })).toEqual(new Set(['base', 'mid', 'high']));
  });

  it('brings in danger on the last life', () => {
    expect(layerOn('danger', base)).toBe(false);
    expect(layerOn('danger', { ...base, danger: true })).toBe(true);
  });

  it('brings in the phase layers from their phase on', () => {
    expect(layerOn('phase2', { ...base, phase: 2 })).toBe(true);
    expect(layerOn('phase3', { ...base, phase: 2 })).toBe(false);
    expect(activeLayers({ ...base, phase: 3 })).toEqual(new Set(['base', 'phase2', 'phase3']));
  });
});

describe('parseSong', () => {
  it('rejects an invalid song, naming the problem', () => {
    expect(() => parseSong({ ...song, loopSteps: 24 })).toThrow(/whole number of bars/);
  });
});

describe('events by step', () => {
  const parsed = parseSong(song);
  const at = (step: number) => eventsAtStep(parsed, step).map((e) => [parsed.song.channels[e.channel].name, e.event.at]);

  it('plays the intro pattern in the intro, and a channel without one rests', () => {
    expect(at(0)).toEqual([['drums', 0], ['lead', 0]]);
    // The bass has no intro, so it rests until the loop starts.
    expect(at(4)).toEqual([['drums', 4], ['lead', 4]]);
    expect(at(31).map(([n]) => n)).not.toContain('bass');
  });

  it('switches to the loop patterns at the end of the intro', () => {
    expect(at(32)).toEqual([['drums', 0], ['lead', 0], ['bass', 0]]);
    expect(at(36)).toEqual([['drums', 4], ['lead', 4]]);
  });

  it('repeats a short channel loop inside the song loop', () => {
    // The drums' 16-step loop plays twice in the 32-step song loop; the bass (also 16) too.
    const drums = (step: number) => at(step).filter(([n]) => n === 'drums');
    expect(drums(32 + 4)).toEqual([['drums', 4]]);
    expect(drums(32 + 16 + 4)).toEqual([['drums', 4]]);
    expect(at(32 + 16).map(([n]) => n)).toEqual(['drums', 'lead', 'bass']);
  });

  it('wraps the whole song loop forever, without the intro', () => {
    expect(at(32 + 32)).toEqual(at(32));
    expect(at(32 + 32 * 5 + 4)).toEqual(at(36));
  });

  it('has no events before the start', () => {
    expect(eventsAtStep(parsed, -1)).toEqual([]);
  });

  it('collects a window across the intro-to-loop boundary', () => {
    const window = eventsInWindow(parsed, 28, 34);
    const names = window.map((e) => `${e.step} ${parsed.song.channels[e.channel].name}`);
    // The last intro hits (28, drums and lead), the quiet steps in between, then the loop's
    // first step (32, all three channels) and its step 33 with nothing.
    expect(names).toEqual(['28 drums', '28 lead', '32 drums', '32 lead', '32 bass']);
  });

  it('collects nothing for an empty window', () => {
    expect(eventsInWindow(parsed, 5, 5)).toEqual([]);
  });

  it('finds bar lines', () => {
    expect(isBarLine(0, 16)).toBe(true);
    expect(isBarLine(16, 16)).toBe(true);
    expect(isBarLine(20, 16)).toBe(false);
  });
});

describe('skipBehind', () => {
  it('leaves an on-time or slightly late step alone', () => {
    expect(skipBehind(10, 5.0, 5.0, 0.125)).toEqual({ pos: 10, nextTime: 5.0, skipped: 0 });
    expect(skipBehind(10, 4.97, 5.0, 0.125)).toEqual({ pos: 10, nextTime: 4.97, skipped: 0 });
  });

  it('skips whole steps to reach the present when far behind', () => {
    const c = skipBehind(10, 4.0, 5.0, 0.125);
    expect(c.skipped).toBe(8);
    expect(c.pos).toBe(18);
    expect(c.nextTime).toBeCloseTo(5.0);
  });

  it('never lands before now', () => {
    const c = skipBehind(0, 0, 1.01, 0.125);
    expect(c.nextTime).toBeGreaterThanOrEqual(1.01);
    expect(c.nextTime - 1.01).toBeLessThan(0.125);
  });
});

describe('nextBeatTime', () => {
  it('is the first beat on the grid after now plus the lead', () => {
    // Beats at 1.0, 1.5, 2.0 ...; now is 1.6 so the next is 2.0.
    expect(nextBeatTime(1.0, 0.5, 1.6)).toBeCloseTo(2.0);
    expect(nextBeatTime(1.0, 0.5, 1.45)).toBeCloseTo(1.5);
  });

  it('skips a beat that is too close to catch', () => {
    expect(nextBeatTime(1.0, 0.5, 1.49, 0.03)).toBeCloseTo(2.0);
  });

  it('can land on a beat that is already scheduled ahead', () => {
    expect(nextBeatTime(1.5, 0.5, 1.2)).toBeCloseTo(1.5);
  });

  it('can land on an earlier beat on the grid when the last one is far ahead', () => {
    expect(nextBeatTime(2.0, 0.5, 1.2)).toBeCloseTo(1.5);
  });

  it('starts at once when no beat has been scheduled', () => {
    expect(nextBeatTime(null, 0.5, 3, 0.03)).toBeCloseTo(3.03);
  });
});

describe('resumeTime', () => {
  it('restarts right away when the clock was left far in the past', () => {
    expect(resumeTime(2, 100)).toBeCloseTo(100.05);
  });

  it('keeps a clock that is already ahead', () => {
    expect(resumeTime(100.2, 100)).toBe(100.2);
  });
});

describe('stingers', () => {
  const stinger: Stinger = {
    id: 'waveClear',
    bpm: 120,
    stepsPerBeat: 4,
    ends: false,
    channels: [
      { name: 'a', instrument: lead, notes: 'C5 E5 G5 -' },
      { name: 'b', instrument: 'drums', notes: 'k . . . . . . .' },
    ],
  };

  it('is as long as its longest channel', () => {
    const parsed = parseStinger(stinger);
    expect(parsed.steps).toBe(8);
    expect(stingerSeconds(parsed)).toBeCloseTo(1);
  });

  it('rejects a bad pattern', () => {
    expect(() => parseStinger({ ...stinger, channels: [{ name: 'a', instrument: lead, notes: 'C5 Q9' }] })).toThrow(/Q9/);
  });
});
