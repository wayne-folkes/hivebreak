import { describe, expect, it } from 'vitest';
import { clipboardSequence, colorModeFrom } from './term';

describe('colorModeFrom', () => {
  it('lets HIVEBREAK_COLOR override detection', () => {
    expect(colorModeFrom({ HIVEBREAK_COLOR: '256', COLORTERM: 'truecolor' })).toBe('256');
    expect(colorModeFrom({ HIVEBREAK_COLOR: 'truecolor' })).toBe('truecolor');
  });

  it('ignores an unknown HIVEBREAK_COLOR', () => {
    expect(colorModeFrom({ HIVEBREAK_COLOR: 'rainbow' })).toBe('256');
  });

  it('is truecolor when COLORTERM says so', () => {
    expect(colorModeFrom({ COLORTERM: 'truecolor' })).toBe('truecolor');
    expect(colorModeFrom({ COLORTERM: '24bit' })).toBe('truecolor');
  });

  it('is truecolor for the known terminal programs', () => {
    for (const TERM_PROGRAM of ['iTerm.app', 'ghostty', 'WezTerm', 'vscode']) {
      expect(colorModeFrom({ TERM_PROGRAM })).toBe('truecolor');
    }
  });

  it('is 256 colours in Apple Terminal, which only gained truecolor in macOS 26', () => {
    expect(colorModeFrom({ TERM_PROGRAM: 'Apple_Terminal' })).toBe('256');
  });

  it('is truecolor for the TERM names that carry it', () => {
    expect(colorModeFrom({ TERM: 'xterm-kitty' })).toBe('truecolor');
    expect(colorModeFrom({ TERM: 'alacritty' })).toBe('truecolor');
    expect(colorModeFrom({ TERM: 'xterm-direct' })).toBe('truecolor');
    expect(colorModeFrom({ TERM: 'xterm-256color' })).toBe('256');
  });

  it('defaults to 256 colours', () => {
    expect(colorModeFrom({})).toBe('256');
  });
});

describe('clipboardSequence', () => {
  it('sends the text base64-encoded in an OSC 52 clipboard request', () => {
    const seq = clipboardSequence('Hive é');
    expect(seq).toBe(`\x1b]52;c;${Buffer.from('Hive é', 'utf8').toString('base64')}\x07`);
    const payload = seq.slice('\x1b]52;c;'.length, -1);
    expect(Buffer.from(payload, 'base64').toString('utf8')).toBe('Hive é');
  });
});
