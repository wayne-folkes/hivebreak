import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';
import type { Effects } from './effects';

// The laser power-up's beam: a vertical bar of pixels from the ship's nose up to where it stops,
// with a flickering white core inside two layers of cyan, bright dashes streaming up it, a
// muzzle flare at the nose and a flare plus sparks where it lands. Beams are pooled: one set of
// meshes per ship that can fire one, shown and sized each frame, so nothing is allocated.

const MAX_BEAMS = 4;
const DASHES = 5;
/** Seconds between sparks thrown off where a beam lands. */
const SPARK_INTERVAL = 0.06;
const DASH_SPEED = 170;
const DASH_LENGTH = 6;

const AURA = 0x2a5b80;
const MID = 0x52ddeb;
const CORE = 0xffffff;
const DASH = 0xd3f1ff;

interface BeamMeshes {
  group: Group;
  aura: Mesh;
  mid: Mesh;
  core: Mesh;
  muzzle: Mesh;
  flareH: Mesh;
  flareV: Mesh;
  dashes: Mesh[];
}

/** Width of each layer at a given time: the core and middle flicker so the beam seems to crackle. Exposed for tests. */
export function beamWidths(time: number, out: { aura: number; mid: number; core: number }): void {
  const tick = Math.floor(time * 30);
  const hash = (Math.sin(tick * 12.9898) * 43758.5453) % 1;
  const flicker = hash < 0 ? hash + 1 : hash;
  out.aura = 7;
  out.mid = flicker > 0.55 ? 5 : 4;
  out.core = flicker > 0.8 ? 1 : flicker > 0.3 ? 2 : 3;
}

export class BeamView {
  private readonly pool: BeamMeshes[] = [];
  private readonly sparkTimer = new Float32Array(MAX_BEAMS);
  private readonly widths = { aura: 7, mid: 5, core: 2 };
  private shown = 0;

  constructor(
    scene: Scene,
    private readonly effects: Effects,
  ) {
    const unit = new BoxGeometry(1, 1, 1);
    const make = (color: number, z: number): Mesh => {
      const m = new Mesh(unit, new MeshBasicMaterial({ color }));
      m.position.z = z;
      return m;
    };
    for (let i = 0; i < MAX_BEAMS; i++) {
      const group = new Group();
      const beam: BeamMeshes = {
        group,
        aura: make(AURA, 0),
        mid: make(MID, 0.1),
        core: make(CORE, 0.2),
        muzzle: make(CORE, 0.3),
        flareH: make(CORE, 0.4),
        flareV: make(CORE, 0.4),
        dashes: Array.from({ length: DASHES }, () => make(DASH, 0.3)),
      };
      group.add(beam.aura, beam.mid, beam.core, beam.muzzle, beam.flareH, beam.flareV, ...beam.dashes);
      group.visible = false;
      this.pool.push(beam);
      scene.add(group);
    }
  }

  /** Call before drawing this frame's beams. */
  begin(): void {
    this.shown = 0;
  }

  /** Draws one beam from the nose at (x, y0) up to y1. `dt` is the frame time, for the impact sparks. */
  draw(x: number, y0: number, y1: number, time: number, dt: number): void {
    if (this.shown >= MAX_BEAMS) return;
    const i = this.shown++;
    const b = this.pool[i];
    const length = y1 - y0;
    if (length < 1) {
      b.group.visible = false;
      return;
    }
    b.group.visible = true;
    const w = this.widths;
    beamWidths(time + i * 0.37, w);
    const mid = y0 + length / 2;
    const place = (m: Mesh, width: number, h: number, cy: number): void => {
      m.position.x = x;
      m.position.y = cy;
      m.scale.set(width, h, 1);
    };
    place(b.aura, w.aura, length, mid);
    place(b.mid, w.mid, length, mid);
    place(b.core, w.core, length, mid);

    // Muzzle flare at the nose, and the flare where the beam lands.
    place(b.muzzle, w.mid, 3, y0 + 1);
    const pulse = 5 + (Math.floor(time * 24) % 2) * 2;
    place(b.flareH, pulse + 4, 2, y1);
    place(b.flareV, 2, pulse, y1);

    // Dashes stream up the beam.
    for (let d = 0; d < DASHES; d++) {
      const dash = b.dashes[d];
      const along = (time * DASH_SPEED + (d * length) / DASHES) % length;
      const top = Math.min(length, along + DASH_LENGTH);
      place(dash, 3, Math.max(0.5, top - along), y0 + (along + top) / 2);
    }

    this.sparkTimer[i] -= dt;
    if (this.sparkTimer[i] <= 0) {
      this.sparkTimer[i] = SPARK_INTERVAL;
      this.effects.sparks(x, y1);
    }
  }

  /** Call after the frame's beams: hides the ones not drawn. */
  end(): void {
    for (let i = this.shown; i < MAX_BEAMS; i++) {
      this.pool[i].group.visible = false;
      this.sparkTimer[i] = 0;
    }
  }

  clear(): void {
    this.shown = 0;
    this.end();
  }
}
