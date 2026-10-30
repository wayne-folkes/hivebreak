import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';
import type { GravityWell } from '../game/types';
import { WELL_SPARK } from './effects';
import type { Effects } from './effects';
import type { Model } from './models';

// The Gravity Well Special: the well model hanging mid-field, its two rings spinning against each
// other, its core throbbing, and a swirl of motes spiralling into it. It grows in over a
// quarter second and collapses to a point (with a small flash) as it ends. The sim only says
// where the well is and how long it has left; the grow-in clock is the view's own.

/** Seconds the well takes to grow in, and to collapse at the end of its time. */
export const WELL_GROW_SECONDS = 0.25;
export const WELL_COLLAPSE_SECONDS = 0.3;
/** When the well is cut short (a wave starts, the run ends) it collapses from where it is over this long. */
export const WELL_GHOST_SECONDS = 0.2;
/** How far out the swirl starts, art pixels (the sim's pull reaches 60). */
export const SWIRL_RADIUS = 56;
const SWIRL_COUNT = 28;
/** Seconds a mote takes from the rim to the core. */
const SWIRL_PERIOD = 1.1;
const RING_RATE = 7;
const RING2_RATE = 9.5;
/** The well is drawn this much bigger than its model, so it reads at 180 x 320. */
const DRAW_SCALE = 1.2;

/** Grows past 1 and settles back: the well pops in. `u` is 0 to 1. */
export function easeOutBack(u: number): number {
  const k = 1.9;
  const x = Math.min(1, Math.max(0, u)) - 1;
  return 1 + (k + 1) * x * x * x + k * x * x;
}

/** The well's scale: grows in over WELL_GROW_SECONDS from its start (`age`), and shrinks to nothing over its last WELL_COLLAPSE_SECONDS. */
export function wellScale(age: number, timeLeft: number): number {
  const grow = easeOutBack(age / WELL_GROW_SECONDS);
  const left = Math.min(1, Math.max(0, timeLeft / WELL_COLLAPSE_SECONDS));
  return grow * left * left;
}

/** Scale of a well that was cut short at scale `from`, `left` seconds before its collapse ends. */
export function ghostScale(from: number, left: number): number {
  const u = Math.min(1, Math.max(0, left / WELL_GHOST_SECONDS));
  return from * u * u;
}

const fract = (v: number): number => v - Math.floor(v);

/**
 * A swirl mote's place relative to the well's centre at time `t`: it starts at SWIRL_RADIUS and
 * falls in along a tightening spiral, speeding up as it goes, and starts over. Motes are
 * staggered by index. Writes x, y and a size (0 to 1, fading in at the rim and out at the core).
 */
export function swirlPoint(i: number, t: number, out: { x: number; y: number; s: number }): void {
  const u = fract(t / SWIRL_PERIOD + i * 0.6180339887);
  const radius = SWIRL_RADIUS * (1 - u * u);
  // Four spiral arms, each wound the same way, turning slowly as a whole.
  const angle = (i % 4) * (Math.PI / 2) + (i >> 2) * 0.11 + t * 1.4 + u * 5.5;
  out.x = Math.cos(angle) * radius;
  out.y = Math.sin(angle) * radius;
  out.s = Math.min(1, u * 8) * (0.3 + 0.7 * (1 - u));
}

const MOTE_COLORS = [0xac55f7, 0xff56da, 0xffffff, 0x9b7bff];

export class WellView {
  private readonly motes: Mesh[] = [];
  private readonly group = new Group();
  private readonly point = { x: 0, y: 0, s: 0 };
  private active = false;
  private age = 0;
  private lastLeft = 0;
  private x = 0;
  private y = 0;
  private scale = 0;
  private ghost = 0;
  private ghostFrom = 0;
  private flashPending = false;
  private spin = 0;
  private spin2 = 0;

