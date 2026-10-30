import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Music, LOOKAHEAD, TICK_MS } from './music';
import { rep } from './pattern';
import type { Song, Stinger, StingerId, TrackId } from './song';

// The engine runs against a stand-in AudioContext whose nodes just record what is created, so the
// tests check what gets scheduled and when, not how it sounds. The maths has its own tests.

const blip = { wave: 'square', vol: 0.1, attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.1 } as const;

const song = (id: TrackId, extra: Partial<Song> = {}): Song => ({
  id,
  title: id,
  bpm: 120,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 16,
  loopSteps: 32,
  channels: [
    { name: 'drums', instrument: 'drums', layer: 'base', loop: rep('k . h .', 4) },
    { name: 'lead', instrument: blip, layer: 'base', intro: rep('C5 - . .', 4), loop: rep('E5 - . .', 8), pan: 0.3 },
    { name: 'high', instrument: { ...blip, wave: 'pulse25', vibrato: { rate: 6, depth: 0.3 }, cutoff: 3000, detune: 8, slide: 2 }, layer: 'high', loop: rep('G5 . . .', 8) },
  ],
  ...extra,
});

const bossPhases = [{ bpm: 150, transpose: 0 }, { bpm: 160, transpose: 2 }, { bpm: 170, transpose: 4 }];

const tracks: Record<TrackId, Song> = {
  title: song('title'),
  sector1: song('sector1'),
  sector2: song('sector2'),
  boss: song('boss', { phases: bossPhases }),
};

const stinger = (id: StingerId, ends: boolean): Stinger => ({
  id,
  bpm: 120,
  stepsPerBeat: 4,
  ends,
  channels: [{ name: 'lead', instrument: blip, notes: 'C5 E5 G5 -' }],
});

const stingers: Record<StingerId, Stinger> = {
  waveClear: stinger('waveClear', false),
  upgrade: stinger('upgrade', false),
  victory: stinger('victory', true),
  gameOver: stinger('gameOver', true),
};

const PARAMS = ['gain', 'frequency', 'detune', 'Q', 'pan', 'threshold', 'knee', 'ratio', 'attack', 'release'];

function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

/** A node that accepts any property or call, and remembers its audio params. */
function fakeNode() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get(target, prop: string) {
      if (!(prop in target)) {
        if (PARAMS.includes(prop)) target[prop] = fakeParam();
        else if (prop === 'connect') target[prop] = (node: unknown) => node;
        else target[prop] = vi.fn();
      }
      return target[prop];
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
}

type FakeNode = ReturnType<typeof fakeNode>;

/** The arguments of each call to a method (or audio param method) of a fake node. */
function calls(node: FakeNode, ...path: string[]): unknown[][] {
  let target: unknown = node;
  for (const key of path) target = (target as Record<string, unknown>)[key];
  return (target as { mock: { calls: unknown[][] } }).mock.calls;
}

function fakeContext() {
  const created: Record<string, number> = {};
  const nodes: Record<string, FakeNode[]> = {};
  const ctx: Record<string, unknown> = {
    currentTime: 0,
    sampleRate: 8000,
    state: 'running',
    destination: fakeNode(),
    resume: () => Promise.resolve(),
    createBuffer: (_c: number, length: number, rate: number) => ({ duration: length / rate, getChannelData: () => new Float32Array(length) }),
    createPeriodicWave: () => ({}),
  };
  for (const name of ['createGain', 'createOscillator', 'createBufferSource', 'createBiquadFilter', 'createStereoPanner', 'createDynamicsCompressor']) {
    ctx[name] = () => {
      created[name] = (created[name] ?? 0) + 1;
      const node = fakeNode();
      (nodes[name] ??= []).push(node);
      return node;
    };
  }
  return { ctx: ctx as unknown as AudioContext, raw: ctx as { currentTime: number; state: string }, created, nodes };
}

/** Moves the audio clock on, letting the scheduler tick as it would. */
function run(raw: { currentTime: number }, seconds: number) {
  const ticks = Math.round((seconds * 1000) / TICK_MS);
  for (let i = 0; i < ticks; i++) {
    raw.currentTime += TICK_MS / 1000;
    vi.advanceTimersByTime(TICK_MS);
  }
}

