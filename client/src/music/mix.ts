import { clampTimeScale } from './timeline';

// The music's level maths, pure: master level, ducking, and the low-pass that closes for slow
// motion and pausing. How the pieces combine:
//
//   output level = master (setting x pause) x duck (all ducks, deepest wins) x track bus x layer
//   brightness   = the lower of the time-scale cutoff and the pause cutoff

/** Loudest the music master goes; the volume setting scales within this. */
export const MAX_MUSIC_LEVEL = 0.5;
/** The master's share while a pause menu is up. */
export const PAUSE_LEVEL = 0.4;
/** The low-pass cutoff (Hz) while paused. */
export const PAUSE_CUTOFF = 700;
/** The low-pass cutoff (Hz) at normal speed: wide open. */
export const OPEN_CUTOFF = 20000;
/** The low-pass cutoff (Hz) at a time scale of 0.25 or lower. */
export const SLOW_CUTOFF = 900;
/** Seconds a time-scale change glides over. */
export const SCALE_GLIDE = 0.3;
/** Longest a duck's recovery may be (seconds). */
export const MAX_DUCK_SECONDS = 10;
/** Seconds a duck takes to reach its depth. */
export const DUCK_ATTACK = 0.05;

const clamp = (v: number, lo: number, hi: number) => (Number.isNaN(v) ? lo : Math.min(hi, Math.max(lo, v)));

export interface MasterState {
  enabled: boolean;
  soundOn: boolean;
  /** The music volume setting, 0 to 1. */
  volume: number;
  paused: boolean;
  /** The tab is in the background. */
  hidden: boolean;
}

/** The music master's gain: 0 when off, muted or in a background tab. */
export function masterLevel(state: MasterState): number {
  if (!state.enabled || !state.soundOn || state.hidden) return 0;
  return MAX_MUSIC_LEVEL * clamp(state.volume, 0, 1) * (state.paused ? PAUSE_LEVEL : 1);
}

/**
 * The low-pass cutoff (Hz) for a time scale: wide open at 1, closing smoothly (evenly in
 * octaves) to SLOW_CUTOFF at 0.25 and below.
 */
export function scaleCutoff(scale: number): number {
  const s = clamp(clampTimeScale(scale), 0.25, 1);
  return OPEN_CUTOFF * (SLOW_CUTOFF / OPEN_CUTOFF) ** ((1 - s) / 0.75);
}

/** The music bus's cutoff: the lower of the time-scale cutoff and the pause one. */
export function busCutoff(scale: number, paused: boolean): number {
  const slow = scaleCutoff(scale);
  return paused ? Math.min(slow, PAUSE_CUTOFF) : slow;
}

/** A value gliding linearly from `from` at `start` to `to` over `dur` seconds, at time `t`. */
export function glide(from: number, to: number, start: number, dur: number, t: number): number {
  if (t <= start) return from;
  if (t >= start + dur) return to;
  return from + ((to - from) * (t - start)) / dur;
}

// --- Ducking -----------------------------------------------------------------------------------

/**
 * A dip in the music: down by `depth` over DUCK_ATTACK from `start`, held for `hold` seconds, then
 * back up linearly over `recover`.
 */
export interface Duck {
  start: number;
  depth: number;
  hold: number;
  recover: number;
}

/** A duck from the game: dips at once and recovers over `seconds`. */
export function makeDuck(start: number, seconds: number, depth: number): Duck {
  return { start, depth: clamp(depth, 0, 1), hold: 0, recover: clamp(seconds, DUCK_ATTACK, MAX_DUCK_SECONDS) };
}

/** When a duck is over. */
export function duckEnd(duck: Duck): number {
  return duck.start + DUCK_ATTACK + duck.hold + duck.recover;
}

/** How far down one duck has pulled the music at time `t` (0 to its depth). */
export function duckDepthAt(duck: Duck, t: number): number {
  const x = t - duck.start;
  if (x <= 0) return 0;
  if (x < DUCK_ATTACK) return (duck.depth * x) / DUCK_ATTACK;
  const y = x - DUCK_ATTACK - duck.hold;
  if (y <= 0) return duck.depth;
  if (y >= duck.recover) return 0;
  return duck.depth * (1 - y / duck.recover);
}

/** The music's duck gain at time `t`: 1 for no duck, less for the deepest of the ducks in force. */
export function duckLevel(ducks: readonly Duck[], t: number): number {
  let depth = 0;
  for (const duck of ducks) depth = Math.max(depth, duckDepthAt(duck, t));
  return 1 - depth;
}

/** The ducks still in force at `t` (a new list). */
export function liveDucks(ducks: readonly Duck[], t: number): Duck[] {
  return ducks.filter((duck) => duckEnd(duck) > t);
}
