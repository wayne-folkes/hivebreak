import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { LINK_SECONDS, MendLinks, linkLit, linkThickness } from './mendlinks';

function visible(scene: Scene): number {
  let n = 0;
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && o.visible) n++;
  });
  return n;
}

describe('mend link timing', () => {
  it('holds full thickness, then thins to nothing', () => {
    expect(linkThickness(0)).toBe(1);
    expect(linkThickness(0.4)).toBe(1);
    expect(linkThickness(0.7)).toBeLessThan(1);
    expect(linkThickness(1)).toBe(0);
  });

  it('flickers while young and then holds steady', () => {
    const lit = [0, 1, 2, 3, 4, 5].filter((f) => linkLit(0.05, f)).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(6);
    for (let f = 0; f < 6; f++) expect(linkLit(0.3, f)).toBe(true);
  });
});

describe('MendLinks', () => {
  it('shows a link between a Mender and a healed alien, then hides it', () => {
    const scene = new Scene();
    const links = new MendLinks(scene);
    expect(visible(scene)).toBe(0);
    links.add(5, 0, 0, 6, 20, 0);
    expect(visible(scene)).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < 4; i++) links.update(0.1);
    links.update(0.1);
    expect(visible(scene)).toBe(0);
    expect(LINK_SECONDS).toBeCloseTo(0.4);
  });

  it('stretches a link between its two ends, and each end follows its own alien', () => {
    const scene = new Scene();
    const links = new MendLinks(scene);
    links.add(5, 0, 0, 6, 30, 0);
    links.update(0.2);
    const halo = scene.children[0].children[0] as Mesh;
    expect(halo.scale.x).toBeCloseTo(30);
    expect(halo.position.x).toBeCloseTo(15);
    // The formation marches: both move together, and the link moves with them.
    links.follow(5, 10, 0);
    links.follow(6, 40, 0);
    links.update(0.01);
    expect(halo.position.x).toBeCloseTo(25);
    expect(halo.scale.x).toBeCloseTo(30);
    // The weave sways the healed alien's row the other way: only its end moves.
    links.follow(6, 30, 0);
    links.update(0.01);
    expect(halo.position.x).toBeCloseTo(20);
    expect(halo.scale.x).toBeCloseTo(20);
  });

  it('never grows past its pool, and clear() hides every link', () => {
    const scene = new Scene();
    const links = new MendLinks(scene);
    const meshes = scene.children[0].children.length;
    for (let i = 0; i < 50; i++) links.add(1, 0, 0, 2, i, 5);
    expect(scene.children[0].children.length).toBe(meshes);
    links.clear();
    expect(visible(scene)).toBe(0);
  });
});
