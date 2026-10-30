import { describe, expect, it } from 'vitest';
import { ACCENT_GAIN, DETUNE_LEVEL, DRUM_LEVEL, adsrLevel, drumLevel, envelope, notePeak, pulseCoefficients } from './voices';

const adsr = { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 };

describe('adsrLevel', () => {
  it('rises over the attack, falls over the decay, then holds the sustain', () => {
    expect(adsrLevel(adsr, 1, 0)).toBe(0);
    expect(adsrLevel(adsr, 1, 0.005)).toBeCloseTo(0.5);
    expect(adsrLevel(adsr, 1, 0.01)).toBeCloseTo(1);
    expect(adsrLevel(adsr, 1, 0.06)).toBeCloseTo(0.75);
    expect(adsrLevel(adsr, 1, 0.11)).toBeCloseTo(0.5);
    expect(adsrLevel(adsr, 1, 5)).toBeCloseTo(0.5);
  });

  it('scales with the peak', () => {
    expect(adsrLevel(adsr, 0.2, 5)).toBeCloseTo(0.1);
  });

  it('does not divide by zero with no attack or decay', () => {
    const level = adsrLevel({ attack: 0, decay: 0, sustain: 0.3, release: 0 }, 1, 0.5);
    expect(level).toBeCloseTo(0.3);
  });
});

describe('envelope', () => {
  it('goes silence, peak, sustain, then releases to silence after the note', () => {
    const points = envelope(adsr, 1, 1);
    expect(points.map((p) => [Number(p.t.toFixed(3)), Number(p.level.toFixed(3))])).toEqual([
      [0, 0],
      [0.01, 1],
      [0.11, 0.5],
      [1, 0.5],
      [1.2, 0],
    ]);
  });

  it('is cut short and released from where it was when the note ends mid-decay', () => {
    const points = envelope(adsr, 1, 0.06);
    expect(points[points.length - 2]).toEqual({ t: 0.06, level: expect.closeTo(0.75, 5) });
    expect(points[points.length - 1].t).toBeCloseTo(0.26);
    expect(points[points.length - 1].level).toBe(0);
  });

  it('is cut short in the attack of a very short note', () => {
    const points = envelope({ ...adsr, attack: 0.1 }, 1, 0.05);
    expect(points[1].t).toBeCloseTo(0.05);
    expect(points[1].level).toBeCloseTo(0.5);
  });

  it('has times that never go backwards', () => {
    for (const len of [0.001, 0.02, 0.5]) {
      const times = envelope(adsr, 1, len).map((p) => p.t);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });
});

describe('levels', () => {
  const inst = { vol: 0.2 };

  it('makes accents about 30% louder', () => {
    expect(notePeak(inst, true)).toBeCloseTo(notePeak(inst, false) * ACCENT_GAIN);
    expect(ACCENT_GAIN).toBeCloseTo(1.3);
  });

  it('shares the level out between detuned oscillators', () => {
    expect(notePeak({ vol: 0.2, detune: 7 }, false)).toBeCloseTo(0.2 * DETUNE_LEVEL);
  });

  it('gives each drum a level, louder when accented', () => {
    for (const drum of ['k', 's', 'h', 'o'] as const) {
      expect(drumLevel(drum, false)).toBe(DRUM_LEVEL[drum]);
      expect(drumLevel(drum, true)).toBeGreaterThan(drumLevel(drum, false));
    }
  });
});

describe('pulseCoefficients', () => {
  it('has no even harmonics for a square wave', () => {
    const { real } = pulseCoefficients(0.5, 16);
    for (let n = 2; n <= 16; n += 2) expect(Math.abs(real[n])).toBeLessThan(1e-6);
    expect(real[1]).toBeCloseTo(2 / Math.PI);
    expect(real[3]).toBeCloseTo(-2 / (3 * Math.PI));
  });

  it('drops every fourth harmonic of a 25% pulse', () => {
    const { real } = pulseCoefficients(0.25, 16);
    for (let n = 4; n <= 16; n += 4) expect(Math.abs(real[n])).toBeLessThan(1e-6);
    expect(Math.abs(real[1])).toBeGreaterThan(0.1);
  });

  it('drops every eighth harmonic of a 12.5% pulse', () => {
    const { real } = pulseCoefficients(0.125, 16);
    expect(Math.abs(real[8])).toBeLessThan(1e-6);
    expect(Math.abs(real[4])).toBeGreaterThan(0.01);
  });

  it('has no DC term and no sine terms', () => {
    const { real, imag } = pulseCoefficients(0.25);
    expect(real[0]).toBe(0);
    expect(imag.every((v) => v === 0)).toBe(true);
    expect(real.length).toBe(imag.length);
  });
});
