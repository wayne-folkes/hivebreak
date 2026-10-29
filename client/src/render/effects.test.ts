import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { Effects } from './effects';

function visibleCount(scene: Scene): number {
  let n = 0;
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && o.visible) n++;
  });
  return n;
}

describe('Effects', () => {
  it('shows pooled particles for a kill and hides them when they have faded', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    expect(visibleCount(scene)).toBe(0);
    fx.explode(10, 20, 'drone');
    expect(visibleCount(scene)).toBe(13);
    fx.update(0.2);
    expect(visibleCount(scene)).toBe(13);
    fx.update(1);
    expect(visibleCount(scene)).toBe(0);
  });

  it('never grows past its pool, however many bursts it is given', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const meshes = scene.children[0].children.length;
    for (let i = 0; i < 50; i++) fx.shipHit(0, 0);
    expect(scene.children[0].children.length).toBe(meshes);
    expect(visibleCount(scene)).toBeLessThanOrEqual(meshes);
  });

  it('shakes by whole pixels, for a short time, after the ship is hit', () => {
    const fx = new Effects(new Scene());
    const out = { x: 9, y: 9 };
    fx.shakeOffset(out);
    expect(out).toEqual({ x: 0, y: 0 });
    fx.shipHit(0, 0);
    let moved = false;
    for (let i = 0; i < 20; i++) {
      fx.shakeOffset(out);
      expect(Number.isInteger(out.x)).toBe(true);
      expect(Number.isInteger(out.y)).toBe(true);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(out.y)).toBeLessThanOrEqual(3);
      if (out.x !== 0 || out.y !== 0) moved = true;
    }
    expect(moved).toBe(true);
    fx.update(0.5);
    fx.shakeOffset(out);
    expect(out).toEqual({ x: 0, y: 0 });
  });

  it('runs rings and the wave flash out, and clear() hides everything', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.shieldRing(0, 0);
    fx.waveFlash();
    fx.update(0.05);
    expect(visibleCount(scene)).toBe(2);
    fx.update(1);
    expect(visibleCount(scene)).toBe(0);
    fx.explode(0, 0, 'warden');
    fx.clear();
    expect(visibleCount(scene)).toBe(0);
  });
});
