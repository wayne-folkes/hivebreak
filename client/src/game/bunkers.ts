import { SHIP_TOP } from './player';
import type { Box, Bunker } from './types';

// Destructible bunkers: four arch-shaped shields just above the ship's row. Each is a small
// pixel mask (one mask pixel = one art pixel) that fire from both sides, and aliens flying
// through, chew away. They are rebuilt at the start of each sector and persist through its
// waves. Everything here is a pure function of the bunkers it is given; the erosion patterns
// are fixed, so there is no randomness.
//
// Mask layout (also what the renderer uploads as a texture): `mask[row * width + col]`, one byte
// per pixel, 1 solid and 0 gone. Row 0 is the BOTTOM row and col 0 is the left column, so the
// pixel at (col, row) covers the field area [x + col, x + col + 1) by [y + row, y + row + 1)
// (field y points up). Flip the rows when uploading if the texture's origin is the top left.
// `version` goes up every time the mask changes; key a texture cache on `id` and `version`.

/** Mask size in art pixels. */
export const BUNKER_WIDTH = 20;
export const BUNKER_HEIGHT = 10;
export const BUNKER_COUNT = 4;
/** Gap between the top of the ship's hit box and the bottom of a bunker, so the ship fits under them. */
export const BUNKER_CLEARANCE = 12;
/** Field y of every bunker's bottom edge. */
export const BUNKER_BOTTOM_Y = SHIP_TOP + BUNKER_CLEARANCE;
/**
 * Field x of each bunker's left edge: four bunkers evenly across the 180-wide field, mirrored
 * about the middle (centres at about -67, -22, 23 and 68).
 */
export const BUNKER_LEFT_XS: readonly number[] = [-78, -33, 13, 58];

// The arch. Corners are trimmed by TOP_TRIMS columns on each side, counted from the top row
// down (so the top corners round off), and the opening at the bottom middle is 8 wide for
// three rows with a narrower step (6 wide) above it.
const TOP_TRIMS: readonly number[] = [3, 2, 1, 1];
const OPENING_ROWS = 3;
const OPENING_WIDTH = 8;
const OPENING_STEP_WIDTH = 6;

/** How the pattern tables below are laid out: pairs of (dx, depth), flat. */
type Pattern = readonly number[];

// Craters, as (dx, depth) pairs from the hit pixel. depth 0 is the hit pixel's row and goes up
// by one per pixel into the bunker, in the direction the shot was travelling.
/** A player shot's small bite: a short plus. */
const PLAYER_BITE: Pattern = [-1, 0, 0, 0, 1, 0, 0, 1, 0, 2];
/** An enemy shot's bigger, ragged splash: wide at the surface, narrowing to a point, one flank chewed. */
const ENEMY_BITE: Pattern = [-2, 0, -1, 0, 0, 0, 1, 0, 2, 0, -2, 1, -1, 1, 0, 1, 1, 1, -1, 2, 0, 2, 1, 2, 0, 3];
/** A piercing shot's tunnel: three wide at the surface, then a single-pixel bore deeper in. */
const PIERCE_TUNNEL: Pattern = [-1, 0, 0, 0, 1, 0, 0, 1, 0, 2, 0, 3];

/** Is the pixel at this column and row (within the mask) still solid? */
export function bunkerPixelSolid(bunker: Bunker, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= bunker.width || row >= bunker.height) return false;
  return bunker.mask[row * bunker.width + col] === 1;
}

/** Is the field point (x, y) inside a solid pixel of this bunker? */
export function bunkerSolidAt(bunker: Bunker, x: number, y: number): boolean {
  return bunkerPixelSolid(bunker, Math.floor(x - bunker.x), Math.floor(y - bunker.y));
}

/** How many solid pixels this bunker has left (for the renderer, tests and "is it gone" checks). */
export function bunkerSolidCount(bunker: Bunker): number {
  let count = 0;
  for (let i = 0; i < bunker.mask.length; i++) count += bunker.mask[i];
  return count;
}

function archMask(): Uint8Array {
  const mask = new Uint8Array(BUNKER_WIDTH * BUNKER_HEIGHT);
  for (let row = 0; row < BUNKER_HEIGHT; row++) {
    const fromTop = BUNKER_HEIGHT - 1 - row;
    const trim = fromTop < TOP_TRIMS.length ? TOP_TRIMS[fromTop] : 0;
    let openLeft = 0;
    let openRight = -1;
    if (row < OPENING_ROWS + 1) {
      const open = row < OPENING_ROWS ? OPENING_WIDTH : OPENING_STEP_WIDTH;
      openLeft = (BUNKER_WIDTH - open) / 2;
      openRight = openLeft + open - 1;
    }
    for (let col = trim; col < BUNKER_WIDTH - trim; col++) {
      if (col >= openLeft && col <= openRight) continue;
      mask[row * BUNKER_WIDTH + col] = 1;
    }
  }
  return mask;
}

