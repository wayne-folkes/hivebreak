// The playfield is drawn at a fixed low resolution and scaled up by whole pixels, so every
// art pixel stays square and crisp. It's tall (9:16) to fit a phone held upright; wider
// screens letterbox it, and taller ones keep the spare height under it for the touch strip.

/** Width of the playfield in art pixels. */
export const FIELD_WIDTH = 180;
/** Height of the playfield in art pixels. */
export const FIELD_HEIGHT = 320;

export interface Fit {
  /** Screen pixels per art pixel. A whole number unless the screen is smaller than the field. */
  scale: number;
  /** Size and position of the playfield on the page, in CSS pixels. */
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Where to draw the playfield in a viewport of this size (CSS pixels), at this device pixel
 * ratio. The field sits centred across and as high as it can while still centred in any
 * leftover height, so a tall phone gets its spare room below the field.
 */
export function fitPlayfield(viewWidth: number, viewHeight: number, dpr: number): Fit {
  const deviceWidth = viewWidth * dpr;
  const deviceHeight = viewHeight * dpr;
  const fit = Math.min(deviceWidth / FIELD_WIDTH, deviceHeight / FIELD_HEIGHT);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const width = (FIELD_WIDTH * scale) / dpr;
  const height = (FIELD_HEIGHT * scale) / dpr;
  return {
    scale,
    width,
    height,
    left: (viewWidth - width) / 2,
    top: viewWidth / viewHeight < FIELD_WIDTH / FIELD_HEIGHT ? 0 : (viewHeight - height) / 2,
  };
}
