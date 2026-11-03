import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createBunkers } from '../game/bunkers';
import { ACID_HALF_WIDTH, ACID_RAIN_SECONDS, ACID_WARN_SECONDS } from '../game/hazards';
import { FIELD_HEIGHT } from '../game/playfield';
import { SHIP_Y } from '../game/player';
import type { AcidColumn } from '../game/types';
import { PALETTE } from './palette';
import { AcidView, DROPS_PER_COLUMN, MARKER_HEIGHT, curtainPixels, dropOffset, dropY, guidePixels, markerPixels, rainSpan, warnVisible } from './acidview';
import { Effects } from './effects';
import { Model } from './models';

const TOP = FIELD_HEIGHT / 2;

const hexAt = (d: Uint8Array, i: number): number => (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];

/** Every pixel of a texture is either clear or exactly one palette colour (so the palette pass leaves it alone). */
function onlyPalette(data: Uint8Array): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    expect(data[i + 3]).toBe(255);
    expect(PALETTE).toContain(hexAt(data, i));
  }
}

describe('acid rain pixels', () => {
  it('draws the warning band as a dashed outline with sparse dither inside, in palette colours', () => {
    const data = markerPixels(14, MARKER_HEIGHT, 0);
    onlyPalette(data);
    const solid = (x: number, y: number): boolean => data[(y * 14 + x) * 4 + 3] === 255;
    // The outline has gaps (dashes), the inside is mostly clear.
    let outline = 0;
    for (let x = 0; x < 14; x++) if (solid(x, 0)) outline++;
    expect(outline).toBeGreaterThan(2);
    expect(outline).toBeLessThan(14);
    let inside = 0;
    for (let y = 2; y < MARKER_HEIGHT - 1; y++) for (let x = 1; x < 13; x++) if (solid(x, y)) inside++;
    expect(inside).toBeGreaterThan(0);
    expect(inside).toBeLessThan(12 * MARKER_HEIGHT * 0.4);
  });

  it('makes the two marker phases differ, so swapping them makes the dashes crawl', () => {
    expect(markerPixels(14, MARKER_HEIGHT, 0)).not.toEqual(markerPixels(14, MARKER_HEIGHT, 2));
  });

  it('keeps the guide and the curtain to palette colours too, the curtain a light veil that shifts between phases', () => {
    onlyPalette(guidePixels(14));
    const a = curtainPixels(0);
    onlyPalette(a);
    expect(curtainPixels(1)).not.toEqual(a);
    let lit = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i] === 255) lit++;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(8);
  });
});

describe('acid rain timing', () => {
  it('flickers the warning, then holds it steady for the last moments', () => {
    let on = 0;
    let off = 0;
    for (let t = ACID_WARN_SECONDS; t > 0.2; t -= 0.01) (warnVisible(t) ? on++ : off++);
    expect(on).toBeGreaterThan(0);
    expect(off).toBeGreaterThan(0);
    expect(warnVisible(0.1)).toBe(true);
  });

  it('fills the column from the top and drains it away from the top', () => {
    const out = [0, 0];
    const floorY = SHIP_Y;
    rainSpan(0, ACID_RAIN_SECONDS, floorY, out);
    expect(out[0]).toBe(TOP);
    expect(out[1]).toBe(TOP);
    rainSpan(0.06, ACID_RAIN_SECONDS - 0.06, floorY, out);
    expect(out[1]).toBeLessThan(TOP);
    expect(out[1]).toBeGreaterThan(floorY);
    rainSpan(0.5, ACID_RAIN_SECONDS - 0.5, floorY, out);
    expect([out[0], out[1]]).toEqual([TOP, floorY]);
    rainSpan(ACID_RAIN_SECONDS - 0.1, 0.1, floorY, out);
    expect(out[0]).toBeLessThan(TOP);
    expect(out[1]).toBe(floorY);
    rainSpan(ACID_RAIN_SECONDS, 0, floorY, out);
    expect(out[0]).toBe(floorY);
  });

  it('keeps every drop inside its column and its loop, and spreads them', () => {
    const loop = TOP - SHIP_Y;
    const ys = new Set<number>();
    for (let i = 0; i < DROPS_PER_COLUMN; i++) {
      for (const t of [0, 0.4, 1.3, 5]) {
        const y = dropY(i, t, TOP, loop);
        expect(y).toBeLessThanOrEqual(TOP);
        expect(y).toBeGreaterThan(SHIP_Y);
      }
      const x = dropOffset(i, ACID_HALF_WIDTH);
      expect(Math.abs(x)).toBeLessThan(ACID_HALF_WIDTH);
      ys.add(Math.round(dropY(i, 1, TOP, loop) / 8));
    }
    // Not all in a clump.
    expect(ys.size).toBeGreaterThan(DROPS_PER_COLUMN / 2);
  });
});