/**
 * A fresh set of bunkers, each a full arch. Call at the start of each sector (sector 1 and
 * sector 2), assign the result to `run.bunkers`, and let them persist through that sector's
 * waves. `newId` is the run's id counter, e.g. `() => run.nextId++`.
 */
export function createBunkers(newId: () => number): Bunker[] {
  const template = archMask();
  return BUNKER_LEFT_XS.map((x) => ({
    id: newId(),
    x,
    y: BUNKER_BOTTOM_Y,
    width: BUNKER_WIDTH,
    height: BUNKER_HEIGHT,
    mask: template.slice(),
    version: 0,
  }));
}

/** Clear one pixel; returns whether it was solid. */
function clearPixel(bunker: Bunker, col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= bunker.width || row >= bunker.height) return false;
  const i = row * bunker.width + col;
  if (bunker.mask[i] === 0) return false;
  bunker.mask[i] = 0;
  return true;
}

/** Clear a crater pattern around a hit pixel; `dir` is +1 when depth goes up the field, -1 down. */
function carve(bunker: Bunker, pattern: Pattern, col: number, row: number, dir: 1 | -1, mirror: boolean): boolean {
  let changed = false;
  for (let i = 0; i < pattern.length; i += 2) {
    const dx = mirror ? -pattern[i] : pattern[i];
    if (clearPixel(bunker, col + dx, row + dir * pattern[i + 1])) changed = true;
  }
  if (changed) bunker.version++;
  return changed;
}

/**
 * A shot box touching a bunker. Call once per shot per step, after moving it, with
 * `from: 'below'` for the player's shots (travelling up) and `'above'` for the aliens' and the
 * boss's (travelling down).
 *
 * Finds the first solid pixel the box overlaps (the lowest row for a shot from below, the
 * highest for one from above; the column nearest the box's middle), erodes a crater there and
 * returns where it hit (the pixel's centre, in field coordinates), or null when the box touches
 * nothing solid (so a shot flies on through a hole). On a hit the caller spends the shot and
 * emits `bunkerHit` with `bunker.id`, `x`, `y`, unless `pierce` is set.
 *
 * Craters: a player shot takes a small plus-shaped bite (5 pixels), an enemy shot a bigger
 * ragged splash (13 pixels; one of two mirror images, chosen from the hit pixel, so it is
 * deterministic).
 *
 * Pierce: lance and overcharge shots pass `pierce = true`. They punch through: they dig a narrow
 * tunnel (6 pixels, four deep) instead of a bite, and the caller must NOT spend the shot (nor
 * a pierce charge) on a bunker; it keeps flying and tunnels again next step. The caller may
 * still emit `bunkerHit` for the sound, perhaps not every step.
 */
export function hitBunker(
  bunkers: readonly Bunker[],
  box: Box,
  from: 'above' | 'below',
  pierce = false,
): { bunker: Bunker; x: number; y: number } | null {
  const left = box.x - box.halfWidth;
  const right = box.x + box.halfWidth;
  const bottom = box.y - box.halfHeight;
  const top = box.y + box.halfHeight;
  for (let b = 0; b < bunkers.length; b++) {
    const bunker = bunkers[b];
    // Bounding box first: nearly every shot is nowhere near a bunker.
    if (right <= bunker.x || left >= bunker.x + bunker.width) continue;
    if (top <= bunker.y || bottom >= bunker.y + bunker.height) continue;
    // The pixels the (open) box overlaps, clamped to the mask.
    const colMin = Math.max(0, Math.floor(left - bunker.x));
    const colMax = Math.min(bunker.width - 1, Math.ceil(right - bunker.x) - 1);
    const rowMin = Math.max(0, Math.floor(bottom - bunker.y));
    const rowMax = Math.min(bunker.height - 1, Math.ceil(top - bunker.y) - 1);
    const centre = box.x - bunker.x - 0.5;
    const up = from === 'below';
    for (let step = 0; step <= rowMax - rowMin; step++) {
      const row = up ? rowMin + step : rowMax - step;
      let bestCol = -1;
      let bestDistance = Infinity;
      for (let col = colMin; col <= colMax; col++) {
        if (bunker.mask[row * bunker.width + col] !== 1) continue;
        const distance = Math.abs(col - centre);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCol = col;
        }
      }
      if (bestCol < 0) continue;
      const pattern = pierce ? PIERCE_TUNNEL : up ? PLAYER_BITE : ENEMY_BITE;
      carve(bunker, pattern, bestCol, row, up ? 1 : -1, !pierce && !up && ((bestCol + row) & 1) === 1);
      return { bunker, x: bunker.x + bestCol + 0.5, y: bunker.y + row + 0.5 };
    }
  }
  return null;
}

