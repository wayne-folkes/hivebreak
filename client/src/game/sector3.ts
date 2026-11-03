import type { Alien, RunEvent, RunState } from './types';

// Sector 3's aliens: the Warper, which blinks to an empty slot in the formation the first time a
// hit doesn't kill it, and the Mender, which every few seconds heals its damaged neighbours.
//
// TODO(4a worker): implement. run.ts calls these hooks; keep their signatures.

/** Seconds a Warper takes to warp in at its new slot; shots pass through it meanwhile. */
export const WARP_SECONDS = 0.35;
/** Seconds between a Mender's healing pulses (enemy time). */
export const MEND_INTERVAL = 4;

/**
 * An alien took damage and lived (from any source: a shot, the laser, a chain spark, a burst, the
 * well). A Warper that hasn't blinked yet blinks to an empty slot now, with an alienWarped event.
 */
export function alienHitSurvived(_run: RunState, _alien: Alien, _events: RunEvent[]): void {}

/** Ticks Menders' pulses and Warpers' warp-ins, on enemy time (not called while frozen or stunned). */
export function stepSector3Aliens(_run: RunState, _dt: number, _events: RunEvent[]): void {}

/** Whether shots, beams and arcs can touch this alien right now (not while a Warper warps in). */
export function canBeHit(alien: Alien): boolean {
  return !(alien.warp !== undefined && alien.warp > 0);
}
