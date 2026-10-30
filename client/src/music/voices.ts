import type { Drum, Instrument } from './song';

// The music's voices: pitched notes with an ADSR envelope, and noise-and-sine drums. Like the sound
// effects (game/audio.ts) the maths is pure and tested, and the Web Audio code is kept thin: each
// note builds a few nodes, schedules them, and lets them be collected once they have stopped.

/** Accented notes (`!`) are this much louder. */
export const ACCENT_GAIN = 1.3;
/** Each oscillator's share of the level when a second, detuned one is added. */
export const DETUNE_LEVEL = 0.7;
/** Seconds after a note starts before its vibrato begins, and how long it takes to reach full depth. */
export const VIBRATO_DELAY = 0.15;
export const VIBRATO_RAMP = 0.15;
/** Shortest attack, decay and release (seconds), so envelopes never click or divide by zero. */
const MIN_ATTACK = 0.003;
const MIN_DECAY = 0.005;
const MIN_RELEASE = 0.01;
/** Shortest slide (seconds). */
const MIN_SLIDE = 0.02;
/** Harmonics in a pulse wave's Fourier series. */
const PULSE_HARMONICS = 48;
/** Seconds of noise in the shared buffer. */
const NOISE_SECONDS = 2;

// --- Envelope ----------------------------------------------------------------------------------

type Adsr = Pick<Instrument, 'attack' | 'decay' | 'sustain' | 'release'>;

/** The envelope's level `t` seconds after the note starts, before it ends: attack, decay, then sustain. */
export function adsrLevel(inst: Adsr, peak: number, t: number): number {
  if (t <= 0) return 0;
  const attack = Math.max(inst.attack, MIN_ATTACK);
  if (t <= attack) return (peak * t) / attack;
  const decay = Math.max(inst.decay, MIN_DECAY);
  const sustain = peak * Math.min(1, Math.max(0, inst.sustain));
  if (t >= attack + decay) return sustain;
  return peak + ((sustain - peak) * (t - attack)) / decay;
}

export interface EnvelopePoint {
  /** Seconds after the note starts. */
  t: number;
  level: number;
}

/**
 * The corners of a note's gain curve, to be joined with straight ramps: silence, the peak, the
 * sustain level, then the release down to silence after the note's `len` seconds. A note shorter
 * than its attack or decay is cut short where it is and released from there.
 */
export function envelope(inst: Adsr, peak: number, len: number): EnvelopePoint[] {
  const end = Math.max(len, 0.01);
  const attack = Math.max(inst.attack, MIN_ATTACK);
  const points: EnvelopePoint[] = [{ t: 0, level: 0 }];
  for (const t of [attack, attack + Math.max(inst.decay, MIN_DECAY)]) {
    if (t < end) points.push({ t, level: adsrLevel(inst, peak, t) });
  }
  points.push({ t: end, level: adsrLevel(inst, peak, end) });
  points.push({ t: end + Math.max(inst.release, MIN_RELEASE), level: 0 });
  return points;
}

/** A note's peak level: the instrument's, louder when accented, shared out between detuned oscillators. */
export function notePeak(inst: Pick<Instrument, 'vol' | 'detune'>, accent: boolean): number {
  return inst.vol * (accent ? ACCENT_GAIN : 1) * (inst.detune ? DETUNE_LEVEL : 1);
}

// --- Pulse waves -------------------------------------------------------------------------------

/**
 * Fourier coefficients (cosine terms) of a pulse wave with the given duty (0.5 is a square,
 * 0.25 and 0.125 are the thin chiptune pulses): harmonic n has amplitude 2 sin(n pi duty) / (n pi).
 * `real[0]`, the DC term, is left at zero.
 */
export function pulseCoefficients(duty: number, harmonics = PULSE_HARMONICS): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) real[n] = (2 * Math.sin(n * Math.PI * duty)) / (n * Math.PI);
  return { real, imag };
}

const PULSE_DUTY = { pulse25: 0.25, pulse12: 0.125 } as const;

// --- Drums -------------------------------------------------------------------------------------

/** Each drum's base level. Accents are louder. */
export const DRUM_LEVEL: Record<Drum, number> = { k: 0.5, s: 0.3, h: 0.12, o: 0.12 };

/** A drum hit's level. */
export function drumLevel(drum: Drum, accent: boolean): number {
  return DRUM_LEVEL[drum] * (accent ? ACCENT_GAIN : 1);
}

// --- Web Audio ---------------------------------------------------------------------------------

/** What the voices need from a context: one noise buffer and the pulse waves, built once. */
export interface VoiceEnv {
  ctx: AudioContext;
  noise: AudioBuffer;
  pulse: { pulse25: PeriodicWave; pulse12: PeriodicWave };
}

export function createVoiceEnv(ctx: AudioContext): VoiceEnv {
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const wave = (duty: number) => {
    const { real, imag } = pulseCoefficients(duty);
    return ctx.createPeriodicWave(real, imag);
  };
  return { ctx, noise, pulse: { pulse25: wave(PULSE_DUTY.pulse25), pulse12: wave(PULSE_DUTY.pulse12) } };
}

