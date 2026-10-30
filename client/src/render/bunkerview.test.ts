import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createBunkers, hitBunker } from '../game/bunkers';
import { BUNKER_BODY, BUNKER_TOP, BUNKER_UNDER, BunkerView, bunkerPixels } from './bunkerview';

const hexAt = (d: Uint8Array, i: number): number => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
const visible = (scene: Scene): number => scene.children.filter((c) => (c as Mesh).visible).length;

describe('bunkerPixels', () => {
  it('draws solid pixels teal with a lighter top and darker underside, and gone pixels clear', () => {
    const [b] = createBunkers(() => 1);
    const out = new Uint8Array(b.width * b.height * 4);
    bunkerPixels(b, out);
    const at = (col: number, row: number) => (row * b.width + col) * 4;
    // Row 0 is the bottom: the arch's feet have open air below, so they are the dark underside.
    expect(hexAt(out, at(0, 0))).toBe(BUNKER_UNDER);
    // The opening in the middle of the bottom is gone.
    expect(out[at(10, 0) + 3]).toBe(0);
    // Inside a thick wall it is plain teal, and the top row has open air above.
    expect(hexAt(out, at(0, 4))).toBe(BUNKER_BODY);
    expect(hexAt(out, at(10, 9))).toBe(BUNKER_TOP);
    expect(out[at(10, 9) + 3]).toBe(255);
  });
});

describe('BunkerView', () => {
  it('uploads a bunker only when its version changes', () => {
    const scene = new Scene();
    const view = new BunkerView(scene);
    const bunkers = createBunkers(() => 1);
    view.update(bunkers);
    expect(view.uploads).toBe(bunkers.length);
    expect(visible(scene)).toBe(bunkers.length);
    view.update(bunkers);
    expect(view.uploads).toBe(bunkers.length);
    const hit = hitBunker(bunkers, { x: bunkers[0].x + 10, y: bunkers[0].y + 5, halfWidth: 1, halfHeight: 3 }, 'below');
    expect(hit).not.toBeNull();
    view.update(bunkers);
    expect(view.uploads).toBe(bunkers.length + 1);
  });

  it('places each quad over its mask, and hides the quads of bunkers that are gone', () => {
    const scene = new Scene();
    const view = new BunkerView(scene);
    const bunkers = createBunkers(() => 1);
    view.update(bunkers);
    const quad = scene.children[0] as Mesh;
    expect(quad.position.x).toBe(bunkers[0].x + bunkers[0].width / 2);
    expect(quad.position.y).toBe(bunkers[0].y + bunkers[0].height / 2);
    view.update([]);
    expect(visible(scene)).toBe(0);
    // A rebuilt set (new ids, version 0) is drawn afresh.
    view.update(createBunkers(() => 50));
    expect(visible(scene)).toBe(bunkers.length);
  });
});
