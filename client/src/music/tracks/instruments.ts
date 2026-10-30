import type { Instrument } from '../song';

// Shared instruments. Levels are peaks of one voice; sound effects play over the top, so the
// music stays well under them.

/** A soft, slightly chorused pad voice. */
export const padSoft: Instrument = { wave: 'triangle', vol: 0.11, attack: 0.35, decay: 0.3, sustain: 0.8, release: 0.5, detune: 7 };
/** A buzzier pad voice, filtered down. */
export const padSaw: Instrument = { wave: 'sawtooth', vol: 0.05, attack: 0.5, decay: 0.4, sustain: 0.7, release: 0.6, cutoff: 1300, detune: 9 };
/** A menacing held chord for the boss: saw, filtered, slow vibrato. */
export const padDark: Instrument = { wave: 'sawtooth', vol: 0.06, attack: 0.15, decay: 0.3, sustain: 0.75, release: 0.2, cutoff: 1500, detune: 12, vibrato: { rate: 4, depth: 0.12 } };

/** Gentle plucked arpeggio. */
export const arpSoft: Instrument = { wave: 'pulse25', vol: 0.08, attack: 0.004, decay: 0.14, sustain: 0.2, release: 0.1, cutoff: 3200 };
/** Brighter, shorter arpeggio for the action tracks. */
export const arpBright: Instrument = { wave: 'pulse25', vol: 0.085, attack: 0.003, decay: 0.09, sustain: 0.3, release: 0.05, cutoff: 4200 };
/** Thin, slightly detuned arpeggio for the nebula. */
export const arpNebula: Instrument = { wave: 'pulse12', vol: 0.075, attack: 0.003, decay: 0.12, sustain: 0.25, release: 0.08, detune: 12, cutoff: 4000 };

/** Round, solid bass. */
export const bassTri: Instrument = { wave: 'triangle', vol: 0.24, attack: 0.005, decay: 0.08, sustain: 0.85, release: 0.08 };
/** Driving, filtered saw bass. */
export const bassSaw: Instrument = { wave: 'sawtooth', vol: 0.2, attack: 0.003, decay: 0.12, sustain: 0.55, release: 0.05, cutoff: 900 };
/** Hollow square bass for the syncopated lines. */
export const bassSquare: Instrument = { wave: 'square', vol: 0.19, attack: 0.003, decay: 0.1, sustain: 0.6, release: 0.04, cutoff: 750 };

/** The main lead: narrow pulse, a little vibrato and chorus. */
export const leadPulse: Instrument = { wave: 'pulse25', vol: 0.14, attack: 0.01, decay: 0.1, sustain: 0.65, release: 0.1, vibrato: { rate: 5.5, depth: 0.18 }, detune: 6 };
/** A sparse, moody lead for the title. */
export const leadMoody: Instrument = { wave: 'pulse25', vol: 0.12, attack: 0.012, decay: 0.2, sustain: 0.6, release: 0.3, vibrato: { rate: 5, depth: 0.15 }, cutoff: 3500 };
/** A brassy saw lead for the boss. */
export const leadSaw: Instrument = { wave: 'sawtooth', vol: 0.12, attack: 0.006, decay: 0.1, sustain: 0.6, release: 0.08, vibrato: { rate: 6, depth: 0.15 }, cutoff: 3600 };
/** The heavier octave-down double for boss phase 3. */
export const leadHeavy: Instrument = { wave: 'square', vol: 0.1, attack: 0.006, decay: 0.12, sustain: 0.55, release: 0.08, cutoff: 2400 };

/** Chord stabs. */
export const stab: Instrument = { wave: 'sawtooth', vol: 0.085, attack: 0.004, decay: 0.12, sustain: 0.3, release: 0.06, cutoff: 2200 };
/** A wailing held note. */
export const siren: Instrument = { wave: 'pulse12', vol: 0.07, attack: 0.08, decay: 0.2, sustain: 0.8, release: 0.2, vibrato: { rate: 6.5, depth: 0.45 } };
/** The anxious fast pulse of the danger layer. */
export const dangerPulse: Instrument = { wave: 'pulse12', vol: 0.06, attack: 0.002, decay: 0.05, sustain: 0.3, release: 0.03, cutoff: 5000 };

/** Bell-like chime for the stingers. */
export const chime: Instrument = { wave: 'triangle', vol: 0.18, attack: 0.002, decay: 0.28, sustain: 0.04, release: 0.25 };
/** Sparkle that echoes the chime. */
export const sparkle: Instrument = { wave: 'pulse12', vol: 0.06, attack: 0.002, decay: 0.12, sustain: 0.1, release: 0.12 };
/** A fanfare horn. */
export const fanfare: Instrument = { wave: 'square', vol: 0.15, attack: 0.008, decay: 0.1, sustain: 0.7, release: 0.2, cutoff: 4000 };
/** A mournful lead for the game-over phrase. */
export const mourn: Instrument = { wave: 'sawtooth', vol: 0.11, attack: 0.03, decay: 0.2, sustain: 0.65, release: 0.5, vibrato: { rate: 4.5, depth: 0.25 }, cutoff: 2200 };
