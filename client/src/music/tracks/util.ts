// Small helpers for writing songs: chords as data, so the bass, arpeggio and pad of a song all
// come from the same progression and cannot drift out of tune with each other.

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** The note name for a MIDI number, e.g. 60 is 'C4'. */
export const noteName = (midi: number): string => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

export type Quality = 'm' | 'M' | 'm7' | '7' | 'dim';

const INTERVALS: Record<Quality, number[]> = {
  m: [0, 3, 7],
  M: [0, 4, 7],
  m7: [0, 3, 7, 10],
  '7': [0, 4, 7, 10],
  dim: [0, 3, 6],
};

const PITCH_CLASS = {
  C: 0, 'C#': 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, Bb: 10, B: 11,
} as const;

export interface Chord {
  /** Pitch class of the root, 0 (C) to 11 (B). */
  pc: number;
  quality: Quality;
}

/** A chord: `chord('D', 'm')` is D minor. */
export const chord = (root: keyof typeof PITCH_CLASS, quality: Quality): Chord => ({ pc: PITCH_CLASS[root], quality });

/** Shorthand for a progression: `prog('Em', 'C', 'D', 'B7')`. A trailing 'm', 'm7', '7' or 'dim' sets the quality. */
export function prog(...names: string[]): Chord[] {
  return names.map((name) => {
    const m = /^([A-G][#b]?)(m7|m|7|dim)?$/.exec(name);
    if (!m) throw new Error(`bad chord '${name}'`);
    return chord(m[1] as keyof typeof PITCH_CLASS, (m[2] as Quality | undefined) ?? 'M');
  });
}

/** A line of bars joined with bar lines. */
export const bars = (...parts: string[]): string => parts.join(' | ');

/** One note held for `len` steps. */
export const hold = (note: string, len: number): string => [note, ...Array<string>(len - 1).fill('-')].join(' ');

/** A run of `len` rests. */
export const rest = (len: number): string => Array<string>(len).fill('.').join(' ');

const tokensOf = (template: string): string[] => template.split(/\s+/).filter((t) => t !== '' && t !== '|');

/** Template for bar `i`: a single template repeats every bar; a list is indexed by bar (cycling). */
function templateFor(template: string | string[], i: number): string {
  return typeof template === 'string' ? template : template[i % template.length];
}

/**
 * Bass line from chords. Each template is one bar; its tokens are `R` (the chord root, in the
 * C2 to B2 octave), `r` (the root an octave up), `f` (a fifth above the root), `s` (a minor
 * seventh above it), `+n` (n semitones above it), and `.` `-` as usual; a trailing `!` accents.
 */
export function bassLine(chords: Chord[], template: string | string[]): string {
  return bars(
    ...chords.map((c, i) => {
      const base = 36 + c.pc;
      return tokensOf(templateFor(template, i))
        .map((t) => {
          const accent = t.endsWith('!') ? '!' : '';
          const core = accent ? t.slice(0, -1) : t;
          const offset =
            core === 'R' ? 0 : core === 'r' ? 12 : core === 'f' ? 7 : core === 's' ? 10 : /^\+\d+$/.test(core) ? Number(core.slice(1)) : null;
          return offset === null ? t : `${noteName(base + offset)}${accent}`;
        })
        .join(' ');
    }),
  );
}

/** The chord's tones climbing from the first one at or above MIDI `low`, `count` notes long. */
export function stack(c: Chord, low: number, count: number): number[] {
  const ivl = INTERVALS[c.quality];
  let root = low - (low % 12) + c.pc;
  if (root < low) root += 12;
  return Array.from({ length: count }, (_, i) => root + 12 * Math.floor(i / ivl.length) + ivl[i % ivl.length]);
}

/**
 * Arpeggio from chords. Digits 1 to 8 pick the chord's tones climbing from the first one at or
 * above `low` (1 root, 2 third, 3 fifth, 4 octave, 5 octave third, 6 octave fifth, ...).
 */
export function arpLine(chords: Chord[], template: string | string[], low = 57): string {
  return bars(
    ...chords.map((c, i) => {
      const tones = stack(c, low, 8);
      return tokensOf(templateFor(template, i))
        .map((t) => {
          const accent = t.endsWith('!') ? '!' : '';
          const core = accent ? t.slice(0, -1) : t;
          return /^[1-8]$/.test(core) ? `${noteName(tones[Number(core) - 1])}${accent}` : t;
        })
        .join(' ');
    }),
  );
}

/**
 * The chord's three tones as a close voicing around MIDI `center` (each tone placed as near to
 * the center as it gets), lowest first. Neighbouring chords therefore move by small steps.
 */
export function voicing(c: Chord, center: number): number[] {
  return INTERVALS[c.quality]
    .slice(0, 3)
    .map((i) => {
      const pc = (c.pc + i) % 12;
      let m = center - (center % 12) + pc;
      while (m - center > 6) m -= 12;
      while (center - m > 6) m += 12;
      return m;
    })
    .sort((a, b) => a - b);
}

/** One voice (0 low, 1 middle, 2 high) of the chords' pads: each chord is a note held for `len` steps. */
export function padLine(chords: Chord[], voice: 0 | 1 | 2, center: number, len = 16): string {
  return bars(...chords.map((c) => hold(noteName(voicing(c, center)[voice]), len)));
}
