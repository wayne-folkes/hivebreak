// Pure helpers for drawing Missile Swarm's missiles. The missile model points up (+y) like the
// player's shots, so a missile flying with velocity (vx, vy) is turned about z by this angle.

/** The z-rotation that points a nose-up model along (vx, vy); `fallback` when it is not moving. */
export function missileAngle(vx: number, vy: number, fallback = 0): number {
  if (vx * vx + vy * vy < 1e-6) return fallback;
  return Math.atan2(-vx, vy);
}

/**
 * The y scale of the exhaust (which pivots at the nozzle): a fast flicker around 1.2 that is
 * different for every missile (`seed`), so a swarm doesn't pulse in step. Always positive.
 */
export function exhaustScale(t: number, seed: number): number {
  return 1.2 + 0.35 * Math.sin(t * 47 + seed * 2.3) + 0.15 * Math.sin(t * 71 + seed);
}

/** Whether a missile drops a trail particle this frame: every other frame, staggered by id so they don't all drop at once. */
export function dropsTrail(frame: number, id: number): boolean {
  return ((frame + id) & 1) === 0;
}
