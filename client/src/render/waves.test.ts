import { Group } from 'three';
import type { Mesh, ShaderMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { WAVE_HALF_SIZE, WavePool, waveAlpha, waveRadius } from './waves';

const visible = (g: Group): number => g.children.filter((c) => (c as Mesh).visible).length;

describe('waveRadius', () => {
  it('runs from the start radius to the end, fast at first and easing off', () => {
    expect(waveRadius(10, 110, 0)).toBe(10);
    expect(waveRadius(10, 110, 1)).toBe(110);
    expect(waveRadius(10, 110, 0.5)).toBeGreaterThan(60);
    expect(waveRadius(10, 110, -1)).toBe(10);
    expect(waveRadius(10, 110, 2)).toBe(110);
  });
});

describe('waveAlpha', () => {
  it('stays solid for most of a wave and then drops to nothing', () => {
    expect(waveAlpha(0)).toBe(1);
    expect(waveAlpha(0.6)).toBe(1);
    expect(waveAlpha(0.8)).toBeCloseTo(0.5);
    expect(waveAlpha(1)).toBe(0);
  });
});

describe('WavePool', () => {
  it('shows a wave while it runs and hides it after, without growing the pool', () => {
    const group = new Group();
    const pool = new WavePool(group);
    const built = group.children.length;
    expect(visible(group)).toBe(0);
    pool.start(0, 0, 4, 100, 0.5, 3, 0xffffff);
    expect(visible(group)).toBe(1);
    pool.update(0.25);
    expect(visible(group)).toBe(1);
    pool.update(0.5);
    expect(visible(group)).toBe(0);
    for (let i = 0; i < 20; i++) pool.start(0, 0, 4, 100, 0.5, 3, 0xffffff);
    expect(group.children.length).toBe(built);
  });

  it('clear() hides everything, and a wave quad covers the biggest radius', () => {
    const group = new Group();
    const pool = new WavePool(group);
    pool.start(0, 0, 4, WAVE_HALF_SIZE, 1, 3, 0xffffff);
    pool.clear();
    expect(visible(group)).toBe(0);
    expect((group.children[0] as Mesh).scale.x).toBe(WAVE_HALF_SIZE * 2);
  });

  it('gives a wave a notch only when asked, and a recycled slot forgets the last one', () => {
    const group = new Group();
    const pool = new WavePool(group);
    const gap = (i: number): number => ((group.children[i] as Mesh).material as ShaderMaterial).uniforms.uGapHalf.value as number;
    pool.start(0, 0, 4, 50, 0.5, 2, 0xff56da, 1.5, 0.2);
    expect(gap(0)).toBe(0.2);
    pool.start(0, 0, 4, 50, 0.5, 2, 0xff56da);
    expect(gap(1)).toBe(0);
    for (let i = 0; i < 6; i++) pool.start(0, 0, 4, 50, 0.5, 2, 0xff56da);
    expect(gap(0)).toBe(0);
  });
});