/** A gain (the channel's level) feeding a stereo panner (when it has a position) into `dest`. Notes connect to the gain. */
export function createChannelInput(ctx: AudioContext, dest: AudioNode, vol = 1, pan = 0): GainNode {
  const input = ctx.createGain();
  input.gain.value = vol;
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.min(1, Math.max(-1, pan));
    input.connect(panner);
    panner.connect(dest);
  } else {
    input.connect(dest);
  }
  return input;
}

/**
 * Plays one pitched note: `hz` for `len` seconds from `time`, then its release. Builds the nodes
 * (oscillator or two, optional low-pass, gain envelope, optional vibrato), starts and stops
 * them, and leaves them to be collected.
 */
export function playNote(env: VoiceEnv, dest: AudioNode, inst: Instrument, hz: number, time: number, len: number, accent: boolean): void {
  if (!(hz > 0) || !Number.isFinite(hz)) return;
  const { ctx } = env;
  const stopAt = time + Math.max(len, 0.01) + Math.max(inst.release, MIN_RELEASE) + 0.02;

  const amp = ctx.createGain();
  amp.gain.value = 0;
  for (const [i, point] of envelope(inst, notePeak(inst, accent), len).entries()) {
    if (i === 0) amp.gain.setValueAtTime(0, time);
    else amp.gain.linearRampToValueAtTime(point.level, time + point.t);
  }
  amp.connect(dest);

  let input: AudioNode = amp;
  if (inst.cutoff) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = inst.cutoff;
    filter.connect(amp);
    input = filter;
  }

  const oscillator = (cents: number) => {
    const osc = ctx.createOscillator();
    if (inst.wave === 'pulse25' || inst.wave === 'pulse12') osc.setPeriodicWave(env.pulse[inst.wave]);
    else osc.type = inst.wave;
    if (inst.slide) {
      osc.frequency.setValueAtTime(hz * 2 ** (-inst.slide / 12), time);
      osc.frequency.exponentialRampToValueAtTime(hz, time + Math.max(inst.attack, MIN_SLIDE));
    } else {
      osc.frequency.setValueAtTime(hz, time);
    }
    if (cents) osc.detune.value = cents;
    osc.connect(input);
    osc.start(time);
    osc.stop(stopAt);
    return osc;
  };
  const oscillators = [oscillator(0)];
  if (inst.detune) oscillators.push(oscillator(inst.detune));

  if (inst.vibrato) {
    // A slow sine on the oscillators' detune (in cents), fading in after a moment.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = inst.vibrato.rate;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, time);
    depth.gain.setValueAtTime(0, time + VIBRATO_DELAY);
    depth.gain.linearRampToValueAtTime(inst.vibrato.depth * 100, time + VIBRATO_DELAY + VIBRATO_RAMP);
    lfo.connect(depth);
    for (const osc of oscillators) depth.connect(osc.detune);
    lfo.start(time);
    lfo.stop(stopAt);
  }
}

/** A burst of the shared noise from `time`, for `dur` seconds, through `filter` into `dest`. */
function noiseBurst(env: VoiceEnv, dest: AudioNode, filter: BiquadFilterType, freq: number, q: number, time: number, dur: number): void {
  const { ctx } = env;
  const src = ctx.createBufferSource();
  src.buffer = env.noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f);
  f.connect(dest);
  src.start(time, Math.random() * (env.noise.duration - 0.5));
  src.stop(time + dur);
}

/** Drops a gain from `level` to nearly silent over `dur` seconds from `time`, into `dest`. */
function decayGain(ctx: AudioContext, dest: AudioNode, level: number, time: number, dur: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(level, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + dur);
  g.connect(dest);
  return g;
}

/** A sine or triangle that falls from `from` to `to` Hz over `fall` seconds, for `dur`. */
function fallingTone(env: VoiceEnv, dest: AudioNode, wave: OscillatorType, from: number, to: number, fall: number, time: number, dur: number): void {
  const osc = env.ctx.createOscillator();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, time);
  osc.frequency.exponentialRampToValueAtTime(to, time + fall);
  osc.connect(dest);
  osc.start(time);
  osc.stop(time + dur);
}

/**
 * Plays one drum hit at `time`. `scale` is the time scale, which lowers the drums' pitch like the
 * notes. Kick: a sine falling from about 150 to 45 Hz. Snare: band-passed noise (1.8 kHz) and a
 * short 180 Hz tone. Hats: high-passed noise (7 kHz), short when closed and longer when open.
 */
export function playDrum(env: VoiceEnv, dest: AudioNode, drum: Drum, accent: boolean, time: number, scale = 1): void {
  const { ctx } = env;
  const level = drumLevel(drum, accent);
  switch (drum) {
    case 'k':
      fallingTone(env, decayGain(ctx, dest, level, time, 0.28), 'sine', 150 * scale, 45 * scale, 0.14, time, 0.3);
      break;
    case 's':
      noiseBurst(env, decayGain(ctx, dest, level, time, 0.2), 'bandpass', 1800, 0.8, time, 0.22);
      fallingTone(env, decayGain(ctx, dest, level * 0.5, time, 0.1), 'triangle', 180 * scale, 140 * scale, 0.1, time, 0.12);
      break;
    case 'h':
      noiseBurst(env, decayGain(ctx, dest, level, time, 0.04), 'highpass', 7000, 0.7, time, 0.05);
      break;
    case 'o':
      noiseBurst(env, decayGain(ctx, dest, level, time, 0.25), 'highpass', 7000, 0.7, time, 0.27);
      break;
  }
}
