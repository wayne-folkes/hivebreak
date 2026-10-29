import type { StorageLike } from './records';
import type { RunEvent } from './types';

// Sound effects, synthesized live with the Web Audio API from oscillators and noise. There are no
// sound files: it costs nothing to download and suits the retro look.
//
// Browsers only allow audio after the player has touched the page, so nothing plays until
// unlock() is called on the first key press, click or tap.

export const SETTINGS_KEY = 'hivebreak.settings.v1';

export interface SoundSettings {
  enabled: boolean;
  /** 0 to 1, from the settings slider. */
  volume: number;
}

export const DEFAULT_SOUND_SETTINGS: SoundSettings = { enabled: true, volume: 0.75 };

/** Loudest the master output goes; the volume setting scales within this. */
const MAX_LEVEL = 0.8;
/** Most voices of one cue that may sound at once, so a crowd of kills doesn't clip. */
export const MAX_VOICES = 4;
/** Shortest gap (seconds) between two player shots that both make a sound. */
export const PLAYER_FIRE_GAP = 0.04;
/** Seconds for a note to rise to full level. */
const ATTACK_TIME = 0.008;
/** Pitch (Hz) of a combo x1 kill. */
const KILL_BASE_HZ = 200;
/** Pitch (Hz) of a single player shot. */
const PLAYER_SHOT_HZ = 1320;
/** Highest combo multiplier. */
const MAX_COMBO = 8;

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v)));

/**
 * The pitch (Hz) of a kill's crunch. It climbs a whole tone for each combo step, so a chain
 * sounds like it's climbing. Divers ring a little brighter.
 */
export function killPitch(combo: number, diver = false): number {
  const steps = clamp(Math.round(combo), 1, MAX_COMBO) - 1;
  return KILL_BASE_HZ * 2 ** ((steps * 2) / 12) * (diver ? 1.25 : 1);
}

/** The pitch (Hz) of a player's shot: a semitone lower for each extra shot in the volley. */
export function playerFirePitch(shots: number): number {
  const extra = Math.max(0, Math.round(shots) - 1);
  return PLAYER_SHOT_HZ * 2 ** (-extra / 12);
}

/**
 * Seconds for a note to fade in. Short notes ease in over a quarter of their length, so they
 * never start with a click.
 */
export function attackTime(dur: number): number {
  return Math.min(ATTACK_TIME, dur / 4);
}

/** How long a cue sounds, in seconds, from its first note to its last. */
export function soundLength(parts: readonly Part[]): number {
  return parts.reduce((end, part) => Math.max(end, (part.delay ?? 0) + part.dur), 0);
}

/**
 * Whether another voice of a cue may start at `now`. `ends` are when the voices already playing
 * finish (seconds). Finished voices are dropped. Returns the live voices with the new one added,
 * or null when the cue is already at MAX_VOICES. The list passed in is not changed.
 */
export function admitVoice(ends: readonly number[], now: number, length: number): number[] | null {
  const live = ends.filter((end) => end > now);
  if (live.length >= MAX_VOICES) return null;
  return [...live, now + length];
}

/** Whether a player's shot may sound, given when the last one did (seconds). */
export function playerFireReady(lastAt: number, now: number): boolean {
  return now - lastAt >= PLAYER_FIRE_GAP;
}

/** One note or noise burst in a cue. Times are seconds, relative to the cue's start. */
export type Part =
  | { kind: 'tone'; freq: number; to?: number; dur: number; wave: OscillatorType; vol: number; delay?: number }
  | {
      kind: 'noise';
      from: number;
      to: number;
      dur: number;
      filter: BiquadFilterType;
      q: number;
      vol: number;
      delay?: number;
    };

function tone(freq: number, dur: number, wave: OscillatorType, vol: number, to?: number, delay = 0): Part {
  return { kind: 'tone', freq, to, dur, wave, vol, delay };
}

/** A run of notes, each one `step` long; the last one is held for `hold` steps. */
function arpeggio(notes: readonly number[], step: number, wave: OscillatorType, vol: number, hold = 1): Part[] {
  return notes.map(
    (freq, i): Part => tone(freq, i === notes.length - 1 ? step * hold : step, wave, vol, undefined, i * step),
  );
}

