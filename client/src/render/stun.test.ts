import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { StunMarkers } from './stun';

const shown = (scene: Scene): number => scene.children.filter((c) => (c as Mesh).visible).length;

describe('StunMarkers', () => {
  it('shows the stars asked for and hides the rest', () => {
    const scene = new Scene();
    const stun = new StunMarkers(scene);
    expect(shown(scene)).toBe(0);
    stun.begin();
    stun.add(0, 0, 5, 2, 0, 0);
    stun.add(20, 0, 5, 2, 0, 1);
    stun.end();
    expect(shown(scene)).toBe(4);
    stun.begin();
    stun.add(0, 0, 5, 1, 0, 0);
    stun.end();
    expect(shown(scene)).toBe(1);
    stun.begin();
    stun.end();
    expect(shown(scene)).toBe(0);
  });

  it('never grows past its pool', () => {
    const scene = new Scene();
    const stun = new StunMarkers(scene);
    const pool = scene.children.length;
    stun.begin();
    for (let i = 0; i < 200; i++) stun.add(0, 0, 5, 2, 0, i);
    stun.end();
    expect(scene.children.length).toBe(pool);
    expect(shown(scene)).toBe(pool);
    stun.clear();
    expect(shown(scene)).toBe(0);
  });

  it('wobbles the stars around the point they circle', () => {
    const scene = new Scene();
    const stun = new StunMarkers(scene);
    stun.begin();
    stun.add(50, 80, 6, 1, 0.3, 0);
    stun.end();
    const star = scene.children[0];
    expect(Math.abs(star.position.x - 50)).toBeLessThanOrEqual(6.001);
    expect(Math.abs(star.position.y - 80)).toBeLessThanOrEqual(2.2);
  });
});
