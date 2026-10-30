import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three';
import type { Scene } from 'three';
import type { AlienKind } from '../game/types';

// Everything that happens on top of the models: pixel-cube explosions and sparks, expanding
// rings, the wave-clear flash and screen shake. Particles and rings are pooled (built once,
// then shown, moved and hidden), so nothing is allocated while playing.

const MAX_PARTICLES = 220;
const MAX_RINGS = 4;

const FIRE = [0xfff27a, 0xffd36a, 0xffb04f, 0xff6a3d, 0xffffff];
const KIND_COLOR: Record<AlienKind, number> = { drone: 0xb04cff, warden: 0xff4fd8, diver: 0xff6a3d, carrier: 0x3fd6a0 };
const SHIP_BURST = [0xffffff, 0x9ffbff, 0x4ff0ff, 0xffd36a, 0xff6a3d];
const SPARK = [0xffffff, 0xfff27a, 0xffd36a];
const COLORS = [...new Set([...FIRE, ...Object.values(KIND_COLOR), ...SHIP_BURST, ...SPARK])];

const EXPLOSION_SECONDS = 0.5;
const SHAKE_SECONDS = 0.3;
const SHAKE_PIXELS = 3;
const RING_SECONDS = 0.3;
const FLASH_SECONDS = 0.25;
const FLASH_PEAK = 0.3;

export class Effects {
  private readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly materials = new Map<number, MeshBasicMaterial>();
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly vx = new Float32Array(MAX_PARTICLES);
  private readonly vy = new Float32Array(MAX_PARTICLES);
  private readonly spin = new Float32Array(MAX_PARTICLES);
  private readonly size = new Float32Array(MAX_PARTICLES);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private cursor = 0;

  private readonly rings: Mesh[] = [];
  private readonly ringAge = new Float32Array(MAX_RINGS).fill(RING_SECONDS);
  private readonly ringRadius = new Float32Array(MAX_RINGS);
  private ringCursor = 0;

  private readonly flashMesh: Mesh;
  private flashLeft = 0;
  private shakeLeft = 0;
  private shakeScale = 0;
  /** A tiny random source of our own, so effects never touch the sim's seeded RNG. */
  private seed = 12345;

  constructor(scene: Scene) {
    for (const hex of COLORS) this.materials.set(hex, new MeshBasicMaterial({ color: hex }));
    const cube = new BoxGeometry(1, 1, 1);
    const first = this.materials.get(COLORS[0])!;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = new Mesh(cube, first);
      m.visible = false;
      m.position.z = 3;
      this.meshes.push(m);
      this.group.add(m);
      this.age[i] = this.life[i] = 1;
    }
    const ringGeo = new RingGeometry(0.88, 1, 18);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new Mesh(ringGeo, new MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, side: DoubleSide }));
      m.visible = false;
      m.position.z = 4;
      this.rings.push(m);
      this.group.add(m);
    }
    // Big enough to cover the field even after the camera tilt shifts it up the screen.
    this.flashMesh = new Mesh(
      new PlaneGeometry(500, 600),
      new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
    );
    this.flashMesh.position.z = 30;
    this.flashMesh.renderOrder = 100;
    this.flashMesh.visible = false;
    this.group.add(this.flashMesh);
    scene.add(this.group);
  }

  private random(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  private emit(x: number, y: number, count: number, colors: readonly number[], speed: number, size: number, life: number): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const angle = this.random() * Math.PI * 2;
      const v = speed * (0.35 + this.random() * 0.65);
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(angle) * v;
      this.vy[i] = Math.sin(angle) * v;
      this.spin[i] = (this.random() - 0.5) * 12;
      this.size[i] = size * (0.6 + this.random() * 0.7);
      this.age[i] = 0;
      this.life[i] = life * (0.7 + this.random() * 0.3);
      const m = this.meshes[i];
      m.material = this.materials.get(colors[Math.floor(this.random() * colors.length)])!;
      m.visible = true;
    }
  }

  /** An alien blew up: a burst of warm pixel cubes with a few in its own colour. */
  explode(x: number, y: number, kind: AlienKind): void {
    this.emit(x, y, 9, FIRE, 70, 3, EXPLOSION_SECONDS);
    this.emit(x, y, 4, [KIND_COLOR[kind]], 50, 3, EXPLOSION_SECONDS);
  }

  /** An alien took a hit and survived. */
  sparks(x: number, y: number): void {
    this.emit(x, y, 5, SPARK, 55, 1.6, 0.25);
  }

  /** The ship was hit: a bigger burst and a shake. */
  shipHit(x: number, y: number): void {
    this.emit(x, y, 26, SHIP_BURST, 95, 3.2, 0.6);
    this.shakeLeft = SHAKE_SECONDS;
    this.shakeScale = SHAKE_PIXELS;
  }

  /** The shield absorbed a hit: a ring flashes out from the ship. */
  shieldRing(x: number, y: number): void {
    const i = this.ringCursor;
    this.ringCursor = (this.ringCursor + 1) % MAX_RINGS;
    this.ringAge[i] = 0;
    this.ringRadius[i] = 11;
    this.rings[i].position.x = x;
    this.rings[i].position.y = y;
    this.rings[i].visible = true;
    this.shakeLeft = Math.max(this.shakeLeft, SHAKE_SECONDS / 3);
    this.shakeScale = Math.max(this.shakeScale, 1);
  }

  /** A brief wash of white over the field. */
  waveFlash(): void {
    this.flashLeft = FLASH_SECONDS;
  }

  /** Advances all effects by `dt` seconds. */
  update(dt: number): void {
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const m = this.meshes[i];
      if (!m.visible) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) {
        m.visible = false;
        continue;
      }
      // Drag slows the cubes as they fly out; they shrink to nothing over their life.
      const drag = Math.exp(-3 * dt);
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      const s = this.size[i] * (1 - u * u);
      m.position.x = this.px[i];
      m.position.y = this.py[i];
      m.scale.setScalar(s);
      m.rotation.z += this.spin[i] * dt;
    }

    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = this.rings[i];
      if (!ring.visible) continue;
      this.ringAge[i] += dt;
      const u = this.ringAge[i] / RING_SECONDS;
      if (u >= 1) {
        ring.visible = false;
        continue;
      }
      ring.scale.setScalar(this.ringRadius[i] * (1 + u * 0.7));
      (ring.material as MeshBasicMaterial).opacity = 1 - u;
    }

    if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - dt);
      const u = this.flashLeft / FLASH_SECONDS;
      this.flashMesh.visible = this.flashLeft > 0;
      (this.flashMesh.material as MeshBasicMaterial).opacity = u * u * FLASH_PEAK;
    }

    if (this.shakeLeft > 0) this.shakeLeft = Math.max(0, this.shakeLeft - dt);
  }

  /** The current shake as whole art pixels, written into `out`. */
  shakeOffset(out: { x: number; y: number }): void {
    if (this.shakeLeft <= 0) {
      out.x = out.y = 0;
      return;
    }
    const strength = this.shakeScale * (this.shakeLeft / SHAKE_SECONDS);
    out.x = Math.round((this.random() * 2 - 1) * strength);
    out.y = Math.round((this.random() * 2 - 1) * strength);
  }

  /** Hides everything, e.g. when a new run starts. */
  clear(): void {
    for (const m of this.meshes) m.visible = false;
    for (const r of this.rings) r.visible = false;
    this.flashMesh.visible = false;
    this.flashLeft = 0;
    this.shakeLeft = 0;
  }
}
