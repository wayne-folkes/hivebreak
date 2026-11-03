import { Color, Group, Mesh, MeshBasicMaterial, BoxGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { LOOK_FROZEN, LOOK_NORMAL, LOOK_SLOW, LOOK_WARP, Model, coolColor, frozenColor, shipModelName, warpColor } from './models';

const spread = (c: Color): number => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);

describe('looks', () => {
  it('cools a colour toward blue', () => {
    const warm = new Color(0xff8a45);
    const cool = coolColor(warm, new Color());
    expect(cool.b / (cool.r + 1e-6)).toBeGreaterThan(warm.b / warm.r);
    expect(cool.r).toBeLessThan(warm.r);
  });

  it('drains the colour out of a colour for Time Stop, leaving a bluish grey', () => {
    const vivid = new Color(0xff56da);
    const frozen = frozenColor(vivid, new Color());
    expect(spread(frozen)).toBeLessThan(spread(vivid) * 0.5);
    expect(frozen.b).toBeGreaterThanOrEqual(frozen.r);
  });

  it('washes a colour teal for a warp-in, lighter where the colour was lighter', () => {
    const dark = warpColor(new Color(0x1b1530), new Color());
    const light = warpColor(new Color(0xc1c3eb), new Color());
    for (const c of [dark, light]) expect(c.g).toBeGreaterThan(c.r);
    expect(light.g).toBeGreaterThan(dark.g);
  });
});

function partsModel(): Model {
  const root = new Group();
  for (const name of ['plate', 'core']) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: 0x884400 }));
    mesh.name = name;
    root.add(mesh);
  }
  return new Model(root);
}

const materialOf = (m: Model, part: string): unknown => (m.parts[part] as Mesh).material;

describe('Model part states', () => {
  it('flashes one named part and leaves the others', () => {
    const m = partsModel();
    const before = materialOf(m, 'plate');
    const coreBefore = materialOf(m, 'core');
    m.setPartFlash('plate', true);
    expect(materialOf(m, 'plate')).not.toBe(before);
    expect(materialOf(m, 'core')).toBe(coreBefore);
    m.setPartFlash('plate', false);
    expect(materialOf(m, 'plate')).toBe(before);
  });

  it('draws a destroyed part as a wreck, and a flash wins over the wreck', () => {
    const m = partsModel();
    const before = materialOf(m, 'plate');
    m.setPartWreck('plate', true);
    const wreck = materialOf(m, 'plate');
    expect(wreck).not.toBe(before);
    m.setPartFlash('plate', true);
    expect(materialOf(m, 'plate')).not.toBe(wreck);
    m.setPartFlash('plate', false);
    expect(materialOf(m, 'plate')).toBe(wreck);
    m.setPartWreck('plate', false);
    expect(materialOf(m, 'plate')).toBe(before);
  });

  it('draws a cut vein as a dried stump, different from a wreck, and restores it', () => {
    const m = partsModel();
    const before = materialOf(m, 'plate');
    m.setPartWreck('plate', true);
    const wreck = materialOf(m, 'plate');
    m.setPartWreck('plate', true, true);
    const stump = materialOf(m, 'plate');
    expect(stump).not.toBe(wreck);
    expect(stump).not.toBe(before);
    m.setPartWreck('plate', false);
    expect(materialOf(m, 'plate')).toBe(before);
  });

  it('flashes the whole model, and ignores a part that does not exist', () => {
    const m = partsModel();
    const before = materialOf(m, 'plate');
    const coreBefore = materialOf(m, 'core');
    m.setFlash(true);
    expect(materialOf(m, 'plate')).not.toBe(before);
    expect(materialOf(m, 'core')).not.toBe(coreBefore);
    m.setFlash(false);
    expect(materialOf(m, 'plate')).toBe(before);
    expect(materialOf(m, 'core')).toBe(coreBefore);
    expect(() => m.setPartFlash('nothing', true)).not.toThrow();
  });

  it('switching look and back restores the model (models with no look variants keep their colours)', () => {
    const m = partsModel();
    const before = materialOf(m, 'plate');
    m.setLook(LOOK_SLOW);
    m.setLook(LOOK_FROZEN);
    m.setLook(LOOK_WARP);
    m.setLook(LOOK_NORMAL);
    expect(materialOf(m, 'plate')).toBe(before);
  });
});

describe('ship models', () => {
  it('draws the Breaker with player.glb and every other ship with its own model', () => {
    expect(shipModelName('breaker')).toBe('player');
    expect(shipModelName('interceptor')).toBe('interceptor');
    expect(shipModelName('lancer')).toBe('lancer');
    expect(shipModelName('bastion')).toBe('bastion');
  });
});
