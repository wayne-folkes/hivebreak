// The fixed colour palette the finished picture is snapped to, so everything on screen shares
// one limited set of colours, like old pixel art. The same list feeds the post-process shader.

/**
 * The palette, as 0xRRGGBB. Index 0 is the background and outline colour. The rest came from
 * clustering the colours a whole autopiloted run actually draws (models at their three toon
 * levels, stars, shots, explosions), so every role keeps a bright, a mid and a dark shade.
 */
export const PALETTE: readonly number[] = [
  0x07040f, 0x181226, 0x3d2475, 0x5f28a0, 0x883ecd, 0xac55f7,
  0x604da8, 0x7869aa, 0x9391b9, 0xc1c3eb, 0xffffff, 0xd3f1ff,
  0x9dfafd, 0x52ddeb, 0x2db3dd, 0x278da6, 0x2a5b80, 0x1b3a4b,
  0xff56da, 0x8f2a8a, 0xcd6037, 0xe9a251, 0xffe164, 0xff8a45,
];

/** Channel weights for colour distance: green counts most, blue least. */
const WEIGHT = [0.3, 0.59, 0.11] as const;

/** Index of the palette entry nearest to an 8-bit colour. */
export function nearestPaletteIndex(r: number, g: number, b: number, palette: readonly number[] = PALETTE): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i];
    const dr = r - ((c >> 16) & 255);
    const dg = g - ((c >> 8) & 255);
    const db = b - (c & 255);
    const dist = WEIGHT[0] * dr * dr + WEIGHT[1] * dg * dg + WEIGHT[2] * db * db;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

export { WEIGHT as PALETTE_WEIGHT };
