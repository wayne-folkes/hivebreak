import { describe, expect, it } from 'vitest';
import { Frame, encode, to256 } from './frame';

describe('Frame', () => {
  it('keeps two pixels per cell, upper and lower', () => {
    const f = new Frame(4, 2);
    f.pixel(1, 2, 0xff0000);
    f.pixel(1, 3, 0x00ff00);
    expect(f.pixelAt(1, 2)).toBe(0xff0000);
    expect(f.pixelAt(1, 3)).toBe(0x00ff00);
    expect(f.pixelAt(1, 1)).toBe(0);
  });

  it('ignores pixels and text off the frame', () => {
    const f = new Frame(3, 1);
    f.pixel(-1, 0, 1);
    f.pixel(3, 0, 1);
    f.pixel(0, 2, 1);
    f.text(1, 0, 'abcdef', 0xffffff);
    f.text(0, 5, 'x', 0xffffff);
    expect(f.chars).toEqual(['', 'a', 'b']);
  });

  it('turns a text cell back into pixels keeping its background', () => {
    const f = new Frame(1, 1);
    f.text(0, 0, 'A', 0xffffff, 0x123456);
    f.pixel(0, 1, 0xff0000);
    expect(f.chars[0]).toBe('');
    expect(f.pixelAt(0, 0)).toBe(0x123456);
    expect(f.pixelAt(0, 1)).toBe(0xff0000);
  });

  it('keeps the cell background for text with no background of its own', () => {
    const f = new Frame(2, 1, 0x101010);
    f.text(0, 0, 'hi', 0xffffff);
    expect(f.bg[0]).toBe(0x101010);
  });
});

describe('encode', () => {
  it('writes every cell the first time and nothing for an unchanged frame', () => {
    const a = new Frame(3, 2);
    const b = new Frame(3, 2);
    const first = encode(null, a, 'truecolor');
    expect(first.split(' ').length - 1).toBe(6);
    expect(encode(a, b, 'truecolor')).toBe('');
  });

  it('writes only the cells that changed, at their position', () => {
    const a = new Frame(5, 3);
    const b = new Frame(5, 3);
    b.text(2, 1, 'X', 0xffffff);
    const out = encode(a, b, 'truecolor', 10, 20);
    expect(out).toContain('\x1b[22;13H');
    expect(out).toContain('38;2;255;255;255');
    expect(out.match(/H/g)?.length).toBe(1);
    expect(out.endsWith('\x1b[0m')).toBe(true);
  });

  it('draws differing halves with the upper half-block', () => {
    const a = new Frame(1, 1);
    const b = new Frame(1, 1);
    b.pixel(0, 0, 0xff0000);
    expect(encode(a, b, 'truecolor')).toContain('▀');
  });

  it('uses 256-colour codes in that mode', () => {
    const f = new Frame(1, 1);
    f.text(0, 0, 'x', 0xff0000);
    expect(encode(null, f, '256')).toContain('38;5;196');
  });
});

describe('to256', () => {
  it('maps pure colours to the cube and greys to the ramp', () => {
    expect(to256(0xff0000)).toBe(196);
    expect(to256(0x000000)).toBe(16);
    expect(to256(0xffffff)).toBe(231);
    expect(to256(0x808080)).toBe(244);
  });
});
