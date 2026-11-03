import type { Frame, Rgb } from './frame';
import { FIELD_PX_H, FIELD_PX_W } from './layout';
import type { AlienKind, ShipId } from '../src/game/types';

// The terminal pixel art: a Canvas that draws into the field's rectangle of the frame (clipping
// everything to it), colour helpers, and the hand-authored sprites for the aliens and ships.
//
// A sprite is a few strings, one character per terminal pixel. '.' and ' ' are transparent; any
// other character looks up its colour in the palette passed to drawSprite:
//   h highlight   b body   d dark   e eye / cockpit / accent

/** Mixes two colours, t = 0 gives a and t = 1 gives b. */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  const ch = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * k) & 0xff;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

export const lighten = (c: Rgb, t: number): Rgb => mix(c, 0xffffff, t);
export const darken = (c: Rgb, t: number): Rgb => mix(c, 0x000000, t);

/** The field's terminal pixels as a drawing surface: (0, 0) is the field's top-left pixel; anything outside is ignored. */
export class Canvas {
  constructor(
    readonly frame: Frame,
    /** The field's top-left cell column and its first pixel row (cell row * 2). */
    readonly ox: number,
    readonly oy: number,
  ) {}

  readonly width = FIELD_PX_W;
  readonly height = FIELD_PX_H;

  /** Sets the pixel containing (px, py). */
  set(px: number, py: number, c: Rgb): void {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (!(x >= 0 && x < FIELD_PX_W && y >= 0 && y < FIELD_PX_H)) return;
    this.frame.pixel(this.ox + x, this.oy + y, c);
  }

  /** The colour of the pixel containing (px, py); black outside the field. */
  get(px: number, py: number): Rgb {
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (!(x >= 0 && x < FIELD_PX_W && y >= 0 && y < FIELD_PX_H)) return 0;
    return this.frame.pixelAt(this.ox + x, this.oy + y);
  }

  /** Mixes a colour into the pixel by `alpha` (0 leaves it, 1 replaces it). */
  blend(px: number, py: number, c: Rgb, alpha: number): void {
    if (alpha <= 0) return;
    if (alpha >= 1) {
      this.set(px, py, c);
      return;
    }
    const x = Math.floor(px);
    const y = Math.floor(py);
    if (!(x >= 0 && x < FIELD_PX_W && y >= 0 && y < FIELD_PX_H)) return;
    this.frame.pixel(this.ox + x, this.oy + y, mix(this.frame.pixelAt(this.ox + x, this.oy + y), c, alpha));
  }

  /** Fills a rectangle of pixels. */
  rect(x: number, y: number, w: number, h: number, c: Rgb): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** A line of single pixels from (x0, y0) to (x1, y1), both ends included. */
  line(x0: number, y0: number, x1: number, y1: number, c: Rgb): void {
    const steps = Math.min(400, Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, c);
    }
  }
}

export type SpriteRows = readonly string[];

/** Width of a sprite's widest row. */
export function spriteWidth(rows: SpriteRows): number {
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  return w;
}

/** Draws a sprite with its top-left pixel at (left, top). */
export function drawSprite(cv: Canvas, rows: SpriteRows, left: number, top: number, palette: Readonly<Record<string, Rgb>>): void {
  for (let j = 0; j < rows.length; j++) {
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '.' || ch === ' ') continue;
      const c = palette[ch];
      if (c !== undefined) cv.set(left + i, top + j, c);
    }
  }
}

/** Draws a sprite centred on a (possibly fractional) pixel position. */
export function drawSpriteCentred(cv: Canvas, rows: SpriteRows, px: number, py: number, palette: Readonly<Record<string, Rgb>>): void {
  const w = spriteWidth(rows);
  drawSprite(cv, rows, Math.round(px - w / 2), Math.round(py - rows.length / 2), palette);
}

// Aliens ----------------------------------------------------------------------------------------

/** Each alien kind's body colour (the same hues as the web game's explosions). */
export const ALIEN_COLOUR: Record<AlienKind, Rgb> = {
  drone: 0xb04cff,
  warden: 0xff4fd8,
  diver: 0xff7a3d,
  carrier: 0x3fd6a0,
  splitter: 0xe0455a,
  mini: 0xff7a6a,
  warper: 0xa46bff,
  mender: 0x4fff9b,
};

