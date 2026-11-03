import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry } from 'three';
import type { Scene } from 'three';
import type { AlienKind, PowerUpKind } from '../game/types';
import { WavePool } from './waves';

// Everything that happens on top of the models: pixel-cube explosions and sparks, expanding
// rings and waves, the wave-clear flash, the boss's multi-burst death and screen shake. Particles
// and rings are pooled (built once, then shown, moved and hidden), so nothing is allocated
// while playing.

const MAX_PARTICLES = 360;
/** Bursts a boss's death can have queued at once. */
const MAX_PENDING = 24;
const MAX_RINGS = 4;

const FIRE = [0xfff27a, 0xffd36a, 0xffb04f, 0xff6a3d, 0xffffff];
const KIND_COLOR: Record<AlienKind, number> = { drone: 0xb04cff, warden: 0xff4fd8, diver: 0xff6a3d, carrier: 0x3fd6a0, splitter: 0xc0392b, mini: 0xc0392b, warper: 0xa46bff, mender: 0x4fff9b };
const SHIP_BURST = [0xffffff, 0x9ffbff, 0x4ff0ff, 0xffd36a, 0xff6a3d];
const SPARK = [0xffffff, 0xfff27a, 0xffd36a];
/** The colour of each power-up's icon, for pickup sparkles. */
export const POWER_UP_COLOR: Record<PowerUpKind, number> = { spread: 0xffb04f, laser: 0x4ff0ff, slow: 0x9b7bff, helper: 0x4fff9b };
const POWER_UP_SPARK: Record<PowerUpKind, readonly number[]> = {
  spread: [0xffb04f, 0xffe164, 0xffffff],
  laser: [0x4ff0ff, 0x9dfafd, 0xffffff],
  slow: [0x9b7bff, 0xc1c3eb, 0xffffff],
  helper: [0x4fff9b, 0xd3f1ff, 0xffffff],
};
/** Cyan and white, for the Shield Burst and the core's shield. */
export const SHIELD_SPARK: readonly number[] = [0xffffff, 0x9dfafd, 0x52ddeb];
/** The Brood Mother's armour, its core and its fire. */
const PLATE_SHARDS = [0xc1c3eb, 0x9391b9, 0x604da8, 0xffffff];
const CORE_SPARK = [0xff56da, 0xffffff, 0xff8a45];
const DEATH_BURST = [0xffffff, 0xfff27a, 0xffd36a, 0xff8a45, 0xff56da, 0xac55f7];
/** The Hive Mind's death: the same, but redder. */
const HIVE_DEATH_BURST = [0xffffff, 0xffe164, 0xff8a45, 0xff5a5a, 0xc0392b, 0xff56da];
/** The Hive Heart's death: magenta, gold and acid. */
const HEART_DEATH_BURST = [0xffffff, 0xff56da, 0xf5c542, 0xc6f23c, 0xff4fd8, 0xffe164];
/** The Hive Heart's beat: hot magenta and white; a cut vein: its red flesh with the acid and gold of its glow. */
const HEART_SPARK = [0xff56da, 0xffffff, 0xff4fd8];
export const VEIN_SHARDS: readonly number[] = [0xd9334d, 0x8e2a3c, 0xc6f23c, 0xf5c542, 0xffffff];
/** Sector 2's reds: a Splitter's seam, the Hive Mind's ring segments, and a bunker's crumbs. */
export const SPLIT_SPARK: readonly number[] = [0xff8a3d, 0xffe14f, 0xc0392b, 0xffffff];
export const SEGMENT_SHARDS: readonly number[] = [0xd04a64, 0x8e2a3c, 0xff5a5a, 0xffffff];
export const BUNKER_CRUMBS: readonly number[] = [0x3fd6a0, 0x1f7a66, 0x7af0c8];
/** The Gravity Well: violet and magenta with white. */
export const WELL_SPARK: readonly number[] = [0xac55f7, 0xff56da, 0xffffff, 0x9b7bff];
/** Chain Spark's arcs: cyan and white. */
export const ARC_SPARK: readonly number[] = [0xffffff, 0x9dfafd, 0x52ddeb];
/** A missile's exhaust trail: hot sparks, and a little grey smoke. */
const MISSILE_SPARK: readonly number[] = [0xffe164, 0xff8a45, 0xffffff];
const MISSILE_SMOKE: readonly number[] = [0x9391b9, 0x7869aa];
/** Sector 3: acid and gold, the Warper's teal, the Mender's green, and a mine's gold, red and dust. */
export const ACID_SPARK: readonly number[] = [0xc6f23c, 0x8db52a, 0xffffff, 0xf5c542];
export const WARP_SPARK: readonly number[] = [0x3fe8d0, 0x1d8a7c, 0xffffff];
export const MEND_SPARK: readonly number[] = [0x4fff9b, 0x1f9e63, 0xffffff];
const MINE_GOLD: readonly number[] = [0xf5c542, 0xffe164, 0xff8a45, 0xffffff];
const MINE_RED: readonly number[] = [0xff5a5a, 0xff8a45, 0xffe164, 0xc0392b];
const MINE_DUST: readonly number[] = [0x9391b9, 0x7869aa, 0x3fd6a0, 0x7af0c8];
/** The pincer's trails: acid green from the left half, gold from the right. */
export const PINCER_TRAIL: readonly (readonly number[])[] = [[0xc6f23c, 0x8db52a], [0xf5c542, 0x8a6a1a]];
const COLORS = [
  ...new Set([
    ...FIRE,
    ...Object.values(KIND_COLOR),
    ...SHIP_BURST,
    ...SPARK,
    ...Object.values(POWER_UP_SPARK).flat(),
    ...SHIELD_SPARK,
    ...PLATE_SHARDS,
    ...CORE_SPARK,
    ...DEATH_BURST,
    ...HIVE_DEATH_BURST,
    ...HEART_DEATH_BURST,
    ...HEART_SPARK,
    ...VEIN_SHARDS,
    ...SPLIT_SPARK,
    ...SEGMENT_SHARDS,
    ...BUNKER_CRUMBS,
    ...WELL_SPARK,
    ...ARC_SPARK,
    ...MISSILE_SPARK,
    ...MISSILE_SMOKE,
    ...ACID_SPARK,
    ...WARP_SPARK,
    ...MEND_SPARK,
    ...MINE_GOLD,
    ...MINE_RED,
    ...MINE_DUST,
    ...PINCER_TRAIL.flat(),
  ]),
];