const notes = (created: Record<string, number>) => (created.createOscillator ?? 0) + (created.createBufferSource ?? 0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('without Web Audio', () => {
  it('constructs and runs every method without a context', () => {
    const music = new Music({ enabled: true, volume: 0.5 }, tracks, stingers);
    music.play('sector1');
    expect(music.track).toBe('sector1');
    music.stinger('waveClear');
    music.setIntensity(0.5);
    music.setIntensity(NaN);
    music.setDanger(true);
    music.setBossPhase(2);
    music.duck(1, 0.5);
    music.duck(NaN, NaN);
    music.setTimeScale(0.25);
    music.setTimeScale(NaN);
    music.setPaused(true);
    music.setPaused(false);
    music.enabled = false;
    music.volume = 2;
    music.soundOn = false;
    expect(music.volume).toBe(1);
    expect(music.position).toBeNull();
    music.play(null);
    expect(music.track).toBeNull();
  });

  it('works with the real default songs', () => {
    const music = new Music();
    music.play('title');
    music.stinger('victory');
    expect(music.track).toBe('title');
  });
});

describe('playing', () => {
  it('schedules notes ahead once attached, and keeps scheduling as time passes', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    const first = notes(created);
    expect(first).toBeGreaterThan(0);
    // Only the lookahead is scheduled, not the whole song.
    expect(music.position).toBeGreaterThanOrEqual(3);
    expect(music.position).toBeLessThan(10);
    run(raw, 1);
    expect(notes(created)).toBeGreaterThan(first);
    // At 120 bpm a step is 0.125 s, so a second is about 8 steps further on.
    expect(music.position!).toBeGreaterThanOrEqual(8);
    expect(music.position!).toBeLessThanOrEqual(8 + Math.ceil(LOOKAHEAD / 0.125) + 3);
  });

  it('remembers a track asked for before attach and starts it on attach', () => {
    const { ctx, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.play('title');
    music.setIntensity(1);
    music.attach(ctx);
    expect(notes(created)).toBeGreaterThan(0);
    expect(music.track).toBe('title');
  });

  it('does nothing when attached with the same context again', () => {
    const { ctx, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    const before = { ...created };
    music.attach(ctx);
    expect(created).toEqual(before);
    expect(music.track).toBe('sector1');
  });

  it('does not restart when asked for the same track', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 0.5);
    const gains = created.createGain;
    const pos = music.position;
    music.play('sector1');
    expect(created.createGain).toBe(gains);
    expect(music.position).toBe(pos);
  });

  it('crossfades to a new track from its intro, and drops the old one once silent', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 3);
    music.setIntensity(1);
    expect(music.position!).toBeGreaterThan(16);
    music.play('sector2');
    expect(music.track).toBe('sector2');
    expect(music.position!).toBeLessThan(12);
    // Both play during the fade, then only the new one is scheduled.
    run(raw, 1.5);
    const before = notes(created);
    run(raw, 1);
    expect(notes(created)).toBeGreaterThan(before);
  });

  it('stops the timer once nothing is playing', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    expect(vi.getTimerCount()).toBe(1);
    music.play(null);
    expect(music.track).toBeNull();
    run(raw, 1.5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('brings a track back without restarting it when asked while fading out', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 2);
    const pos = music.position!;
    music.play(null);
    run(raw, 0.3);
    music.play('sector1');
    expect(music.track).toBe('sector1');
    expect(music.position!).toBeGreaterThanOrEqual(pos);
    expect(music.position!).toBeLessThan(pos + 20);
  });

  it('restarts a track from its intro once it has faded out completely', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 3);
    music.play(null);
    run(raw, 2);
    music.play('sector1');
    expect(music.position!).toBeLessThan(12);
  });

  it('skips ahead rather than bursting when the timer was throttled', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 0.5);
    const before = notes(created);
    const pos = music.position!;
    // 20 seconds pass with no ticks, then one tick.
    raw.currentTime += 20;
    vi.advanceTimersByTime(TICK_MS);
    // About 160 steps passed; they are skipped, and only the lookahead's worth is played.
    expect(music.position!).toBeGreaterThan(pos + 100);
    expect(notes(created) - before).toBeLessThan(40);
  });

  it('survives an invalid song without throwing', () => {
    const { ctx } = fakeContext();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const music = new Music(undefined, { ...tracks, title: song('title', { loopSteps: 30 }) }, stingers);
    music.attach(ctx);
    expect(() => music.play('title')).not.toThrow();
    expect(music.position).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('muting', () => {
  it('builds no notes while muted, but the song keeps its place', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music({ enabled: false, volume: 0.6 }, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 2);
    expect(notes(created)).toBe(0);
    expect(music.position!).toBeGreaterThan(14);
    music.enabled = true;
    run(raw, 0.5);
    expect(notes(created)).toBeGreaterThan(0);
  });

  it('only schedules changes when a setting actually changes', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 0.2);
    const gains = created.createGain;
    for (let i = 0; i < 100; i++) {
      music.setIntensity(0.5);
      music.setDanger(false);
      music.setTimeScale(1);
      music.setPaused(false);
      music.volume = 0.6;
      music.enabled = true;
      music.soundOn = true;
    }
    expect(created.createGain).toBe(gains);
  });
});