/** Two animation frames per kind, about the size of the kind's hit box (3 x 4 art pixels per pixel). */
export const ALIEN_SPRITES: Record<AlienKind, readonly [SpriteRows, SpriteRows]> = {
  drone: [
    ['.hhh.', 'bebeb', 'b.b.b'],
    ['.hhh.', 'bebeb', '.b.b.'],
  ],
  warden: [
    ['hhhhhh', 'bdeedb', '.b..b.'],
    ['hhhhhh', 'bdeedb', 'b....b'],
  ],
  diver: [
    ['bbhbb', '.beb.', '..b..'],
    ['b.h.b', 'bbebb', '..b..'],
  ],
  carrier: [
    ['.hhhhh.', 'bbbbbbb', 'bdeeedb', '.d...d.'],
    ['.hhhhh.', 'bbbbbbb', 'bdeeedb', '..d.d..'],
  ],
  splitter: [
    ['hb..bh', 'bbeebb', '.bddb.'],
    ['hb..bh', 'bbeebb', 'b.dd.b'],
  ],
  mini: [
    ['beb', '.b.'],
    ['beb', 'b.b'],
  ],
  // Sector 3. The Warper is an angular arrowhead with a teal core; the Mender a green blob with a white cross.
  warper: [
    ['hb.bh', 'bbtbb', '.bdb.'],
    ['hb.bh', 'bbtbb', '..d..'],
  ],
  mender: [
    ['dbwbd', 'bwwwb', '.bwb.'],
    ['.bwb.', 'bwwwb', 'dbwbd'],
  ],
};

/** The Warper's second hue and the Mender's cross; the white and teal an alien's palette adds for them. */
export const WARPER_TEAL = 0x3fe8d0;

/** A mine, 3 x 2 pixels: steel with a light (r) that the renderer blinks, dim (R) when it is off. */
export const MINE_SPRITE: SpriteRows = ['hrh', 'sds'];
export const MINE_SPRITE_OFF: SpriteRows = ['hRh', 'sds'];
export const MINE_STEEL = 0x9a98b0;
export const MINE_RED = 0xff3a3a;

/** The eye colour, and what it turns to on a badly hurt multi-hit alien. */
const EYE = 0xfff27a;
const EYE_HURT = 0xff3030;

/**
 * The palette for an alien: its kind's colours, white all over while it flashes, and a dulled,
 * red-eyed look once it has lost hit points.
 */
export function alienPalette(kind: AlienKind, hp: number, maxHp: number, flash: boolean, tint: (c: Rgb) => Rgb = (c) => c): Record<string, Rgb> {
  if (flash) return { h: 0xffffff, b: 0xffffff, d: 0xe8e4ff, e: 0xffffff, t: 0xffffff, w: 0xffffff };
  const base = ALIEN_COLOUR[kind];
  const hurt = maxHp > 1 ? Math.min(1, Math.max(0, 1 - hp / maxHp)) : 0;
  const body = darken(base, hurt * 0.45);
  return {
    h: tint(hurt > 0 ? body : lighten(base, 0.45)),
    b: tint(body),
    d: tint(darken(base, 0.45 + hurt * 0.2)),
    e: tint(hurt > 0 && hp <= 1 ? EYE_HURT : EYE),
    t: tint(WARPER_TEAL),
    w: tint(0xffffff),
  };
}

// Ships -----------------------------------------------------------------------------------------

/** Each ship's colour. Cold hues, so they stand apart from the hive. */
export const SHIP_COLOUR: Record<ShipId, Rgb> = {
  breaker: 0x4ff0ff,
  interceptor: 0xffe164,
  lancer: 0xc9a8ff,
  bastion: 0xffa54f,
};

export const SHIP_SPRITES: Record<ShipId, SpriteRows> = {
  breaker: ['..h..', '.bhb.', 'bbebb', 'b.d.b'],
  interceptor: ['..h..', '..b..', '.bhb.', 'bbebb'],
  lancer: ['h...h', 'hb.bh', '.beb.', '.bdb.'],
  bastion: ['..bhb..', '.bbebb.', 'bbbbbbb', 'd.bdb.d'],
};

/** Pixels below the hull where the engine flames show: the columns (from the sprite's left) of each flame. */
export const SHIP_FLAMES: Record<ShipId, readonly number[]> = {
  breaker: [2],
  interceptor: [2],
  lancer: [2],
  bastion: [1, 5],
};

export function shipPalette(ship: ShipId, tint: (c: Rgb) => Rgb = (c) => c): Record<string, Rgb> {
  const base = SHIP_COLOUR[ship];
  return { h: tint(lighten(base, 0.55)), b: tint(base), d: tint(darken(base, 0.5)), e: tint(0xffffff) };
}

/** A wingman: a small ship beside yours. */
export const WINGMAN_SPRITE: SpriteRows = ['.h.', 'bhb', 'b.b'];
/** The helper drone that circles the ship. */
export const HELPER_SPRITE: SpriteRows = ['dhd', '.b.'];
