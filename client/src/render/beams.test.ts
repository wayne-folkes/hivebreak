import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { BeamView, beamWidths } from './beams';
import { Effects } from './effects';

/** A beam is a small group (aura, middle, core, muzzle, two flare bars, five dashes); the effects group is far bigger. */
const isBeam = (c: { type: string; children: unknown[] }): boolean => c.type === 'Group' && c.children.length === 11;

function visibleGroups(scene: Scene): number {
  return scene.children.filter((c) => isBeam(c) && c.visible).length;
}

describe('beamWidths', () => {
  it('keeps every layer a few pixels wide, core inside the middle inside the aura', () => {
    const out = { aura: 0, mid: 0, core: 0 };
    for (let t = 0; t < 5; t += 0.013) {
      beamWidths(t, out);
      expect(out.core).toBeGreaterThanOrEqual(1);
      expect(out.core).toBeLessThan(out.mid);
      expect(out.mid).toBeLessThan(out.aura);
    }
  });

  it('flickers: the core is not one width forever', () => {
    const out = { aura: 0, mid: 0, core: 0 };
    const seen = new Set<number>();
    for (let t = 0; t < 3; t += 0.033) {
      beamWidths(t, out);
      seen.add(out.core);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('BeamView', () => {
  it('shows a beam per call, hides the rest, and skips a beam with no length', () => {
    const scene = new Scene();
    const view = new BeamView(scene, new Effects(scene));
    view.begin();
    view.draw(0, -100, 50, 0, 0.016);
    view.end();
    expect(visibleGroups(scene)).toBe(1);
    view.begin();
    view.draw(0, -100, -100, 0, 0.016);
    view.end();
    expect(visibleGroups(scene)).toBe(0);
    view.begin();
    view.end();
    expect(visibleGroups(scene)).toBe(0);
  });

  it('stretches the beam from the nose to where it stops', () => {
    const scene = new Scene();
    const view = new BeamView(scene, new Effects(scene));
    view.begin();
    view.draw(10, -100, 100, 0, 0.016);
    view.end();
    const group = scene.children.find((c) => isBeam(c))!;
    const aura = group.children[0] as Mesh;
    expect(aura.scale.y).toBe(200);
    expect(aura.position.y).toBe(0);
    expect(aura.position.x).toBe(10);
  });

  it('throws impact sparks while it lands, at a steady rate', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const view = new BeamView(scene, fx);
    const count = (): number => {
      let n = 0;
      scene.traverse((o) => {
        if ((o as Mesh).isMesh && o.visible && o.parent === scene.children[0]) n++;
      });
      return n;
    };
    expect(count()).toBe(0);
    view.begin();
    view.draw(0, -100, 50, 0, 0.016);
    view.end();
    expect(count()).toBeGreaterThan(0);
  });
});
