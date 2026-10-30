import { Scene } from 'three';
import type { Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import { BossBeamView, rayToFieldEdge, warnBlinkHz } from './bossbeams';
import { Effects } from './effects';

const isBeam = (c: { type: string; children: unknown[] }): boolean => c.type === 'Group' && c.children.length === 6;
const beams = (scene: Scene) => scene.children.filter(isBeam);
const lit = (scene: Scene): number => beams(scene).filter((c) => c.visible).length;

describe('rayToFieldEdge', () => {
  it('runs straight down to the bottom of the field, plus a margin', () => {
    expect(rayToFieldEdge(0, 64, -Math.PI / 2, 0)).toBeCloseTo(64 + FIELD_HEIGHT / 2);
  });

  it('stops at the side wall for a flat ray, and at whichever edge comes first on a slant', () => {
    expect(rayToFieldEdge(0, 0, 0, 0)).toBeCloseTo(FIELD_WIDTH / 2);
    expect(rayToFieldEdge(0, 0, Math.PI, 0)).toBeCloseTo(FIELD_WIDTH / 2);
    const slanted = rayToFieldEdge(0, 100, -Math.PI / 4, 0);
    expect(slanted).toBeCloseTo(FIELD_WIDTH / 2 / Math.cos(Math.PI / 4));
  });
});

describe('warnBlinkHz', () => {
  it('blinks faster as the beam nears firing', () => {
    expect(warnBlinkHz(1.2)).toBeLessThan(warnBlinkHz(0.6));
    expect(warnBlinkHz(0.6)).toBeLessThan(warnBlinkHz(0.05));
    expect(warnBlinkHz(5)).toBe(warnBlinkHz(1.2));
  });
});

describe('BossBeamView', () => {
  it('shows a beam per call, in warning or firing form, and hides the rest', () => {
    const scene = new Scene();
    const view = new BossBeamView(scene, new Effects(scene));
    view.begin();
    view.warn(0, 64, -1.4, 0.5, 0.016);
    view.fire(0, 64, -1.7, 150, true, 0, 0.016);
    view.end();
    expect(lit(scene)).toBe(2);
    const [w, f] = beams(scene);
    expect((w.children[0] as Mesh).visible).toBe(true);
    expect((w.children[1] as Mesh).visible).toBe(false);
    expect((f.children[0] as Mesh).visible).toBe(false);
    expect((f.children[1] as Mesh).visible).toBe(true);
    view.begin();
    view.end();
    expect(lit(scene)).toBe(0);
  });

  it('stretches a firing beam from the core to where it stops', () => {
    const scene = new Scene();
    const view = new BossBeamView(scene, new Effects(scene));
    view.begin();
    view.fire(10, 60, -Math.PI / 2, 100, true, 0, 0.016);
    view.end();
    const aura = beams(scene)[0].children[1] as Mesh;
    expect(aura.scale.x).toBe(100);
    expect(aura.position.x).toBeCloseTo(10);
    expect(aura.position.y).toBeCloseTo(10);
  });
});