describe('boss phases', () => {
  it('speeds up from the next bar, and ignores a track without phases', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('boss');
    run(raw, 1);
    // Phase 1 is 150 bpm: a step is 0.1 s.
    const p1 = music.position!;
    music.setBossPhase(3);
    run(raw, 10);
    // Without the change it would be 100 steps on; at 170 bpm (0.088 s a step) it is further.
    expect(music.position! - p1).toBeGreaterThan(105);

    music.play('sector1');
    music.setBossPhase(3);
    run(raw, 2);
    // Still 120 bpm: 8 steps a second.
    const p = music.position!;
    run(raw, 1);
    expect(music.position! - p).toBeLessThanOrEqual(9);
  });
});

describe('time scale', () => {
  it('slows the song down', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 1);
    music.setTimeScale(0.5);
    run(raw, 1);
    const p = music.position!;
    run(raw, 2);
    // Half speed: 4 steps a second.
    expect(music.position! - p).toBeGreaterThanOrEqual(7);
    expect(music.position! - p).toBeLessThanOrEqual(9);
  });
});

describe('stingers', () => {
  it('ducks the track under a non-ending stinger, which plays on a beat', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 1);
    const before = notes(created);
    music.stinger('waveClear');
    expect(notes(created)).toBeGreaterThan(before);
    expect(music.track).toBe('sector1');
  });

  it('fades the track out under an ending stinger and leaves track null', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 1);
    music.stinger('victory');
    expect(music.track).toBeNull();
    expect(music.position).toBeNull();
    run(raw, 2);
    expect(vi.getTimerCount()).toBe(0);
    music.play('sector1');
    expect(music.track).toBe('sector1');
  });

  it('plays at once when nothing is playing', () => {
    const { ctx, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.stinger('gameOver');
    expect(notes(created)).toBeGreaterThan(0);
    expect(music.track).toBeNull();
  });

  it('is ignored before attach', () => {
    const music = new Music(undefined, tracks, stingers);
    expect(() => music.stinger('victory')).not.toThrow();
  });
});

