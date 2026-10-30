import type { BossPart } from '../game/types';

// Maps the boss's parts (from the sim, in the order its layout creates them) to the named nodes
// of the Brood Mother model, and holds the little bits of timing the view uses on them.

/** The model node a part is drawn as: `plate_0`..`plate_3` left to right, `core`, `bay_L`, `bay_R`. */
export function bossPartNames(parts: readonly BossPart[]): string[] {
  let plates = 0;
  return parts.map((p) => {
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
