// The Warper's warp-in, as pure functions of its progress so they can be tested on their own.
// `progress` is how far through the warp-in the Warper is: 0 as it lands, 1 as it is solid.

/** Seconds a warp-afterimage lasts. */
export const WARP_GHOST_SECONDS = 0.32;

/** How far a Warper has materialised: 0 at the start of its warp-in, 1 once `warp` (seconds left) runs out. */
export function warpProgress(warp: number | undefined, warpSeconds: number): number {
  if (warp === undefined || warp <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - warp / warpSeconds));
}

/** The Warper's size while it materialises: small at first, growing past full size a little and settling to 1. */
export function warpScale(progress: number): number {
  if (progress >= 1) return 1;
  const t = Math.max(0, progress) - 1;
  // Ease-out-back: overshoots before settling.
  const back = 1 + 2.4 * t * t * t + 1.4 * t * t;
  return 0.2 + 0.8 * back;
}

/** How the Warper is coloured as it materialises: a white flash as it lands, teal flicker, then its own colours. */
export type WarpTint = 'white' | 'teal' | 'none';

export function warpTint(progress: number, frame: number): WarpTint {
  if (progress >= 1) return 'none';
  if (progress < 0.14) return 'white';
  // The flicker slows as it settles: teal on every other frame early on, then less of the time.
  const teal = Math.floor(frame / 2) % 2 === 0 || progress < 0.5;
  return progress < 0.85 && teal ? 'teal' : 'none';
}

/** The size of a warp afterimage `age` seconds old: it shrinks to nothing. */
export function ghostScale(age: number): number {
  return Math.max(0, 1 - age / WARP_GHOST_SECONDS);
}
