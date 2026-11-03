import type { BossPart } from '../game/types';

// Maps the boss's parts (from the sim, in the order its layout creates them) to the named nodes
// of the Brood Mother model, and holds the little bits of timing the view uses on them.

/**
 * The model node a part is drawn as: `plate_0`..`plate_3` left to right, `core`, `bay_L`, `bay_R`
 * for the Brood Mother; `seg_0`..`seg_7` and `core` for the Hive Mind; `vein_0`..`vein_3` and
 * `core` (drawn as the model's `heart` and `heart_core`) for the Hive Heart.
 */
export function bossPartNames(parts: readonly BossPart[]): string[] {
  let plates = 0;
  let segments = 0;
  let veins = 0;
  return parts.map((p) => {
    if (p.kind === 'vein') return `vein_${veins++}`;
    if (p.kind === 'segment') return `seg_${segments++}`;
    if (p.kind === 'plate') return `plate_${plates++}`;
    if (p.kind === 'bay') return p.dx < 0 ? 'bay_L' : 'bay_R';
    return 'core';
  });
}

/** The light strip under a bay. */
export function bayGlowName(bayName: string): string {
  return bayName === 'bay_L' ? 'bay_glow_L' : 'bay_glow_R';
}

/** Seconds before a Drone launch that the bays start to glow and blink. */
export const LAUNCH_WARNING_SECONDS = 1.3;

/**
 * How far into the warning before a launch we are, 0 (not warning) to 1 (about to launch).
 * `launchTimer` is seconds until the launch; a stunned or still-descending boss isn't warning.
 */
export function launchWarning(launchTimer: number, active: boolean): number {
  if (!active || launchTimer >= LAUNCH_WARNING_SECONDS) return 0;
  return Math.min(1, 1 - Math.max(0, launchTimer) / LAUNCH_WARNING_SECONDS);
}

/** The core's pulse: a gentle throb in phase 1 and a fast, deep one in phase 2. Scale factor around 1. */
export function corePulse(phase: number, time: number): number {
  return phase >= 2 ? 1 + 0.2 * Math.sin(time * 11) + 0.06 * Math.sin(time * 4) : 1 + 0.07 * Math.sin(time * 3);
}

/** The Hive Mind's core pulse: a slow throb in phase 1, faster and deeper in phase 2, a frantic one in phase 3. */
export function hiveCorePulse(phase: number, time: number): number {
  if (phase >= 3) return 1 + 0.2 * Math.sin(time * 12) + 0.07 * Math.sin(time * 5);
  if (phase === 2) return 1 + 0.12 * Math.sin(time * 7);
  return 1 + 0.06 * Math.sin(time * 3);
}

/** The glow behind the core in phase 3: 0 before it, then a size that swells and shrinks. */
export function hiveGlowScale(phase: number, time: number): number {
  return phase >= 3 ? 1 + 0.25 * Math.sin(time * 9) : 0;
}

// The Hive Heart ------------------------------------------------------------------------------

/** How long a heartbeat's pulse lasts, seconds. */
export const HEART_PULSE_SECONDS = 0.3;
const HEART_PULSE_RISE = 0.05;

/**
 * The beat's envelope, 0 to 1: a quick swell to the peak, then an easing back over the rest of
 * `HEART_PULSE_SECONDS`. `age` is seconds since the beat (a negative age or a finished pulse is 0).
 */
export function heartPulse(age: number): number {
  if (age < 0 || age >= HEART_PULSE_SECONDS) return 0;
  if (age < HEART_PULSE_RISE) return age / HEART_PULSE_RISE;
  const left = 1 - (age - HEART_PULSE_RISE) / (HEART_PULSE_SECONDS - HEART_PULSE_RISE);
  return left * left;
}

/** How much the heart swells at the peak of a beat (a fraction of its size): a little more in phase 3. */
export function heartBeatSwell(phase: number): number {
  return phase >= 3 ? 0.14 : 0.1;
}

/** The heart's resting throb between beats: a gentle swell, quicker and deeper each phase. Scale factor around 1. */
export function heartIdle(phase: number, time: number): number {
  if (phase >= 3) return 1 + 0.025 * Math.sin(time * 14);
  if (phase === 2) return 1 + 0.018 * Math.sin(time * 8);
  return 1 + 0.012 * Math.sin(time * 4);
}

/** How big a cut vein's shrivelled stump is, as a fraction of the whole vein (it shrinks toward its root at the heart). */
export const VEIN_STUMP_SCALE = 0.5;

/** True while any of the Heart's veins still stands (and shields it). */
export function veinsStanding(parts: readonly BossPart[]): boolean {
  for (const p of parts) if (p.kind === 'vein' && p.hp > 0) return true;
  return false;
}