/**
 * An alien (or anything else with a body) flying through the bunkers: clears every pixel its
 * box overlaps. Call once per step for each alien that can be that low (divers, free drones,
 * minis, the lowest formation rows) with `alienBox(alien)`. Returns whether anything changed.
 */
export function erodeByBox(bunkers: readonly Bunker[], box: Box): boolean {
  return erodeByRect(bunkers, box.x, box.y, box.halfWidth, box.halfHeight);
}

/** `erodeByBox` taking the box as numbers (centre and half sizes), so a caller in a hot loop allocates nothing. */
export function erodeByRect(bunkers: readonly Bunker[], x: number, y: number, halfWidth: number, halfHeight: number): boolean {
  const left = x - halfWidth;
  const right = x + halfWidth;
  const bottom = y - halfHeight;
  const top = y + halfHeight;
  let any = false;
  for (let b = 0; b < bunkers.length; b++) {
    const bunker = bunkers[b];
    if (right <= bunker.x || left >= bunker.x + bunker.width) continue;
    if (top <= bunker.y || bottom >= bunker.y + bunker.height) continue;
    const colMin = Math.max(0, Math.floor(left - bunker.x));
    const colMax = Math.min(bunker.width - 1, Math.ceil(right - bunker.x) - 1);
    const rowMin = Math.max(0, Math.floor(bottom - bunker.y));
    const rowMax = Math.min(bunker.height - 1, Math.ceil(top - bunker.y) - 1);
    let changed = false;
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (clearPixel(bunker, col, row)) changed = true;
      }
    }
    if (changed) {
      bunker.version++;
      any = true;
    }
  }
  return any;
}

/**
 * Where a vertical beam at field x, starting at `fromY` and travelling `direction`, first meets
 * a solid pixel: the y of that pixel's near edge (its bottom edge going up, its top edge going
 * down). Returns `fromY` itself if the beam starts inside solid, and null if nothing is in the
 * way. The caller shortens the beam to this height, then burns a notch with `erodeColumn`.
 */
export function beamStopY(bunkers: readonly Bunker[], x: number, fromY: number, direction: 'up' | 'down'): number | null {
  const up = direction === 'up';
  let best: number | null = null;
  for (let b = 0; b < bunkers.length; b++) {
    const bunker = bunkers[b];
    if (x < bunker.x || x >= bunker.x + bunker.width) continue;
    const col = Math.floor(x - bunker.x);
    if (up) {
      if (fromY >= bunker.y + bunker.height) continue;
      for (let row = Math.max(0, Math.floor(fromY - bunker.y)); row < bunker.height; row++) {
        if (bunker.mask[row * bunker.width + col] !== 1) continue;
        const y = Math.max(fromY, bunker.y + row);
        if (best === null || y < best) best = y;
        break;
      }
    } else {
      if (fromY <= bunker.y) continue;
      for (let row = Math.min(bunker.height - 1, Math.ceil(fromY - bunker.y) - 1); row >= 0; row--) {
        if (bunker.mask[row * bunker.width + col] !== 1) continue;
        const y = Math.min(fromY, bunker.y + row + 1);
        if (best === null || y > best) best = y;
        break;
      }
    }
  }
  return best;
}

/**
 * Burns a notch where a beam touches: clears the solid pixels within `width` art pixels
 * centred on x, in the pixel rows touching y (pass the `beamStopY` result). In practice that is
 * one row of the bunker per call, so a beam bores down through a bunker over several steps; call
 * it every step, or every few for a slower burn. Returns whether anything changed.
 */
export function erodeColumn(bunkers: readonly Bunker[], x: number, y: number, width: number): boolean {
  const left = x - width / 2;
  const right = x + width / 2;
  let any = false;
  for (let b = 0; b < bunkers.length; b++) {
    const bunker = bunkers[b];
    if (right <= bunker.x || left >= bunker.x + bunker.width) continue;
    if (y + 1 <= bunker.y || y - 1 >= bunker.y + bunker.height) continue;
    const colMin = Math.max(0, Math.floor(left - bunker.x));
    const colMax = Math.min(bunker.width - 1, Math.ceil(right - bunker.x) - 1);
    const rowMin = Math.max(0, Math.floor(y - 1 - bunker.y));
    const rowMax = Math.min(bunker.height - 1, Math.ceil(y + 1 - bunker.y) - 1);
    let changed = false;
    for (let row = rowMin; row <= rowMax; row++) {
      for (let col = colMin; col <= colMax; col++) {
        if (clearPixel(bunker, col, row)) changed = true;
      }
    }
    if (changed) {
      bunker.version++;
      any = true;
    }
  }
  return any;
}
