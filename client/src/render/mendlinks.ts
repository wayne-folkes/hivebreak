import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';

// The Mender's heal: when it pulses, a short green link is drawn from it to each alien it healed:
// a wide dark-green line with a bright core, flickering for a moment and thinning away. Pooled:
// each link is two stretched cubes built once; starting one only places them.
//
// A link is anchored at both ends, to its Mender and to the alien it healed, and each end follows
// its alien as the formation marches and weaves, so the line stays on them while it lasts.

/** Seconds a link lasts. */
export const LINK_SECONDS = 0.4;
const MAX_LINKS = 20;
const HALO_COLOR = 0x1f9e63;
const CORE_COLOR = 0x4fff9b;
const SPARK_COLOR = 0xffffff;
const HALO_THICK = 3;
const CORE_THICK = 1;

/** How thick a link still is, 1 to 0, `u` (0 to 1) of the way through its life: full, then thinning out. */
export function linkThickness(u: number): number {
  return u < 0.45 ? 1 : Math.max(0, 1 - (u - 0.45) / 0.55);
}

/** Is a link drawn this frame? It flickers while it is young and then holds. */
export function linkLit(age: number, frame: number): boolean {
  return age > 0.15 || frame % 3 !== 0;
}

interface Link {
  halo: Mesh;
  core: Mesh;
  spark: Mesh;
  age: number;
  /** The Mender (alien id) the link hangs from, and the alien it healed. */
  anchor: number;
  target: number;
  /** Where each end was drawn as of the last `follow` (or the pulse). */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export class MendLinks {
  private readonly group = new Group();
  private readonly links: Link[] = [];
  private cursor = 0;
  private frame = 0;

  constructor(scene: Scene) {
    const cube = new BoxGeometry(1, 1, 1);
    const halo = new MeshBasicMaterial({ color: HALO_COLOR });
    const core = new MeshBasicMaterial({ color: CORE_COLOR });
    const spark = new MeshBasicMaterial({ color: SPARK_COLOR });
    for (let i = 0; i < MAX_LINKS; i++) {
      const link: Link = {
        halo: new Mesh(cube, halo),
        core: new Mesh(cube, core),
        spark: new Mesh(cube, spark),
        age: LINK_SECONDS,
        anchor: -1,
        target: -1,
        fromX: 0,
        fromY: 0,
        toX: 0,
        toY: 0,
      };
      link.halo.position.z = 3.2;
      link.core.position.z = 3.4;
      link.spark.position.z = 3.6;
      link.halo.visible = link.core.visible = link.spark.visible = false;
      this.group.add(link.halo, link.core, link.spark);
      this.links.push(link);
    }
    scene.add(this.group);
  }

  /** Starts a link from the Mender `anchor`, at (fromX, fromY), to the alien `target` it healed, at (toX, toY). */
  add(anchor: number, fromX: number, fromY: number, target: number, toX: number, toY: number): void {
    const link = this.links[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_LINKS;
    link.age = 0;
    link.anchor = anchor;
    link.target = target;
    link.fromX = fromX;
    link.fromY = fromY;
    link.toX = toX;
    link.toY = toY;
    link.halo.visible = link.core.visible = link.spark.visible = true;
    this.place(link, 1, true);
  }

  /** Tells the links at either end of alien `id` where it is drawn now. */
  follow(id: number, x: number, y: number): void {
    for (const link of this.links) {
      if (link.age >= LINK_SECONDS) continue;
      if (link.anchor === id) {
        link.fromX = x;
        link.fromY = y;
      }
      if (link.target === id) {
        link.toX = x;
        link.toY = y;
      }
    }
  }

  private place(link: Link, thickness: number, lit: boolean): void {
    const dx = link.toX - link.fromX;
    const dy = link.toY - link.fromY;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const mx = link.fromX + dx / 2;
    const my = link.fromY + dy / 2;
    const show = lit && thickness > 0;
    link.halo.visible = link.core.visible = show;
    link.spark.visible = show && link.age < 0.18;
    if (!show) return;
    link.halo.position.x = link.core.position.x = mx;
    link.halo.position.y = link.core.position.y = my;
    link.halo.rotation.z = link.core.rotation.z = angle;
    link.halo.scale.set(length, HALO_THICK * thickness, 1);
    link.core.scale.set(length, CORE_THICK * Math.max(0.6, thickness), 1);
    // A white pop at the healed alien, just as the link lands.
    link.spark.position.x = link.toX;
    link.spark.position.y = link.toY;
    link.spark.scale.setScalar(4 * (1 - link.age / 0.18));
  }

  update(dt: number): void {
    this.frame++;
    for (const link of this.links) {
      if (link.age >= LINK_SECONDS) {
        link.halo.visible = link.core.visible = link.spark.visible = false;
        continue;
      }
      link.age += dt;
      if (link.age >= LINK_SECONDS) {
        link.halo.visible = link.core.visible = link.spark.visible = false;
        continue;
      }
      this.place(link, linkThickness(link.age / LINK_SECONDS), linkLit(link.age, this.frame));
    }
  }

  clear(): void {
    for (const link of this.links) {
      link.age = LINK_SECONDS;
      link.halo.visible = link.core.visible = link.spark.visible = false;
    }
  }
}