function dropModel(): Model {
  const root = new Group();
  const part = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0xc6f23c }));
  part.name = 'drop';
  root.add(part);
  return new Model(root);
}

const column = (id: number, state: 'warn' | 'rain', timeLeft: number, x = 20): AcidColumn => ({ id, x, halfWidth: ACID_HALF_WIDTH, state, timeLeft });

/** Meshes actually drawn: visible themselves and under visible parents. */
function visibleMeshes(scene: Scene): number {
  let n = 0;
  scene.traverseVisible((o) => {
    if ((o as Mesh).isMesh) n++;
  });
  return n;
}

describe('AcidView', () => {
  const make = (): { scene: Scene; view: AcidView } => {
    const scene = new Scene();
    return { scene, view: new AcidView(scene, new Effects(new Scene()), dropModel, ACID_HALF_WIDTH) };
  };
  const bunkers = createBunkers(() => 1);

  it('draws nothing when there are no columns', () => {
    const { scene, view } = make();
    view.update([], bunkers, 0, 0.016);
    expect(view.drawn).toBe(0);
    expect(visibleMeshes(scene)).toBe(0);
  });

  it('marks a warning column with a band and a guide, and nothing falls yet', () => {
    const { scene, view } = make();
    view.update([column(1, 'warn', 0.9)], bunkers, 0, 0.016);
    expect(view.drawn).toBe(1);
    // The band (when it is on), the guide, and no drops.
    expect(visibleMeshes(scene)).toBeLessThanOrEqual(2);
    expect(visibleMeshes(scene)).toBeGreaterThanOrEqual(1);
  });

  it('draws the rain from the sim state each frame, even if it was never told about the warning', () => {
    const { scene, view } = make();
    view.update([column(7, 'rain', 0.8)], bunkers, 1, 0.016);
    expect(view.drawn).toBe(1);
    // Curtain, two edges, a batch of streaks and the falling drops.
    expect(visibleMeshes(scene)).toBeGreaterThan(DROPS_PER_COLUMN / 2);
  });

  it('frees a column once the sim drops it, and keeps two apart', () => {
    const { scene, view } = make();
    view.update([column(1, 'rain', 1), column(2, 'warn', 1, -30)], bunkers, 1, 0.016);
    expect(view.drawn).toBe(2);
    view.update([column(2, 'warn', 0.9, -30)], bunkers, 1.1, 0.016);
    expect(view.drawn).toBe(1);
    view.update([], bunkers, 1.2, 0.016);
    expect(view.drawn).toBe(0);
    expect(visibleMeshes(scene)).toBe(0);
  });

  it('stops the curtain on a bunker in its way, and clear() hides it all', () => {
    const { view } = make();
    const b = bunkers[1];
    view.update([column(1, 'rain', 0.8, b.x + b.width / 2)], bunkers, 1, 0.016);
    expect(view.drawn).toBe(1);
    view.clear();
    expect(view.drawn).toBe(0);
  });
});
