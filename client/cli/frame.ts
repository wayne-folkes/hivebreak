// The terminal picture: a grid of character cells that everything draws into, and the encoder that
// turns it into ANSI escape codes. A cell holds either text (a character with a foreground and a
// background colour) or two square-ish "pixels" stacked one above the other, drawn with the upper
// half-block character: its foreground is the upper pixel, its background the lower one. So the
// pixel layer is cols wide and rows * 2 tall.
//
// The game loop draws a whole new frame each time and the encoder sends only the cells that differ
// from the previous one.

/** A colour as 0xRRGGBB. */
export type Rgb = number;

export const BLACK: Rgb = 0x000000;

const UPPER_HALF = '▀';

/** How colours are written: 24-bit, or the nearest of the 256-colour palette. */
export type ColorMode = 'truecolor' | '256';

export class Frame {
  readonly cols: number;
  readonly rows: number;
  /** One character per cell; '' means a pixel cell (upper half-block, or a space when both halves match). */
  readonly chars: string[];
  readonly fg: Int32Array;
  readonly bg: Int32Array;
  readonly bold: Uint8Array;

  constructor(cols: number, rows: number, background: Rgb = BLACK) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.chars = new Array<string>(n).fill('');
    this.fg = new Int32Array(n);
    this.bg = new Int32Array(n);
    this.bold = new Uint8Array(n);
    this.clear(background);
  }

  /** Every cell becomes a pixel cell of this colour. */
  clear(background: Rgb = BLACK): void {
    this.chars.fill('');
    this.fg.fill(background);
    this.bg.fill(background);
    this.bold.fill(0);
  }

  /**
   * Sets one pixel. `py` counts half-rows from the top: 0 is the upper half of row 0, 1 its lower
   * half. Off-frame pixels are ignored, and a text cell becomes a pixel cell (both halves keep
   * its background, then this half takes the colour).
   */
  pixel(px: number, py: number, color: Rgb): void {
    px = Math.floor(px);
    py = Math.floor(py);
    if (px < 0 || py < 0 || px >= this.cols || py >= this.rows * 2) return;
    const i = (py >> 1) * this.cols + px;
    if (this.chars[i] !== '') {
      this.chars[i] = '';
      this.fg[i] = this.bg[i];
      this.bold[i] = 0;
    }
    if (py & 1) this.bg[i] = color;
    else this.fg[i] = color;
  }

  /** The colour of a pixel (for a text cell, its background). Off-frame is black. */
  pixelAt(px: number, py: number): Rgb {
    px = Math.floor(px);
    py = Math.floor(py);
    if (px < 0 || py < 0 || px >= this.cols || py >= this.rows * 2) return BLACK;
    const i = (py >> 1) * this.cols + px;
    if (this.chars[i] !== '') return this.bg[i];
    return py & 1 ? this.bg[i] : this.fg[i];
  }

  /** Fills a rectangle of pixels; x, y, width and height in pixels. */
  fillPixels(px: number, py: number, width: number, height: number, color: Rgb): void {
    for (let y = Math.floor(py); y < py + height; y++) {
      for (let x = Math.floor(px); x < px + width; x++) this.pixel(x, y, color);
    }
  }

  /**
   * Writes text from (col, row), one character per cell, clipped at the frame's edges. With
   * `bg` null each cell keeps its current background (a pixel cell's lower half).
   */
  text(col: number, row: number, s: string, fg: Rgb, bg: Rgb | null = null, bold = false): void {
    if (row < 0 || row >= this.rows) return;
    let c = col;
    for (const ch of s) {
      if (c >= this.cols) break;
      if (c >= 0) {
        const i = row * this.cols + c;
        const back = bg ?? this.bg[i];
        this.chars[i] = ch;
        this.fg[i] = fg;
        this.bg[i] = back;
        this.bold[i] = bold ? 1 : 0;
      }
      c++;
    }
  }

  /** Text centred on a column range: `col` is the left edge, `width` the range's width. */
  textCentered(col: number, row: number, width: number, s: string, fg: Rgb, bg: Rgb | null = null, bold = false): void {
    const len = [...s].length;
    this.text(col + Math.floor((width - len) / 2), row, s, fg, bg, bold);
  }

  /** Fills a rectangle of cells with spaces of one background. */
  fillCells(col: number, row: number, width: number, height: number, bg: Rgb): void {
    for (let r = row; r < row + height; r++) this.text(col, r, ' '.repeat(Math.max(0, width)), bg, bg);
  }

  /** A single-line box border around the rectangle (the border is on its outer cells). */
  box(col: number, row: number, width: number, height: number, fg: Rgb, bg: Rgb | null = null): void {
    if (width < 2 || height < 2) return;
    const inner = '─'.repeat(width - 2);
    this.text(col, row, `┌${inner}┐`, fg, bg);
    this.text(col, row + height - 1, `└${inner}┘`, fg, bg);
    for (let r = row + 1; r < row + height - 1; r++) {
      this.text(col, r, '│', fg, bg);
      this.text(col + width - 1, r, '│', fg, bg);
    }
  }
}

