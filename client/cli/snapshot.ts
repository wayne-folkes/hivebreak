import { deflateSync } from 'node:zlib';
import type { Frame } from './frame';

// Dev-only: renders a Frame to a PNG so a drawing can be looked at without a terminal. Not
// imported by the game. Each cell becomes 8 x 16 image pixels; a pixel cell is two 8 x 8 squares
// (upper and lower), a text cell is its background with the glyph approximated: block characters
// are drawn as the blocks they are, anything else as a small solid block in the foreground
// colour, which is enough to see where text sits (use frameText to read it).

export const CELL_W = 8;
export const CELL_H = 16;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** An RGB image (3 bytes per pixel, row by row) as a PNG file. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, y * (width * 3 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** The shade a block-shade character covers (░ ▒ ▓), as a fraction of the foreground. */
const SHADES: Record<string, number> = { '░': 0.25, '▒': 0.5, '▓': 0.75 };

function mixRgb(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 0xff) * (1 - t) + ((b >> s) & 0xff) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Renders the frame; `scale` repeats each image pixel that many times each way. */
export function framePng(frame: Frame, scale = 1): Buffer {
  const w = frame.cols * CELL_W;
  const h = frame.rows * CELL_H;
  const img = new Uint8Array(w * h * 3);
  const put = (x: number, y: number, c: number) => {
    const i = (y * w + x) * 3;
    img[i] = (c >> 16) & 0xff;
    img[i + 1] = (c >> 8) & 0xff;
    img[i + 2] = c & 0xff;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, c);
  };
  for (let row = 0; row < frame.rows; row++) {
    for (let col = 0; col < frame.cols; col++) {
      const i = row * frame.cols + col;
      const x = col * CELL_W;
      const y = row * CELL_H;
      const ch = frame.chars[i];
      const fg = frame.fg[i];
      const bg = frame.bg[i];
      if (ch === '') {
        fill(x, y, x + CELL_W, y + CELL_H / 2, fg);
        fill(x, y + CELL_H / 2, x + CELL_W, y + CELL_H, bg);
        continue;
      }
      fill(x, y, x + CELL_W, y + CELL_H, bg);
      if (ch === ' ') continue;
      if (ch === '█') fill(x, y, x + CELL_W, y + CELL_H, fg);
      else if (ch === '▀') fill(x, y, x + CELL_W, y + CELL_H / 2, fg);
      else if (ch === '▄') fill(x, y + CELL_H / 2, x + CELL_W, y + CELL_H, fg);
      else if (ch === '▌') fill(x, y, x + CELL_W / 2, y + CELL_H, fg);
      else if (ch === '▐') fill(x + CELL_W / 2, y, x + CELL_W, y + CELL_H, fg);
      else if (ch === '▏') fill(x, y, x + 1, y + CELL_H, fg);
      else if (SHADES[ch] !== undefined) fill(x, y, x + CELL_W, y + CELL_H, mixRgb(bg, fg, SHADES[ch]));
      else if (ch === '│') fill(x + 3, y, x + 5, y + CELL_H, fg);
      else if (ch === '─') fill(x, y + 7, x + CELL_W, y + 9, fg);
      else if (ch === '·') fill(x + 3, y + 7, x + 5, y + 9, fg);
      else fill(x + 1, y + 4, x + 7, y + 12, fg);
    }
  }
  if (scale <= 1) return encodePng(w, h, img);
  const sw = w * scale;
  const sh = h * scale;
  const big = new Uint8Array(sw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const s = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 3;
      const d = (y * sw + x) * 3;
      big[d] = img[s];
      big[d + 1] = img[s + 1];
      big[d + 2] = img[s + 2];
    }
  }
  return encodePng(sw, sh, big);
}

/** The frame's text cells as plain lines (pixel cells read as spaces), for reading what the PNG only hints at. */
export function frameText(frame: Frame): string[] {
  const lines: string[] = [];
  for (let row = 0; row < frame.rows; row++) {
    let line = '';
    for (let col = 0; col < frame.cols; col++) {
      const ch = frame.chars[row * frame.cols + col];
      line += ch === '' ? ' ' : ch;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