describe('ducking', () => {
  it('keeps the timer running until the duck is over', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.duck(1, 0.6);
    expect(vi.getTimerCount()).toBe(1);
    run(raw, 1.5);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('tabbing away', () => {
  function stubDocument() {
    const listeners: (() => void)[] = [];
    const doc = { hidden: false, addEventListener: (_type: string, fn: () => void) => listeners.push(fn) };
    vi.stubGlobal('document', doc);
    return {
      set hidden(value: boolean) {
        doc.hidden = value;
        for (const fn of listeners) fn();
      },
    };
  }

  it('stops scheduling while hidden and carries on from the same place on return', () => {
    const tab = stubDocument();
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 2);

    tab.hidden = true;
    const pos = music.position!;
    const before = notes(created);
    expect(vi.getTimerCount()).toBe(0);
    raw.currentTime += 30;
    vi.advanceTimersByTime(30_000);
    expect(notes(created)).toBe(before);
    expect(music.position).toBe(pos);

    tab.hidden = false;
    // Not caught up to the 30 seconds that passed, not back at the top: where it was.
    expect(music.position!).toBeGreaterThanOrEqual(pos);
    expect(music.position!).toBeLessThan(pos + 4);
    run(raw, 0.5);
    expect(notes(created)).toBeGreaterThan(before);
  });

  it('starts hidden when the page is already in the background', () => {
    const tab = stubDocument();
    tab.hidden = true;
    const { ctx, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    expect(notes(created)).toBe(0);
    tab.hidden = false;
    expect(notes(created)).toBeGreaterThan(0);
  });
});

describe('stinger timing under slow motion', () => {
  it('waits for a beat at the normal tempo, not the slowed one, and never more than half a second', () => {
    const { ctx, raw, nodes } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    music.setTimeScale(0.25);
    run(raw, 3);
    const before = nodes.createOscillator.length;
    music.stinger('waveClear');
    // The first oscillator made after the call is the stinger's first note.
    const first = nodes.createOscillator[before];
    const start = calls(first, 'start')[0][0] as number;
    // A beat at 120 bpm is 0.5 s; a slowed one would be 2 s.
    expect(start - raw.currentTime).toBeLessThanOrEqual(0.5);
    expect(start - raw.currentTime).toBeGreaterThan(0);
  });
});

describe('the limiter', () => {
  it('is a safety limiter: -3 dB, hard knee, ratio 20, fast attack and release', () => {
    const { ctx, nodes } = fakeContext();
    new Music(undefined, tracks, stingers).attach(ctx);
    const [limiter] = nodes.createDynamicsCompressor;
    const value = (name: string) => (limiter as unknown as Record<string, { value: number }>)[name].value;
    expect(value('threshold')).toBe(-3);
    expect(value('knee')).toBe(0);
    expect(value('ratio')).toBe(20);
    expect(value('attack')).toBeCloseTo(0.003);
    expect(value('release')).toBeCloseTo(0.1);
  });
});

describe('stinger routing', () => {
  /** The gain made for the first stinger: the first createGain after `before` gains existed. */
  it('gives each stinger a gain of its own, disconnected once it has finished', () => {
    const { ctx, raw, nodes } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    const before = nodes.createGain.length;
    music.stinger('waveClear');
    const gain = nodes.createGain[before];
    expect(calls(gain, 'disconnect')).toHaveLength(0);
    run(raw, 0.5);
    expect(calls(gain, 'disconnect')).toHaveLength(0);
    run(raw, 2);
    expect(calls(gain, 'disconnect')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fades sounding stingers out when any track is asked for', () => {
    for (const next of ['sector2', null] as const) {
      const { ctx, raw, nodes } = fakeContext();
      const music = new Music(undefined, tracks, stingers);
      music.attach(ctx);
      music.play('sector1');
      run(raw, 1);
      const before = nodes.createGain.length;
      music.stinger('upgrade');
      const gain = nodes.createGain[before];
      expect(calls(gain, 'gain', 'setTargetAtTime')).toHaveLength(0);
      music.play(next);
      const fade = calls(gain, 'gain', 'setTargetAtTime');
      expect(fade).toHaveLength(1);
      expect(fade[0][0]).toBe(0);
      run(raw, 0.6);
      expect(calls(gain, 'disconnect')).toHaveLength(1);
    }
  });

  it('ignores new stingers while an ending stinger sounds, and allows them again after a play()', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 1);
    music.stinger('gameOver');
    const gains = created.createGain;
    music.stinger('waveClear');
    music.stinger('upgrade');
    expect(created.createGain).toBe(gains);
    music.play('title');
    music.stinger('waveClear');
    expect(created.createGain).toBeGreaterThan(gains);
  });

  it('allows stingers again once an ending stinger is over', () => {
    const { ctx, raw, created } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.stinger('victory');
    run(raw, 2);
    const gains = created.createGain;
    music.stinger('waveClear');
    expect(created.createGain).toBeGreaterThan(gains);
  });
});

describe('after an ending stinger', () => {
  it('starts a new play() fresh from the intro instead of reviving the fading track', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 3);
    expect(music.position!).toBeGreaterThan(20);
    music.stinger('gameOver');
    music.play('sector1');
    expect(music.track).toBe('sector1');
    expect(music.position!).toBeLessThan(12);
  });

  it('resets intensity and danger for the fresh start', () => {
    const { ctx, raw, nodes } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    music.setIntensity(1);
    run(raw, 3);
    music.stinger('victory');
    music.play('sector1');
    // The new player's 'high' layer gain starts off (0), as at the start of any track.
    const layerGains = nodes.createGain.slice(-6);
    const off = layerGains.filter((g) => (g as unknown as { gain: { value: number } }).gain.value === 0);
    expect(off.length).toBeGreaterThan(0);
  });

  it('still revives after play(null)', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 3);
    const pos = music.position!;
    music.play(null);
    run(raw, 0.2);
    music.play('sector1');
    expect(music.position!).toBeGreaterThanOrEqual(pos);
  });
});

