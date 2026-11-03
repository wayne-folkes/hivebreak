import { FIELD_HEIGHT, FIELD_WIDTH } from '../src/game/playfield';

// Where things go on the terminal. The playfield is a fixed grid of half-block pixels, 3 art
// pixels wide and 4 art pixels tall each (terminal cells are about twice as tall as they are wide,
// so a pixel is about square on screen and the field looks a little wider than the web one). The
// field sits in the middle with a status line above and below it and a thin wall either side; a
// side panel on each side shows when the terminal is wide enough.

/** Art pixels per terminal pixel, across and down. */
export const ART_PER_PX_X = 3;
export const ART_PER_PX_Y = 4;
/** The field's size in terminal pixels and in cells. */
export const FIELD_PX_W = FIELD_WIDTH / ART_PER_PX_X; // 60
export const FIELD_PX_H = FIELD_HEIGHT / ART_PER_PX_Y; // 80
export const FIELD_COLS = FIELD_PX_W;
export const FIELD_ROWS = FIELD_PX_H / 2; // 40

/** A side panel's width in cells, when there is room for one. */
export const PANEL_COLS = 22;

/** The smallest terminal the game fits in: the field, its two walls, and a status line above and below. */
export const MIN_COLS = FIELD_COLS + 2;
export const MIN_ROWS = FIELD_ROWS + 2;

export interface Layout {
  /** The terminal's size. */
  cols: number;
  rows: number;
  /** The field's top-left cell. */
  fieldCol: number;
  fieldRow: number;
  /** The status lines' rows (full width of the field and walls). */
  topRow: number;
  bottomRow: number;
  /** The side panels' left columns and width, or null when the terminal is too narrow. */
  leftPanelCol: number | null;
  rightPanelCol: number | null;
}

/** The layout for a terminal of this size, or null when it is too small to play in. */
export function computeLayout(cols: number, rows: number): Layout | null {
  if (cols < MIN_COLS || rows < MIN_ROWS) return null;
  const fieldCol = Math.floor((cols - FIELD_COLS) / 2);
  const fieldRow = Math.floor((rows - FIELD_ROWS) / 2);
  const panels = cols >= MIN_COLS + 2 * (PANEL_COLS + 1);
  return {
    cols,
    rows,
    fieldCol,
    fieldRow,
    topRow: fieldRow - 1,
    bottomRow: fieldRow + FIELD_ROWS,
    leftPanelCol: panels ? fieldCol - 2 - PANEL_COLS : null,
    rightPanelCol: panels ? fieldCol + FIELD_COLS + 2 : null,
  };
}

/**
 * A field position (art pixels, origin at the centre, y up) as a terminal pixel inside the field
 * (0,0 is the field's top-left pixel; y down). Not rounded.
 */
export function toPixel(x: number, y: number): { px: number; py: number } {
  return { px: (x + FIELD_WIDTH / 2) / ART_PER_PX_X, py: (FIELD_HEIGHT / 2 - y) / ART_PER_PX_Y };
}

/** The art-pixel position of a terminal pixel's centre, the inverse of toPixel. */
export function toArt(px: number, py: number): { x: number; y: number } {
  return { x: (px + 0.5) * ART_PER_PX_X - FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2 - (py + 0.5) * ART_PER_PX_Y };
}
