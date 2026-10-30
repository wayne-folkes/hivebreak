import { parsePattern, validateSong, validateStinger, type Pattern, type NoteEvent } from './pattern';
import type { Channel, Layer, PhaseGear, Song, Stinger, StingerChannel } from './song';

// The sequencer's scheduling maths, kept pure so it can be tested without Web Audio: where the
// song is, which notes start on a step, which layers are on, and when things land. The
// Web Audio side (player.ts, voices.ts) only turns the answers into nodes.

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v)));

/** Slowest the time scale goes. */
export const MIN_TIME_SCALE = 0.2;

/** Intensity at which the `mid` and `high` layers come in. */
export const MID_INTENSITY = 1 / 3;
export const HIGH_INTENSITY = 2 / 3;

/** How far behind (seconds) a step may be before the scheduler skips ahead instead of firing it late. */
export const LATE_TOLERANCE = 0.05;

/** Seconds per step at a tempo; a time scale below 1 stretches it (tape-style slow down). */
export function stepSeconds(bpm: number, stepsPerBeat: number, scale = 1): number {
  return 60 / (bpm * stepsPerBeat * scale);
}

/** A time scale kept inside MIN_TIME_SCALE to 1 (NaN counts as normal speed). */
export function clampTimeScale(scale: number): number {
  return Number.isNaN(scale) ? 1 : clamp(scale, MIN_TIME_SCALE, 1);
}

/**
 * How much the pitch falls for a time scale: the square root of it (0.5 gives x0.71, 0.25 gives
 * x0.5), not the full tape drop, which would take the bass below hearing. Tempo still follows
 * the scale itself.
 */
export function pitchScale(scale: number): number {
  return Math.sqrt(clampTimeScale(scale));
}

/** A boss phase kept inside 1 to 3, whole. */
export function clampPhase(phase: number): number {
  return Math.round(clamp(phase, 1, 3));
}

/** A tempo and key for a boss phase; a song without phases always has its own tempo and no shift. */
export function gearFor(song: Song, phase: number): PhaseGear {
  const phases = song.phases;
  if (!phases || phases.length === 0) return { bpm: song.bpm, transpose: 0 };
  return phases[Math.min(clampPhase(phase), phases.length) - 1];
}

// --- Layers -------------------------------------------------------------------------------

/** What decides which layers are on. */
export interface MixState {
  /** 0 to 1. */
  intensity: number;
  danger: boolean;
  /** Boss phase, 1 to 3. */
  phase: number;
}

export function layerOn(layer: Layer, state: MixState): boolean {
  switch (layer) {
    case 'base':
      return true;
    case 'mid':
      return state.intensity >= MID_INTENSITY - 1e-9;
    case 'high':
      return state.intensity >= HIGH_INTENSITY - 1e-9;
    case 'danger':
      return state.danger;
    case 'phase2':
      return state.phase >= 2;
    case 'phase3':
      return state.phase >= 3;
  }
}

const ALL_LAYERS: readonly Layer[] = ['base', 'mid', 'high', 'danger', 'phase2', 'phase3'];

/** The layers that sound for a state. */
export function activeLayers(state: MixState): Set<Layer> {
  return new Set(ALL_LAYERS.filter((layer) => layerOn(layer, state)));
}

// --- Parsed songs and where notes fall ------------------------------------------------------

export interface ParsedChannel {
  channel: Channel;
  drums: boolean;
  /** Notes by the step they start on, over the intro (empty when the channel rests through it). */
  intro: (NoteEvent | undefined)[];
  /** Notes by start step over one repeat of the channel's loop. */
  loop: (NoteEvent | undefined)[];
}

export interface ParsedSong {
  song: Song;
  channels: ParsedChannel[];
}

function byStart(pattern: Pattern): (NoteEvent | undefined)[] {
  const out: (NoteEvent | undefined)[] = new Array(pattern.steps).fill(undefined);
  for (const note of pattern.notes) out[note.at] = note;
  return out;
}

/** Parses every pattern of a song once. Throws an Error listing what is wrong when the song is invalid. */
export function parseSong(song: Song): ParsedSong {
  const errors = validateSong(song);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return {
    song,
    channels: song.channels.map((channel) => {
      const drums = channel.instrument === 'drums';
      return {
        channel,
        drums,
        intro: channel.intro === undefined ? [] : byStart(parsePattern(channel.intro, drums)),
        loop: byStart(parsePattern(channel.loop, drums)),
      };
    }),
  };
}

/** A note or hit that starts on a step. `channel` indexes the song's channels. */
export interface StepEvent {
  channel: number;
  event: NoteEvent;
}

/**
 * The notes that start on a step. Steps count from the start of the song: the intro once, then
 * the loop over and over, each channel's shorter loop repeating inside it.
 */
