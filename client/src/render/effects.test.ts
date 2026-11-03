import { Color, Scene } from 'three';
import type { Mesh, MeshBasicMaterial } from 'three';
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

  it('runs the pulse bomb as a wave plus a shake, and clears it away', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const out = { x: 0, y: 0 };
    fx.pulse(0, -130);
    // The wave quad and a ring of sparks.
    expect(visibleCount(scene)).toBeGreaterThan(10);
    let moved = false;
    for (let i = 0; i < 20; i++) {
      fx.shakeOffset(out);
      if (out.x !== 0 || out.y !== 0) moved = true;
    }
    expect(moved).toBe(true);
    fx.update(1);
    expect(visibleCount(scene)).toBe(0);
  });

  it('gives a bomb-on-kill blast a ring and sparks that scale with its radius', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.blast(0, 0, 24);
    const small = visibleCount(scene);
    fx.clear();
    fx.blast(0, 0, 60);
    expect(visibleCount(scene)).toBeGreaterThanOrEqual(small);
    fx.update(1);
    expect(visibleCount(scene)).toBe(0);
  });

  it('plays a boss death as a string of bursts that ends in a big one, then settles', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const pool = scene.children[0].children.length;
    fx.bigExplosion(0, 100, 46);
    const first = visibleCount(scene);
    expect(first).toBeGreaterThan(0);
    // Bursts keep going off through the death, so there is fire at the halfway point too.
    for (let i = 0; i < 30; i++) fx.update(0.02);
    expect(visibleCount(scene)).toBeGreaterThan(0);
    // The last big burst comes at BOSS_DEATH_SECONDS, with its own flash and wave.
    for (let i = 0; i < 32; i++) fx.update(0.02);
    expect(visibleCount(scene)).toBeGreaterThan(30);
    for (let i = 0; i < 200; i++) fx.update(0.02);
    expect(visibleCount(scene)).toBe(0);
    expect(scene.children[0].children.length).toBe(pool);
  });

  it('does not let a small shake cut a big one short', () => {
    const fx = new Effects(new Scene());
    const out = { x: 0, y: 0 };
    fx.bigExplosion(0, 0, 10);
    fx.update(0.5);
    // 0.7 s of boss-death shake is left; a shield ring (0.1 s, 1 px) must not replace it.
    fx.shieldRing(0, 0);
    fx.update(0.2);
    let moved = false;
    for (let i = 0; i < 40; i++) {
      fx.shakeOffset(out);
      if (Math.abs(out.x) > 1 || Math.abs(out.y) > 1) moved = true;
    }
    expect(moved).toBe(true);
  });

  it('flashes the field in the colour it is given', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.waveFlash(0x9dfafd, 0.4, 0.5);
    fx.update(0.1);
    const flash = scene.children[0].children.find((c) => (c as Mesh).isMesh && (c as Mesh).visible) as Mesh;
    expect((flash.material as MeshBasicMaterial).color.getHex()).toBe(new Color(0x9dfafd).getHex());
    fx.update(1);
    expect(visibleCount(scene)).toBe(0);
  });

  it('has sparkles and rings for pickups in each power-up colour', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    for (const kind of ['spread', 'laser', 'slow', 'helper'] as const) {
      fx.pickupSparkle(0, 0, kind);
      fx.pickupCaught(0, 0, kind);
    }
    expect(visibleCount(scene)).toBeGreaterThan(0);
    fx.update(2);
    expect(visibleCount(scene)).toBe(0);
  });

  it('has crumbs, a split burst, shards flying out from a centre and a beam flare, all pooled and short-lived', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const pool = scene.children[0].children.length;
    fx.debris(0, 0);
    fx.splitBurst(0, 0);
    fx.shatter(20, 20, 0, 0);
    fx.beamFlare(0, 0);
    expect(visibleCount(scene)).toBeGreaterThan(20);
    expect(scene.children[0].children.length).toBe(pool);
    fx.update(2);
    expect(visibleCount(scene)).toBe(0);
  });

  it('flings shatter shards away from the centre they came from', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.shatter(30, 0, 0, 0);
    fx.update(0.1);
    const group = scene.children[0];
    const shards = group.children.filter((c) => (c as Mesh).visible && c.position.x !== 0);
    expect(shards.length).toBeGreaterThanOrEqual(10);
    for (const s of shards.slice(0, 10)) expect(s.position.x).toBeGreaterThan(30);
  });

  it('plays the red death too, ending in a big burst and settling', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    fx.bigExplosion(0, 64, 34, 34, true);
    for (let i = 0; i < 62; i++) fx.update(0.02);
    expect(visibleCount(scene)).toBeGreaterThan(30);
    for (let i = 0; i < 200; i++) fx.update(0.02);
    expect(visibleCount(scene)).toBe(0);
  });

  it('bursts a mine by how it went off: big for a shot, small dust on a bunker, a red blast at the ground', () => {
    const count = (cause: 'shot' | 'bunker' | 'ground', radius: number): number => {
      const scene = new Scene();
      const fx = new Effects(scene);
      fx.mineBurst(0, 0, radius, cause);
      return visibleCount(scene);
    };
    const shot = count('shot', 26);
    const dust = count('bunker', 8);
    const ground = count('ground', 16);
    expect(dust).toBeGreaterThan(0);
    expect(shot).toBeGreaterThan(dust);
    expect(ground).toBeGreaterThan(dust);
  });

  it('draws the sector 3 effects (warp trail, mend ring, acid splash, pincer pixels) from the pool', () => {
    const scene = new Scene();
    const fx = new Effects(scene);
    const meshes = scene.children[0].children.length;
    fx.warpTrail(0, 0, 60, 0);
    fx.warpArrived(60, 0);
    fx.mendRing(0, 0);
    fx.mended(10, 10);
    fx.acidSplash(0, -100);
    fx.trailPixel(0, 0, [0xc6f23c]);
    expect(visibleCount(scene)).toBeGreaterThan(10);
    for (let i = 0; i < 100; i++) fx.warpTrail(0, 0, 100, 0);
    expect(scene.children[0].children.length).toBe(meshes);
    fx.update(2);
    expect(visibleCount(scene)).toBe(0);
  });
});