// Encoding -------------------------------------------------------------------------------------

const ESC = '\x1b[';

/** The nearest colour in the xterm 256-colour palette (the 6x6x6 cube or the grey ramp). */
export function to256(rgb: Rgb): number {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const cube = [0, 95, 135, 175, 215, 255];
  const ri = level(r);
  const gi = level(g);
  const bi = level(b);
  const cubeDist = (cube[ri] - r) ** 2 + (cube[gi] - g) ** 2 + (cube[bi] - b) ** 2;
  const grey = Math.round((r + g + b) / 3);
  const gi24 = grey < 8 ? 0 : grey > 238 ? 23 : Math.round((grey - 8) / 10);
  const gv = 8 + gi24 * 10;
  const greyDist = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  return greyDist < cubeDist ? 232 + gi24 : 16 + 36 * ri + 6 * gi + bi;
}

function sgrColor(rgb: Rgb, background: boolean, mode: ColorMode): string {
  if (mode === '256') return `${background ? 48 : 38};5;${to256(rgb)}`;
  return `${background ? 48 : 38};2;${(rgb >> 16) & 0xff};${(rgb >> 8) & 0xff};${rgb & 0xff}`;
}

/**
 * The escape codes that turn the screen showing `prev` into `next`, written at the terminal's
 * (originRow, originCol), 0-based. With no `prev` (or a different size) every cell is written.
 * Leaves the colours reset at the end.
 */
export function encode(prev: Frame | null, next: Frame, mode: ColorMode, originCol = 0, originRow = 0): string {
  const full = !prev || prev.cols !== next.cols || prev.rows !== next.rows;
  let out = '';
  let curFg = -1;
  let curBg = -1;
  let curBold = -1;
  /** Where the terminal's cursor is after the last write, as a cell index, or -1 when unknown. */
  let cursor = -1;
  for (let row = 0; row < next.rows; row++) {
    for (let col = 0; col < next.cols; col++) {
      const i = row * next.cols + col;
      let ch = next.chars[i];
      let fg = next.fg[i];
      const bg = next.bg[i];
      const bold = next.bold[i];
      if (!full && prev.chars[i] === ch && prev.fg[i] === fg && prev.bg[i] === bg && prev.bold[i] === bold) continue;
      if (ch === '') {
        // A pixel cell with matching halves is just a space of that colour.
        if (fg === bg) ch = ' ';
        else ch = UPPER_HALF;
      }
      if (ch === ' ') fg = curFg === -1 ? fg : curFg;
      if (cursor !== i) out += `${ESC}${originRow + row + 1};${originCol + col + 1}H`;
      const sgr: string[] = [];
      if (bold !== curBold) {
        sgr.push(bold ? '1' : '22');
        curBold = bold;
      }
      if (fg !== curFg) {
        sgr.push(sgrColor(fg, false, mode));
        curFg = fg;
      }
      if (bg !== curBg) {
        sgr.push(sgrColor(bg, true, mode));
        curBg = bg;
      }
      if (sgr.length > 0) out += `${ESC}${sgr.join(';')}m`;
      out += ch;
      cursor = col + 1 < next.cols ? i + 1 : -1;
    }
  }
  if (out !== '') out += `${ESC}0m`;
  return out;
}