describe('duck guards', () => {
  it('ignores a duck with a length or depth that is not a finite number', () => {
    const { ctx } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.duck(Infinity, 0.5);
    music.duck(NaN, 0.5);
    music.duck(1, NaN);
    music.duck(1, -Infinity);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clamps a very long duck to ten seconds', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.duck(1000, 5);
    run(raw, 9);
    expect(vi.getTimerCount()).toBe(1);
    run(raw, 2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('lookahead', () => {
  it('rides out a 300 ms stall without late notes', () => {
    const { ctx, raw, nodes } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    run(raw, 1);
    const before = nodes.createOscillator.length;
    // The main thread freezes for 300 ms, then the timer fires once.
    raw.currentTime += 0.3;
    vi.advanceTimersByTime(TICK_MS);
    const fresh = nodes.createOscillator.slice(before);
    expect(fresh.length).toBeGreaterThan(0);
    for (const osc of fresh) expect(calls(osc, 'start')[0][0] as number).toBeGreaterThanOrEqual(raw.currentTime);
  });
});

describe('boss phase memory', () => {
  it('remembers a phase set before the boss track starts playing', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.play('boss');
    music.setBossPhase(3);
    music.attach(ctx);
    run(raw, 5);
    // Phase 1 (150 bpm) would be 50 steps in 5 s; phase 3 (170 bpm) about 56.
    expect(music.position!).toBeGreaterThan(54);
  });

  it('resets to phase 1 when a new track starts', () => {
    const { ctx, raw } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    music.setBossPhase(3);
    music.play('boss');
    run(raw, 5);
    expect(music.position!).toBeLessThan(54);
  });
});

describe('time scale pitch', () => {
  it('drops the pitch by the square root of the scale, not the whole of it', () => {
    const { ctx, raw, nodes } = fakeContext();
    const music = new Music(undefined, tracks, stingers);
    music.attach(ctx);
    music.play('sector1');
    music.setTimeScale(0.25);
    run(raw, 1);
    const before = nodes.createOscillator.length;
    run(raw, 5);
    const pitches = nodes.createOscillator
      .slice(before)
      .flatMap((osc) => calls(osc, 'frequency', 'setValueAtTime').map((c) => c[0] as number));
    // The lead plays C5 through the intro.
    const c5 = 523.251;
    expect(pitches.some((hz) => Math.abs(hz - c5 * 0.5) < 0.5)).toBe(true);
    expect(pitches.some((hz) => Math.abs(hz - c5 * 0.25) < 0.5)).toBe(false);
    expect(pitches.some((hz) => Math.abs(hz - c5) < 0.5)).toBe(false);
  });
});