export function eventsAtStep(parsed: ParsedSong, step: number): StepEvent[] {
  if (step < 0) return [];
  const { introSteps, loopSteps } = parsed.song;
  const out: StepEvent[] = [];
  parsed.channels.forEach((channel, index) => {
    let event: NoteEvent | undefined;
    if (step < introSteps) {
      event = channel.intro[step];
    } else {
      const loop = channel.loop;
      event = loop[((step - introSteps) % loopSteps) % loop.length];
    }
    if (event) out.push({ channel: index, event });
  });
  return out;
}

/** Notes starting in the steps from `from` up to (not including) `to`, with the step each falls on. */
export function eventsInWindow(parsed: ParsedSong, from: number, to: number): (StepEvent & { step: number })[] {
  const out: (StepEvent & { step: number })[] = [];
  for (let step = Math.max(0, from); step < to; step++) {
    for (const e of eventsAtStep(parsed, step)) out.push({ ...e, step });
  }
  return out;
}

/** Whether a step starts a bar. Bars count from the start of the song (the intro is whole bars). */
export function isBarLine(step: number, stepsPerBar: number): boolean {
  return step % stepsPerBar === 0;
}

/** Whether a step starts a beat. */
export function isBeat(step: number, stepsPerBeat: number): boolean {
  return step % stepsPerBeat === 0;
}

// --- Keeping time ----------------------------------------------------------------------------

export interface Clock {
  /** The next step to schedule. */
  pos: number;
  /** When that step starts (AudioContext seconds). */
  nextTime: number;
  /** Steps skipped to catch up. */
  skipped: number;
}

/**
 * If the next step is already well in the past (a throttled timer), skips whole steps so the
 * song stays on the wall clock instead of firing a burst of late notes. A step less than
 * `tolerance` late is left alone.
 */
export function skipBehind(pos: number, nextTime: number, now: number, stepSec: number, tolerance = LATE_TOLERANCE): Clock {
  if (nextTime >= now - tolerance) return { pos, nextTime, skipped: 0 };
  const skipped = Math.ceil((now - nextTime) / stepSec);
  return { pos: pos + skipped, nextTime: nextTime + skipped * stepSec, skipped };
}

/**
 * When the next beat starts, given when a beat last did and how long a beat lasts. Always at least
 * `lead` seconds after `now`. With no beat yet, that is simply `now + lead`.
 */
export function nextBeatTime(lastBeatAt: number | null, beatSec: number, now: number, lead = 0.03): number {
  const earliest = now + lead;
  if (lastBeatAt === null || !(beatSec > 0)) return earliest;
  return lastBeatAt + beatSec * Math.ceil((earliest - lastBeatAt) / beatSec - 1e-9);
}

/** The longest (seconds) a stinger waits for a beat before starting right away instead. */
export const MAX_STINGER_WAIT = 0.5;

/**
 * When a stinger starts: on the next beat at the track's own, unscaled tempo (`beatSec`), so
 * slow motion doesn't hold it up; but if that beat is more than MAX_STINGER_WAIT away, at
 * `now + lead`.
 */
export function stingerStart(lastBeatAt: number | null, beatSec: number, now: number, lead = 0.03): number {
  const beat = nextBeatTime(lastBeatAt, beatSec, now, lead);
  return beat - now > MAX_STINGER_WAIT ? now + lead : beat;
}

/** The time the clock restarts at after the tab comes back: right away, unless already ahead. */
export function resumeTime(nextTime: number, now: number, lead = 0.05): number {
  return Math.max(nextTime, now + lead);
}

// --- Stingers --------------------------------------------------------------------------------

export interface ParsedStinger {
  stinger: Stinger;
  channels: { channel: StingerChannel; drums: boolean; pattern: Pattern }[];
  /** Length in steps of the longest channel. */
  steps: number;
}

/** Parses a stinger's patterns once. Throws an Error listing what is wrong when it is invalid. */
export function parseStinger(stinger: Stinger): ParsedStinger {
  const errors = validateStinger(stinger);
  if (errors.length > 0) throw new Error(errors.join('; '));
  const channels = stinger.channels.map((channel) => {
    const drums = channel.instrument === 'drums';
    return { channel, drums, pattern: parsePattern(channel.notes, drums) };
  });
  return { stinger, channels, steps: channels.reduce((n, c) => Math.max(n, c.pattern.steps), 0) };
}

/** How long a stinger's notes run, in seconds (before the last note's release). */
export function stingerSeconds(parsed: ParsedStinger): number {
  return parsed.steps * stepSeconds(parsed.stinger.bpm, parsed.stinger.stepsPerBeat);
}
