import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Group, Mesh, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';

// Chain Spark's electric arcs: a jagged line from one alien to the next, a wide cyan glow with a
// white core, alive for a moment and crackling (the jag is re-rolled a few times) before it
// fades. Pooled: each arc owns two triangle strips and a small flash cube at its target, built
// once; starting an arc only rewrites vertex data.

/** Seconds an arc lasts. */
export const ARC_SECONDS = 0.12;
/** The jag is re-rolled this often while the arc lives, seconds. */
const REROLL_SECONDS = 0.04;
/** Most points an arc line has (ends included). */
export const MAX_ARC_POINTS = 12;
const MAX_ARCS = 10;
/** Halo and core half widths, art pixels. */
const HALO_HALF = 1.7;
const CORE_HALF = 0.6;
const HALO_COLOR = 0x52ddeb;
const CORE_COLOR = 0xffffff;
const POP_COLOR = 0xffffff;
/** Biggest sideways kink of the line, art pixels, and as a fraction of the arc's length. */
const MAX_JAG = 5;
const JAG_FRACTION = 0.22;
/** Roughly this many art pixels between the line's points. */
const POINT_SPACING = 6;

/** How many points an arc of this length gets: one every few pixels, at least a kink in the middle, at most the buffer. */
export function arcPointCount(length: number): number {
  return Math.max(4, Math.min(MAX_ARC_POINTS, Math.round(length / POINT_SPACING) + 1));
}

/**
 * Writes a jagged line from (fromX, fromY) to (toX, toY) into `out` as x, y pairs and returns the
 * point count. The first and last points are exactly the ends; points between are pushed
 * sideways by up to `jag(length)`, tapering to nothing toward each end. `rand` gives 0 to 1.
 */
export function arcPoints(fromX: number, fromY: number, toX: number, toY: number, rand: () => number, out: Float32Array): number {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.hypot(dx, dy);
  const n = arcPointCount(length);
  const nx = length > 1e-6 ? -dy / length : 0;
  const ny = length > 1e-6 ? dx / length : 1;
  const amp = Math.min(MAX_JAG, length * JAG_FRACTION);
  out[0] = fromX;
  out[1] = fromY;
  for (let i = 1; i < n - 1; i++) {
    const u = i / (n - 1);
    const taper = Math.sin(u * Math.PI);
    const side = (rand() * 2 - 1) * amp * taper;
    out[i * 2] = fromX + dx * u + nx * side;
    out[i * 2 + 1] = fromY + dy * u + ny * side;
  }
  out[(n - 1) * 2] = toX;
  out[(n - 1) * 2 + 1] = toY;
  return n;
}

/**
 * Turns a polyline of `n` points (x, y pairs in `points`) into a triangle strip of `halfWidth`
 * either side, written to `out` as x, y, z triples, two vertices per point (left, right). Each
 * point's sideways direction is across the line there (the average of its two segments).
 */
export function stripVertices(points: Float32Array, n: number, halfWidth: number, z: number, out: Float32Array): void {
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = points[b * 2] - points[a * 2];
    let ty = points[b * 2 + 1] - points[a * 2 + 1];
    const len = Math.hypot(tx, ty);
    if (len > 1e-6) {
      tx /= len;
      ty /= len;
    } else {
      tx = 0;
      ty = 1;
    }
    const px = points[i * 2];
    const py = points[i * 2 + 1];
    const o = i * 6;
    out[o] = px - ty * halfWidth;
    out[o + 1] = py + tx * halfWidth;
    out[o + 2] = z;
    out[o + 3] = px + ty * halfWidth;
    out[o + 4] = py - tx * halfWidth;
    out[o + 5] = z;
  }
}

/** How thick an arc still is, 1 to 0, `u` (0 to 1) of the way through its life: full, then thinning out. */
export function arcThickness(u: number): number {
  return u < 0.5 ? 1 : Math.max(0, 1 - (u - 0.5) / 0.5);
}