/** The notes and bursts that make up one game event's sound. */
export function partsFor(event: RunEvent): Part[] {
  switch (event.type) {
    case 'waveStart':
      return arpeggio([523, 659, 784], 0.09, 'square', 0.12, 2);
    case 'playerFired': {
      // Quiet, since it repeats a lot.
      const pitch = playerFirePitch(event.shots);
      return [tone(pitch, 0.06, 'square', 0.05, pitch * 0.75)];
    }
    case 'alienFired':
      return [tone(420, 0.18, 'triangle', 0.1, 180)];
    case 'alienHit':
      // Two inharmonic partials give the tick its metal ring.
      return [tone(2100, 0.04, 'square', 0.07, 1900), tone(3150, 0.03, 'square', 0.04)];
    case 'alienKilled': {
      const pitch = killPitch(event.combo, event.kind === 'diver');
      return [
        { kind: 'noise', from: pitch * 6, to: pitch * 1.2, dur: 0.2, filter: 'bandpass', q: 1.2, vol: 0.3 },
        tone(pitch, 0.12, 'square', 0.12, pitch * 0.5),
      ];
    }
    case 'diveStart':
      return [tone(1400, 0.5, 'sine', 0.14, 300)];
    case 'comboBroken':
      return arpeggio([523, 392], 0.08, 'square', 0.12, 1.75);
    case 'shieldHit':
      return [tone(1200, 0.22, 'triangle', 0.12, 2400), tone(2400, 0.18, 'triangle', 0.06, 3200, 0.05)];
    case 'playerHit':
      return [
        { kind: 'noise', from: 1400, to: 90, dur: 0.6, filter: 'lowpass', q: 0.7, vol: 0.6 },
        tone(120, 0.45, 'sine', 0.5, 40),
      ];
    case 'waveClear':
      return arpeggio([659, 784, 988, 1319], 0.07, 'square', 0.12, 3);
    case 'upgradePicked':
      return [tone(1319, 0.3, 'triangle', 0.14), tone(1976, 0.28, 'triangle', 0.08, undefined, 0.05)];
    case 'won':
      return arpeggio([523, 659, 784, 1047], 0.12, 'square', 0.14, 3.3);
    case 'lost':
      return arpeggio([392, 349, 311, 262], 0.3, 'triangle', 0.16, 2);
  }
}

export type UiSound = 'move' | 'confirm' | 'back';

/** The menu sounds: a tick for moving, a rising pair for confirming, a falling pair for going back. */
export function uiParts(name: UiSound): Part[] {
  switch (name) {
    case 'move':
      return [tone(660, 0.04, 'square', 0.06)];
    case 'confirm':
      return arpeggio([880, 1320], 0.06, 'square', 0.1, 2);
    case 'back':
      return [tone(440, 0.09, 'square', 0.1, 330)];
  }
}

interface Output {
  ctx: AudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

export class Sound {
  private on: boolean;
  private level: number;
  private out: Output | null = null;
  /** When the voices of each cue finish, in AudioContext seconds. */
  private readonly voices = new Map<string, number[]>();
  /** When a player's shot last made a sound, in AudioContext seconds. */
  private lastFireAt = -Infinity;

  constructor(settings: SoundSettings = DEFAULT_SOUND_SETTINGS) {
    this.on = settings.enabled;
    this.level = clamp(settings.volume, 0, 1);
  }

  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
    this.applyLevel();
  }

  /** 0 to 1. */
  get volume(): number {
    return this.level;
  }

  set volume(volume: number) {
    this.level = clamp(volume, 0, 1);
    this.applyLevel();
  }