const EXPLOSION_SECONDS = 0.5;
const SHAKE_SECONDS = 0.3;
const SHAKE_PIXELS = 3;
const RING_SECONDS = 0.3;
const FLASH_SECONDS = 0.25;
const FLASH_PEAK = 0.3;
/** How long the boss's death lasts, from the first burst to the last big one, in seconds. */
export const BOSS_DEATH_SECONDS = 1.2;

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

  private readonly waves: WavePool;

  private readonly pendingDelay = new Float32Array(MAX_PENDING).fill(-1);
  private readonly pendingX = new Float32Array(MAX_PENDING);
  private readonly pendingY = new Float32Array(MAX_PENDING);
  private readonly pendingBig = new Uint8Array(MAX_PENDING);
  private pendingCursor = 0;
  /** 0 the Brood Mother's death palette, 1 the Hive Mind's, 2 the Hive Heart's. */
  private deathStyle = 0;

  private readonly flashMesh: Mesh;
  private flashLeft = 0;
  private flashTotal = FLASH_SECONDS;
  private flashPeak = FLASH_PEAK;
  private shakeLeft = 0;
  private shakeTotal = SHAKE_SECONDS;
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
    this.waves = new WavePool(this.group);
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

  /** Starts one particle with the given velocity. */
  private emitOne(x: number, y: number, vx: number, vy: number, colors: readonly number[], size: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.px[i] = x;
    this.py[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.spin[i] = (this.random() - 0.5) * 8;
    this.size[i] = size * (0.7 + this.random() * 0.6);
    this.age[i] = 0;
    this.life[i] = life * (0.75 + this.random() * 0.25);
    const m = this.meshes[i];
    m.material = this.materials.get(colors[Math.floor(this.random() * colors.length)])!;
    m.visible = true;
  }

  /**
   * A missile's exhaust: a spark, and now and then a puff of smoke, left at (x, y) and drifting
   * back along the missile's flight (it flies at (vx, vy)).
   */
  missileTrail(x: number, y: number, vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy) || 1;
    const bx = (-vx / speed) * 14;
    const by = (-vy / speed) * 14;
    // Leave it at the nozzle, a little behind the missile's centre.
    x += bx * 0.25;
    y += by * 0.25;
    // A little sideways scatter, across the flight direction.
    const side = (this.random() - 0.5) * 10;
    this.emitOne(x, y, bx - (by / 14) * side, by + (bx / 14) * side, MISSILE_SPARK, 1.7, 0.2);
    if (this.random() < 0.4) this.emitOne(x, y, bx * 0.4, by * 0.4, MISSILE_SMOKE, 2.2, 0.38);
  }

  /** Motes pulled in from a ring of `radius` to (x, y): a Gravity Well swallowing a shot. */
  implode(x: number, y: number, radius: number, count: number, colors: readonly number[]): void {
    for (let n = 0; n < count; n++) {
      const a = this.random() * Math.PI * 2;
      // Drag slows particles, so they cover about radius / 7.5 per unit of speed in their short life.
      const v = radius * 7.5;
      this.emitOne(x + Math.cos(a) * radius, y + Math.sin(a) * radius, -Math.cos(a) * v, -Math.sin(a) * v, colors, 2, 0.2);
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

  /** A small burst of sparks in the given colours (shot reflections, shield hits, pickups). */
  sparksIn(x: number, y: number, colors: readonly number[], count = 5, speed = 55): void {
    this.emit(x, y, count, colors, speed, 1.8, 0.28);
  }

  /** A falling pickup appeared: a little sparkle in its colour. */
  pickupSparkle(x: number, y: number, kind: PowerUpKind): void {
    this.emit(x, y, 4, POWER_UP_SPARK[kind], 35, 1.6, 0.35);
  }

  /** A ship caught a pickup: a ring of sparkles in its colour and a ring wave. */
  pickupCaught(x: number, y: number, kind: PowerUpKind): void {
    this.emit(x, y, 14, POWER_UP_SPARK[kind], 80, 2.4, 0.5);
    this.waves.start(x, y, 6, 26, 0.3, 2, POWER_UP_COLOR[kind]);
  }

  /** A bunker was hit: a few green crumbs. */
  debris(x: number, y: number): void {
    this.emit(x, y, 5, BUNKER_CRUMBS, 40, 1.6, 0.4);
  }

  /** A Splitter broke in two: a flash of orange sparks from its seam and a quick ring. */
  splitBurst(x: number, y: number): void {
    this.emit(x, y, 10, SPLIT_SPARK, 70, 2.4, 0.4);
    this.waves.start(x, y, 3, 14, 0.2, 2, 0xff8a3d);
  }

  /** A shard of something big flies off from (fromX, fromY) through (x, y): a ring segment shattering. */
  shatter(x: number, y: number, fromX: number, fromY: number, colors: readonly number[] = SEGMENT_SHARDS): void {
    const base = Math.atan2(y - fromY, x - fromX);
    for (let n = 0; n < 10; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const angle = base + (this.random() - 0.5) * 1.1;
      const v = 50 + this.random() * 70;
      this.px[i] = x;
      this.py[i] = y;
      this.vx[i] = Math.cos(angle) * v;
      this.vy[i] = Math.sin(angle) * v;
      this.spin[i] = (this.random() - 0.5) * 14;
      this.size[i] = 3.6 * (0.6 + this.random() * 0.8);
      this.age[i] = 0;
      this.life[i] = 0.7 * (0.7 + this.random() * 0.3);
      const m = this.meshes[i];
      m.material = this.materials.get(colors[Math.floor(this.random() * colors.length)])!;
      m.visible = true;
    }
    this.kick(SHAKE_SECONDS * 0.8, 2);
  }

  /**
   * A mine went off, `radius` art pixels across. Shot: a big gold ring at the burst's full reach
   * and a scatter of fire, so the player sees which aliens it caught. Bunker: a small puff of
   * dust. Ground: a red-orange blast at the ship's row, with a shake.
   */
  mineBurst(x: number, y: number, radius: number, cause: 'shot' | 'bunker' | 'ground'): void {
    if (cause === 'shot') {
      this.waves.start(x, y, radius * 0.25, radius, 0.3, 2, 0xf5c542);
      this.waves.start(x, y, radius * 0.1, radius * 0.65, 0.22, 2, 0xff8a45);
      this.emit(x, y, 16, MINE_GOLD, radius * 3.4, 2.6, 0.45);
      this.emit(x, y, 6, FIRE, radius * 1.6, 3.4, 0.35);
      this.kick(SHAKE_SECONDS * 0.5, 1);
    } else if (cause === 'bunker') {
      this.emit(x, y, 7, MINE_DUST, radius * 5, 1.8, 0.4);
      this.waves.start(x, y, 2, radius, 0.2, 1, 0x9391b9);
    } else {
      this.waves.start(x, y, radius * 0.3, radius * 1.3, 0.3, 2, 0xff5a5a);
      this.emit(x, y, 14, MINE_RED, radius * 4.2, 2.8, 0.5);
      this.emit(x, y, 5, FIRE, radius * 2, 3.6, 0.4);
      this.kick(SHAKE_SECONDS * 0.7, 2);
    }
  }

  /** A Warper blinked from (fromX, fromY) to (toX, toY): teal pixels strewn along the path, a pop at each end. */
  warpTrail(fromX: number, fromY: number, toX: number, toY: number): void {
    const steps = Math.max(3, Math.min(10, Math.round(Math.hypot(toX - fromX, toY - fromY) / 12)));
    for (let n = 0; n <= steps; n++) {
      const u = n / steps;
      // Still pixels that shrink away, the ones nearest the old spot lasting longest (they fade in order).
      this.emitOne(fromX + (toX - fromX) * u, fromY + (toY - fromY) * u, 0, 0, WARP_SPARK, 3, 0.2 + (1 - u) * 0.25);
    }
    this.emit(fromX, fromY, 8, WARP_SPARK, 60, 2.6, 0.35);
    this.waves.start(fromX, fromY, 2, 14, 0.22, 1, 0x3fe8d0);
  }

  /** A Warper finished warping in: a quick teal ring and a few sparks. */
  warpArrived(x: number, y: number): void {
    this.waves.start(x, y, 3, 16, 0.2, 1, 0x3fe8d0);
    this.emit(x, y, 6, WARP_SPARK, 45, 2, 0.3);
  }

  /** A Mender pulsed: a green ring spreads from it. */
  mendRing(x: number, y: number): void {
    this.waves.start(x, y, 3, 30, 0.4, 1.5, 0x4fff9b);
    this.emit(x, y, 6, MEND_SPARK, 40, 2, 0.35);
  }

  /** An alien was healed: a few green sparks lifting off it. */
  mended(x: number, y: number): void {
    for (let n = 0; n < 4; n++) this.emitOne(x + (this.random() - 0.5) * 8, y + (this.random() - 0.5) * 4, 0, 22 + this.random() * 14, MEND_SPARK, 1.8, 0.45);
  }

  /** Acid rain landing at (x, y): a few drops splashing back up. */
  acidSplash(x: number, y: number): void {
    for (let n = 0; n < 2; n++) {
      const a = Math.PI * (0.2 + this.random() * 0.6);
      const v = 30 + this.random() * 40;
      this.emitOne(x, y, Math.cos(a) * v, Math.sin(a) * v, ACID_SPARK, 1.8, 0.3);
    }
  }

  /** One still pixel of a fast mover's trail (the pincer's halves), shrinking away. */
  trailPixel(x: number, y: number, colors: readonly number[]): void {
    this.emitOne(x, y, 0, 0, colors, 2.2, 0.22);
  }

  /** A Hive Mind beam begins to fire: a red ring from the core. */
  beamFlare(x: number, y: number): void {
    this.waves.start(x, y, 6, 30, 0.25, 2, 0xff5a5a);
    this.emit(x, y, 8, HIVE_DEATH_BURST, 60, 2.4, 0.35);
  }

  /** The ship was hit: a bigger burst and a shake. */
  shipHit(x: number, y: number): void {
    this.emit(x, y, 26, SHIP_BURST, 95, 3.2, 0.6);
    this.kick(SHAKE_SECONDS, SHAKE_PIXELS);
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
    this.kick(SHAKE_SECONDS / 3, 1);
  }

  /** A brief wash of colour over the field (white for a wave clear). */
  waveFlash(color = 0xffffff, peak = FLASH_PEAK, seconds = FLASH_SECONDS): void {
    (this.flashMesh.material as MeshBasicMaterial).color.setHex(color);
    this.flashLeft = this.flashTotal = seconds;
    this.flashPeak = peak;
  }

  /** A ring of constant thickness growing from `from` to `to` art pixels. */
  wave(x: number, y: number, from: number, to: number, seconds: number, thick: number, color: number): void {
    this.waves.start(x, y, from, to, seconds, thick, color);
  }

  /** A Pulse Bomb: a bright shockwave sweeping the whole field from the ship, and a shake. */
  pulse(x: number, y: number): void {
    this.waves.start(x, y, 4, 400, 0.6, 5, 0xd3f1ff);
    this.emit(x, y, 18, SHIELD_SPARK, 120, 2.4, 0.5);
    this.kick(SHAKE_SECONDS, SHAKE_PIXELS);
  }

  /** A bomb-on-kill burst of this radius: a quick ring and a scatter of fire. */
  blast(x: number, y: number, radius: number): void {
    this.waves.start(x, y, radius * 0.3, radius, 0.28, 2, 0xffd36a);
    this.emit(x, y, Math.min(14, 4 + Math.round(radius / 6)), FIRE, radius * 3.2, 2.4, 0.4);
  }

  /** A boss part blew off: a hefty burst of its own shards and fire, and a small shake. */
  partBurst(x: number, y: number, shards: readonly number[] = PLATE_SHARDS): void {
    this.emit(x, y, 14, FIRE, 85, 3.6, 0.55);
    this.emit(x, y, 9, shards, 70, 3.2, 0.6);
    this.kick(SHAKE_SECONDS * 0.8, 2);
  }

  /** The boss's armour is gone and its core is bare: a burst in the core's colours. */
  coreBare(x: number, y: number): void {
    this.emit(x, y, 14, CORE_SPARK, 90, 2.6, 0.5);
    this.waves.start(x, y, 6, 40, 0.35, 2, 0xff56da);
  }

  /**
   * The boss dies: a string of bursts all over its body for `BOSS_DEATH_SECONDS`, then a huge
   * one, with a long shake and a white flash at the end. `halfWidth` is half its span.
   */
  bigExplosion(x: number, y: number, halfWidth: number, halfHeight = 12, style: boolean | 'heart' = false): void {
    this.deathStyle = style === 'heart' ? 2 : style ? 1 : 0;
    for (let n = 0; n < 16; n++) {
      const u = n / 16;
      this.queueBurst(
        x + (this.random() * 2 - 1) * halfWidth,
        y + (this.random() * 2 - 1) * halfHeight,
        u * BOSS_DEATH_SECONDS * 0.9 + this.random() * 0.05,
        false,
      );
    }
    this.queueBurst(x, y, BOSS_DEATH_SECONDS, true);
    this.kick(BOSS_DEATH_SECONDS + 0.5, 3);
    this.emit(x, y, 20, this.deathColors(), 100, 3.4, 0.6);
  }

  private deathColors(): readonly number[] {
    return this.deathStyle === 2 ? HEART_DEATH_BURST : this.deathStyle === 1 ? HIVE_DEATH_BURST : DEATH_BURST;
  }

  /**
   * The Hive Heart beats: a magenta ring leaves it, with a bright notch at the ring of shots'
   * gap (`gapAngle`, radians) so a player can learn to read where to go; phase 3 shakes the screen a little.
   */
  heartBeat(x: number, y: number, gapAngle: number, phase: number): void {
    this.waves.start(x, y, 10, 25, 0.22, 1.4, phase >= 3 ? 0xff5a5a : 0xff56da, gapAngle, 0.22);
    this.emit(x, y, 5, HEART_SPARK, 40, 2, 0.3);
    if (phase >= 3) this.kick(0.12, 1);
  }

  private queueBurst(x: number, y: number, delay: number, big: boolean): void {
    const i = this.pendingCursor;
    this.pendingCursor = (this.pendingCursor + 1) % MAX_PENDING;
    this.pendingDelay[i] = delay;
    this.pendingX[i] = x;
    this.pendingY[i] = y;
    this.pendingBig[i] = big ? 1 : 0;
  }

  /** Shakes the screen for `seconds`, by up to `pixels`, unless it is already shaking harder. */
  private kick(seconds: number, pixels: number): void {
    const now = this.shakeLeft > 0 ? this.shakeScale * (this.shakeLeft / this.shakeTotal) : 0;
    if (pixels < now) return;
    this.shakeLeft = this.shakeTotal = seconds;
    this.shakeScale = pixels;
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

    for (let i = 0; i < MAX_PENDING; i++) {
      if (this.pendingDelay[i] < 0) continue;
      this.pendingDelay[i] -= dt;
      if (this.pendingDelay[i] >= 0) continue;
      this.pendingDelay[i] = -1;
      const x = this.pendingX[i];
      const y = this.pendingY[i];
      if (this.pendingBig[i] === 1) {
        this.emit(x, y, 44, this.deathColors(), 150, 4.6, 0.8);
        this.emit(x, y, 24, FIRE, 90, 3.6, 0.7);
        this.waves.start(x, y, 8, 130, 0.5, 4, 0xffffff);
        if (this.deathStyle === 1) this.waves.start(x, y, 4, 90, 0.6, 3, 0xff5a5a);
        if (this.deathStyle === 2) {
          // Three rings, one behind the other: magenta, gold and acid.
          this.waves.start(x, y, 4, 110, 0.55, 3, 0xff56da);
          this.waves.start(x, y, 2, 80, 0.65, 3, 0xf5c542);
          this.waves.start(x, y, 2, 55, 0.75, 2, 0xc6f23c);
        }
        this.waveFlash(this.deathStyle === 1 ? 0xffb0a0 : this.deathStyle === 2 ? 0xffe6f8 : 0xffffff, 0.4, 0.3);
      } else {
        this.emit(x, y, 11, FIRE, 80, 4.4, 0.6);
        this.emit(x, y, 5, this.deathColors(), 60, 3.2, 0.55);
      }
    }
    this.waves.update(dt);

    if (this.flashLeft > 0) {
      this.flashLeft = Math.max(0, this.flashLeft - dt);
      const u = this.flashLeft / this.flashTotal;
      this.flashMesh.visible = this.flashLeft > 0;
      (this.flashMesh.material as MeshBasicMaterial).opacity = u * u * this.flashPeak;
    }

    if (this.shakeLeft > 0) this.shakeLeft = Math.max(0, this.shakeLeft - dt);
  }

  /** The current shake as whole art pixels, written into `out`. */
  shakeOffset(out: { x: number; y: number }): void {
    if (this.shakeLeft <= 0) {
      out.x = out.y = 0;
      return;
    }
    const strength = this.shakeScale * (this.shakeLeft / this.shakeTotal);
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
    this.pendingDelay.fill(-1);
    this.waves.clear();
  }
}
