import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';

// Sector 2's red nebula: a few soft blobs of colour behind the stars, quantised to chunky
// blocks and a handful of flat levels so it reads as pixel art (and snaps cleanly to the
// palette). Built once as RGBA bytes for a texture; nothing here touches WebGL, so it can be
// tested on its own.

/** Size of one nebula "pixel" in art pixels. */
export const NEBULA_BLOCK = 4;

/** Flat colours, dim to bright; level 0 is nothing (the sky shows through). All are palette entries. */
export const NEBULA_LEVELS: readonly number[] = [0x2a0812, 0x4a0f24, 0x6e1830];
/** Where each level starts, as a blob density from 0 to about 1. */
export const NEBULA_THRESHOLDS: readonly number[] = [0.16, 0.34, 0.55];

interface Blob {
  x: number;
  y: number;
  radius: number;
  strength: number;
}

// Pixel positions from the top-left, like the concept page: a big one up-left, a smaller one low-right.
const BLOBS: readonly Blob[] = [
  { x: 40, y: 90, radius: 120, strength: 0.95 },
  { x: 150, y: 215, radius: 105, strength: 0.7 },
  { x: 130, y: 40, radius: 60, strength: 0.4 },
];

/** How dense the nebula is at a point, from 0 up: blobs that fall off smoothly, with a little ripple so they aren't round. */
export function nebulaDensity(x: number, y: number): number {
  let sum = 0;
  for (const b of BLOBS) {
    const dx = x - b.x;
    const dy = y - b.y;
    const angle = Math.atan2(dy, dx);
    const ripple = 1 + 0.18 * Math.sin(angle * 3 + b.x * 0.1) + 0.1 * Math.sin(angle * 5 - b.y * 0.2);
    const d = Math.hypot(dx, dy) / (b.radius * ripple);
    if (d < 1) sum += b.strength * (1 - d) * (1 - d * 0.35);
  }
  return sum;
}

/** The level (0 for none, 1 to NEBULA_LEVELS.length) a density falls in. */
export function nebulaLevel(density: number): number {
  let level = 0;
  for (let i = 0; i < NEBULA_THRESHOLDS.length; i++) if (density >= NEBULA_THRESHOLDS[i]) level = i + 1;
  return level;
}

/**
 * The nebula as RGBA bytes, row 0 at the bottom (a texture's own order), `FIELD_WIDTH` by
 * `FIELD_HEIGHT`. Alpha is 255 where there is nebula and 0 where there is not.
 */
export function buildNebula(width = FIELD_WIDTH, height = FIELD_HEIGHT, block = NEBULA_BLOCK): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let by = 0; by < height; by += block) {
    for (let bx = 0; bx < width; bx += block) {
      // Sample at the block's centre, in pixels from the top-left.
      const level = nebulaLevel(nebulaDensity(bx + block / 2, by + block / 2));
      if (level === 0) continue;
      const hex = NEBULA_LEVELS[level - 1];
      for (let y = by; y < Math.min(by + block, height); y++) {
        const row = height - 1 - y;
        for (let x = bx; x < Math.min(bx + block, width); x++) {
          const i = (row * width + x) * 4;
          data[i] = (hex >> 16) & 255;
          data[i + 1] = (hex >> 8) & 255;
          data[i + 2] = hex & 255;
          data[i + 3] = 255;
        }
      }
    }
  }
  return data;
}