/** A strip mesh with room for MAX_ARC_POINTS points, drawn only as far as the arc needs. */
function stripMesh(color: number): Mesh {
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(MAX_ARC_POINTS * 6), 3);
  position.setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position);
  const index: number[] = [];
  for (let i = 0; i < MAX_ARC_POINTS - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, new MeshBasicMaterial({ color, side: DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

interface Arc {
  halo: Mesh;
  core: Mesh;
  pop: Mesh;
  age: number;
  rerollAt: number;
  n: number;
  /** The arc's centre line, x and y pairs. */
  pts: Float32Array;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export class ArcView {
  private readonly group = new Group();
  private readonly arcs: Arc[] = [];
  private cursor = 0;
  private seed = 9876;
  private readonly rand = (): number => {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  constructor(scene: Scene) {
    const cube = new BoxGeometry(1, 1, 1);
    const popMaterial = new MeshBasicMaterial({ color: POP_COLOR });
    for (let i = 0; i < MAX_ARCS; i++) {
      const halo = stripMesh(HALO_COLOR);
      const core = stripMesh(CORE_COLOR);
      const pop = new Mesh(cube, popMaterial);
      pop.position.z = 3.6;
      pop.visible = false;
      halo.renderOrder = 20;
      core.renderOrder = 21;
      this.group.add(halo, core, pop);
      this.arcs.push({ halo, core, pop, age: ARC_SECONDS, rerollAt: 0, n: 0, pts: new Float32Array(MAX_ARC_POINTS * 2), fromX: 0, fromY: 0, toX: 0, toY: 0 });
    }
    scene.add(this.group);
  }

  /** Starts an arc between two points. */
  add(fromX: number, fromY: number, toX: number, toY: number): void {
    const arc = this.arcs[this.cursor];
    this.cursor = (this.cursor + 1) % MAX_ARCS;
    arc.age = 0;
    arc.rerollAt = REROLL_SECONDS;
    arc.fromX = fromX;
    arc.fromY = fromY;
    arc.toX = toX;
    arc.toY = toY;
    arc.halo.visible = arc.core.visible = arc.pop.visible = true;
    arc.pop.position.x = toX;
    arc.pop.position.y = toY;
    this.shape(arc, 1);
  }

  private shape(arc: Arc, thickness: number): void {
    arc.n = arcPoints(arc.fromX, arc.fromY, arc.toX, arc.toY, this.rand, arc.pts);
    this.fill(arc, thickness);
  }

  private fill(arc: Arc, thickness: number): void {
    const draw = (arc.n - 1) * 6;
    this.strip(arc, arc.halo, HALO_HALF * thickness, 3.2, draw);
    this.strip(arc, arc.core, CORE_HALF * thickness, 3.4, draw);
  }

  private strip(arc: Arc, mesh: Mesh, half: number, z: number, draw: number): void {
    const attr = mesh.geometry.getAttribute('position') as BufferAttribute;
    stripVertices(arc.pts, arc.n, half, z, attr.array as Float32Array);
    attr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, draw);
  }

  update(dt: number): void {
    for (const arc of this.arcs) {
      if (!arc.halo.visible) continue;
      arc.age += dt;
      const u = arc.age / ARC_SECONDS;
      if (u >= 1) {
        arc.halo.visible = arc.core.visible = arc.pop.visible = false;
        continue;
      }
      const thick = arcThickness(u);
      if (arc.age >= arc.rerollAt) {
        arc.rerollAt += REROLL_SECONDS;
        this.shape(arc, thick);
      } else {
        this.fill(arc, thick);
      }
      arc.pop.scale.setScalar(4.5 * (1 - u));
    }
  }

  clear(): void {
    for (const arc of this.arcs) {
      arc.age = ARC_SECONDS;
      arc.halo.visible = arc.core.visible = arc.pop.visible = false;
    }
  }
}