  /** Creates the audio context. Call it from a user gesture: a key press, click or the end of a tap (a touch's pointerdown doesn't count); safe to call again. */
  unlock(): void {
    if (!this.out) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const master = ctx.createGain();
      master.gain.value = this.outputLevel();
      master.connect(ctx.destination);
      this.out = { ctx, master, noise: whiteNoise(ctx) };
    }
    // iOS also 'interrupts' a context after a call or a screen lock; resume covers both.
    const state: string = this.out.ctx.state;
    if (state === 'suspended' || state === 'interrupted') void this.out.ctx.resume().catch(() => {});
  }

  /** Plays the sound for each event that happened during a step. */
  handle(events: readonly RunEvent[]): void {
    for (const event of events) {
      if (event.type === 'playerFired') {
        if (!playerFireReady(this.lastFireAt, this.now())) continue;
        if (this.play(event.type, partsFor(event))) this.lastFireAt = this.now();
      } else {
        this.play(event.type, partsFor(event));
      }
    }
  }

  /** Plays a menu sound. */
  ui(name: UiSound): void {
    this.play(`ui:${name}`, uiParts(name));
  }

  private outputLevel(): number {
    return this.on ? MAX_LEVEL * this.level : 0;
  }

  private applyLevel(): void {
    if (this.out) this.out.master.gain.setTargetAtTime(this.outputLevel(), this.out.ctx.currentTime, 0.02);
  }

  private now(): number {
    return this.out?.ctx.currentTime ?? 0;
  }

  /** Schedules a cue now, unless it is off, not unlocked, or already at its voice limit. */
  private play(cue: string, parts: readonly Part[]): boolean {
    const out = this.out;
    if (!out || !this.on) return false;
    const t = out.ctx.currentTime;
    const ends = admitVoice(this.voices.get(cue) ?? [], t, soundLength(parts));
    if (!ends) return false;
    this.voices.set(cue, ends);
    for (const part of parts) this.schedule(out, part, t);
    return true;
  }

  private schedule(out: Output, part: Part, t0: number): void {
    const { ctx, master } = out;
    const t = t0 + (part.delay ?? 0);
    if (part.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = part.wave;
      osc.frequency.setValueAtTime(part.freq, t);
      if (part.to) osc.frequency.exponentialRampToValueAtTime(part.to, t + part.dur);
      osc.connect(envelope(ctx, t, part)).connect(master);
      osc.start(t);
      osc.stop(t + part.dur + 0.05);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = out.noise;
      const filter = ctx.createBiquadFilter();
      filter.type = part.filter;
      filter.Q.value = part.q;
      filter.frequency.setValueAtTime(part.from, t);
      filter.frequency.exponentialRampToValueAtTime(part.to, t + part.dur);
      src.connect(filter).connect(envelope(ctx, t, part)).connect(master);
      src.start(t, Math.random() * 0.5);
      src.stop(t + part.dur + 0.05);
    }
  }
}

/** A quick attack and an exponential fade out over the part's length. */
function envelope(ctx: AudioContext, t: number, part: Part): GainNode {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, part.vol), t + attackTime(part.dur));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + part.dur);
  return gain;
}

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/**
 * The saved sound settings. Missing, corrupt or unreadable storage gives the defaults; a value
 * of the wrong type falls back to its default, and a volume is kept within 0 to 1.
 */
export function loadSoundSettings(storage: StorageLike): SoundSettings {
  const saved = readSettings(storage);
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULT_SOUND_SETTINGS.enabled,
    volume:
      typeof saved.volume === 'number' && Number.isFinite(saved.volume)
        ? clamp(saved.volume, 0, 1)
        : DEFAULT_SOUND_SETTINGS.volume,
  };
}

/**
 * Saves the sound settings. Other settings already under the key are kept. If storage is full or
 * blocked, the settings still apply for this visit.
 */
export function saveSoundSettings(storage: StorageLike, settings: SoundSettings): void {
  try {
    const value = {
      ...readSettings(storage),
      enabled: settings.enabled,
      volume: clamp(settings.volume, 0, 1),
    };
    storage.setItem(SETTINGS_KEY, JSON.stringify(value));
  } catch {
    // Can't remember the settings; they still apply for this visit.
  }
}

/** The saved settings object, or an empty one if there is nothing readable. */
function readSettings(storage: StorageLike): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? 'null');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