  constructor(
    scene: Scene,
    private readonly model: Model,
    private readonly effects: Effects,
  ) {
    model.holder.visible = false;
    scene.add(model.holder);
    const cube = new BoxGeometry(1, 1, 1);
    const materials = MOTE_COLORS.map((color) => new MeshBasicMaterial({ color }));
    for (let i = 0; i < SWIRL_COUNT; i++) {
      const mote = new Mesh(cube, materials[i % materials.length]);
      mote.rotation.z = Math.PI / 4;
      this.motes.push(mote);
      this.group.add(mote);
    }
    this.group.visible = false;
    this.group.position.z = 0.4;
    scene.add(this.group);
  }

  /** Advances the well by `dt` seconds; `well` is the run's current well or null; `time` is the view's clock. */
  update(well: GravityWell | null, dt: number, time: number): void {
    if (well) {
      // A new well, or a fired-again one (the sim resets its time and moves it): grow in afresh.
      if (!this.active || well.timeLeft > this.lastLeft + 1e-3) this.age = 0;
      this.active = true;
      this.ghost = 0;
      this.flashPending = false;
      this.age += dt;
      this.lastLeft = well.timeLeft;
      this.x = well.x;
      this.y = well.y;
      this.scale = wellScale(this.age, well.timeLeft);
    } else if (this.active) {
      this.active = false;
      if (this.lastLeft > WELL_COLLAPSE_SECONDS * 1.2 && this.scale > 0.05) {
        // Cut short: collapse from where it stands, flashing when it is gone.
        this.ghost = WELL_GHOST_SECONDS;
        this.ghostFrom = this.scale;
        this.flashPending = true;
      } else {
        this.finish();
      }
    }
    if (!this.active && this.ghost > 0) {
      this.ghost = Math.max(0, this.ghost - dt);
      this.scale = ghostScale(this.ghostFrom, this.ghost);
      if (this.ghost === 0 && this.flashPending) this.finish();
    } else if (!this.active) {
      this.scale = 0;
    }

    const show = this.scale > 0.01;
    this.model.holder.visible = show;
    this.group.visible = show;
    if (!show) return;

    // The rings speed up as the well collapses.
    const hurry = 1 + 2 * (1 - Math.min(1, Math.max(0, this.active ? this.lastLeft / WELL_COLLAPSE_SECONDS : 0)));
    this.spin += dt * RING_RATE * hurry;
    this.spin2 += dt * RING2_RATE * hurry;
    const { parts, holder } = this.model;
    holder.position.set(this.x, this.y, 0.5);
    holder.scale.setScalar(this.scale * DRAW_SCALE);
    if (parts.ring) parts.ring.rotation.z = this.spin;
    if (parts.ring2) parts.ring2.rotation.z = -this.spin2;
    if (parts.core) parts.core.scale.setScalar(1 + 0.2 * Math.sin(time * 14));
    if (parts.shell) parts.shell.scale.setScalar(1 + 0.04 * Math.sin(time * 9 + 1));

    this.group.position.x = this.x;
    this.group.position.y = this.y;
    const reach = Math.min(1, this.scale);
    for (let i = 0; i < this.motes.length; i++) {
      swirlPoint(i, time, this.point);
      const mote = this.motes[i];
      mote.position.x = this.point.x * reach;
      mote.position.y = this.point.y * reach;
      mote.scale.setScalar(Math.max(0.01, 2.6 * this.point.s * reach));
    }
  }

  /** The small flash as the well ends. */
  private finish(): void {
    this.flashPending = false;
    this.effects.wave(this.x, this.y, 3, 24, 0.25, 2, 0xac55f7);
    this.effects.sparksIn(this.x, this.y, WELL_SPARK, 9, 80);
  }

  /** Hides the well at once, e.g. when a new run starts. */
  clear(): void {
    this.active = false;
    this.ghost = 0;
    this.scale = 0;
    this.flashPending = false;
    this.model.holder.visible = false;
    this.group.visible = false;
  }
}
