import { BoxGeometry, DataTexture, InstancedMesh, Mesh, MeshBasicMaterial, NearestFilter, Object3D, PlaneGeometry, RGBAFormat, RepeatWrapping, SRGBColorSpace } from 'three';
import type { Scene, Texture } from 'three';
import { beamStopY } from '../game/bunkers';
import { ACID_RAIN_SECONDS, MAX_ACID } from '../game/hazards';
import { FIELD_HEIGHT } from '../game/playfield';
import { SHIP_Y } from '../game/player';
import type { AcidColumn, Bunker } from '../game/types';
import type { Effects } from './effects';
import type { Model } from './models';

// Sector 3's acid rain. A column is marked for a second (a flickering dashed gold band at the top
// of the field and a faint dotted guide down its length: harmless, just a warning), then rains
// for 1.5 seconds: acid_drop models fall through a translucent acid-green curtain (a dithered
// checker, so it reads as see-through at this resolution) between two bright edges, from the top
// of the field down to the ship's row, or to the top of the bunker in its way, where it splashes.
//
// The view is driven by the sim's own columns every frame (state and time left), not by events,
// so a renderer that is reset mid-wave still draws the right thing. Everything is pooled and
// built once; a frame only moves, shows and hides what is already there.

const GOLD = 0xf5c542;
const GOLD_DARK = 0x8a6a1a;
const ACID = 0xc6f23c;
const ACID_MID = 0x8db52a;
const ACID_DARK = 0x4f6e18;

/** The warning band at the top of the field is this tall, art pixels. */
export const MARKER_HEIGHT = 28;
/** Falling acid_drop models per column, and thin streaks (cheap instanced pixels) falling between them. */
export const DROPS_PER_COLUMN = 8;
export const STREAKS_PER_COLUMN = 26;
/** Seconds the rain takes to fill the column from the top, and to drain away at the end. */
const FILL_SECONDS = 0.12;
const DRAIN_SECONDS = 0.2;
/** Seconds between the splashes at the foot of a raining column. */
const SPLASH_SECONDS = 0.07;
/** The height of one repeat of the guide's dots, art pixels. */
const GUIDE_PERIOD = 8;

const TOP = FIELD_HEIGHT / 2;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Is the warning band drawn now? It flickers, then holds steady for the last moments before the rain. */
export function warnVisible(timeLeft: number): boolean {
  return timeLeft < 0.2 || Math.floor(timeLeft * 14) % 3 !== 0;
}

/**
 * The vertical span a raining column's curtain covers, as [top, bottom] y values written into
 * `out`. `elapsed` is seconds since the rain began and `timeLeft` seconds until it stops: it
 * fills downward from the top of the field, and at the end drains away from the top, so the rain
 * falls into place and then falls away. `floorY` is where it lands.
 */
export function rainSpan(elapsed: number, timeLeft: number, floorY: number, out: number[]): number[] {
  const height = TOP - floorY;
  const reach = clamp01(elapsed / FILL_SECONDS);
  const drained = clamp01(1 - timeLeft / DRAIN_SECONDS);
  out[0] = Math.round(TOP - drained * height);
  out[1] = Math.round(TOP - reach * height);
  return out;
}

/**
 * Where falling thing `i` is at `time` (y), through a loop of `loop` pixels from `top`. Each has
 * its own speed and a starting place spread by the golden ratio, so they never clump into rows.
 */
export function dropY(i: number, time: number, top: number, loop: number): number {
  const speed = 150 + 100 * ((i * 0.381966) % 1);
  const phase = ((i * 0.618034) % 1) * loop;
  return top - ((phase + time * speed) % loop);
}

/** The x offset of drop `i` across a column of the given half width: spread evenly, scrambled in order. */
export function dropOffset(i: number, halfWidth: number, lanes = DROPS_PER_COLUMN): number {
  const lane = (i * 5) % lanes;
  return -halfWidth + 2 + (lane / (lanes - 1)) * (halfWidth * 2 - 4);
}

/**
 * The warning band's pixels (RGBA, row 0 at the bottom, like a texture): a dashed gold outline
 * whose dashes sit at `phase` (so swapping two phases makes it crawl) and a sparse dither of dark
 * gold inside. Only whole palette colours and fully clear pixels, so it needs no blending.
 */
export function markerPixels(width: number, height: number, phase: number): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const put = (x: number, y: number, hex: number): void => {
    const i = (y * width + x) * 4;
    data[i] = (hex >> 16) & 255;
    data[i + 1] = (hex >> 8) & 255;
    data[i + 2] = hex & 255;
    data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (edge) {
        // Distance along the outline, clockwise from the bottom-left corner.
        const p = y === 0 ? x : x === width - 1 ? width + y : y === height - 1 ? 2 * width + height - x : 2 * width + 2 * height - y;
        if (Math.floor((p + phase) / 2) % 2 === 0) put(x, y, GOLD);
      } else if ((x + y * 2) % 5 === 0 && y > 1) {
        put(x, y, GOLD_DARK);
      }
    }
  }
  return data;
}

/** The guide's pixels: dotted dark-gold lines down both edges, `GUIDE_PERIOD` rows to a repeat. */
export function guidePixels(width: number): Uint8Array {
  const data = new Uint8Array(width * GUIDE_PERIOD * 4);
  for (let y = 0; y < GUIDE_PERIOD; y++) {
    if (y % 4 > 1) continue;
    for (const x of [0, width - 1]) {
      const i = (y * width + x) * 4;
      data[i] = (GOLD_DARK >> 16) & 255;
      data[i + 1] = (GOLD_DARK >> 8) & 255;
      data[i + 2] = GOLD_DARK & 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** The curtain's pixels: a 4 by 4 dither, dark acid with a few brighter flecks, `phase` (0 or 1) shifting it a pixel. */
export function curtainPixels(phase: number): Uint8Array {
  const data = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const px = (x + phase) % 4;
      // One pixel in four, so the curtain is a light veil and the rain in front of it stays readable.
      const on = px % 2 === 0 && y % 2 === 0;
      if (!on) continue;
      const hex = px === 0 && y === 0 ? ACID_MID : ACID_DARK;
      const i = (y * 4 + x) * 4;
      data[i] = (hex >> 16) & 255;
      data[i + 1] = (hex >> 8) & 255;
      data[i + 2] = hex & 255;
      data[i + 3] = 255;
    }
  }
  return data;
}

function texture(data: Uint8Array, width: number, height: number, repeat: boolean): DataTexture {
  const tex = new DataTexture(data, width, height, RGBAFormat);
  tex.magFilter = tex.minFilter = NearestFilter;
  tex.colorSpace = SRGBColorSpace;
  tex.generateMipmaps = false;
  if (repeat) tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** A flat, unlit, pixel-exact quad: drawn before the models (so they stay in front), clear where the texture is. */
function flatMesh(width: number, height: number, map: Texture | null, color = 0xffffff): Mesh {
  const material = new MeshBasicMaterial({ map, color, alphaTest: 0.5, depthTest: false, depthWrite: false });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.renderOrder = -9;
  mesh.visible = false;
  return mesh;
}

interface Slot {
  /** The column this slot is drawing, or -1 when free. */
  id: number;
  /** Which slot this is, to find its curtain textures. */
  index: number;
  marker: Mesh;
  guide: Mesh;
  curtain: Mesh;
  edgeL: Mesh;
  edgeR: Mesh;
  drops: Model[];
  /** The thin streaks between the drops, as one instanced mesh. */
  streaks: InstancedMesh;
  /** Seconds to the next splash. */
  splash: number;
}

export class AcidView {
  private readonly slots: Slot[] = [];
  private readonly markerMaps: Texture[] = [];
  private readonly guideMap: Texture;
  private readonly curtainMaps: Texture[][] = [];
  private readonly span = [0, 0];
  private readonly dummy = new Object3D();
  private readonly width: number;

  /** `halfWidth` is a column's half width (the sim's ACID_HALF_WIDTH); `makeDrop` makes one acid_drop model. */
  constructor(
    scene: Scene,
    private readonly effects: Effects,
    makeDrop: () => Model,
    halfWidth: number,
  ) {
    this.width = Math.round(halfWidth * 2);
    const w = this.width;
    this.markerMaps = [texture(markerPixels(w, MARKER_HEIGHT, 0), w, MARKER_HEIGHT, false), texture(markerPixels(w, MARKER_HEIGHT, 2), w, MARKER_HEIGHT, false)];
    this.guideMap = texture(guidePixels(w), w, GUIDE_PERIOD, true);
    const edge = new MeshBasicMaterial({ color: ACID, depthTest: false, depthWrite: false });
    const edgeGeo = new BoxGeometry(1, 1, 1);
    const streakMaterial = new MeshBasicMaterial({ color: ACID });
    const guideTop = TOP - MARKER_HEIGHT;
    const guideHeight = Math.round(guideTop - SHIP_Y);
    for (let s = 0; s < MAX_ACID; s++) {
      const marker = flatMesh(w, MARKER_HEIGHT, this.markerMaps[0]);
      marker.position.y = TOP - MARKER_HEIGHT / 2;
      // Each slot's guide and curtain have their own texture objects (they share the pixels) so each can repeat to its own length.
      const guideMap = this.guideMap.clone();
      guideMap.needsUpdate = true;
      guideMap.repeat.set(1, guideHeight / GUIDE_PERIOD);
      const guide = flatMesh(w, guideHeight, guideMap);
      guide.position.y = guideTop - guideHeight / 2;
      const maps = [texture(curtainPixels(0), 4, 4, true), texture(curtainPixels(1), 4, 4, true)];
      this.curtainMaps.push(maps);
      const curtain = flatMesh(w, 1, maps[0]);
      const edgeL = new Mesh(edgeGeo, edge);
      const edgeR = new Mesh(edgeGeo, edge);
      edgeL.renderOrder = edgeR.renderOrder = -8;
      edgeL.visible = edgeR.visible = false;
      const drops: Model[] = [];
      for (let i = 0; i < DROPS_PER_COLUMN; i++) {
        const drop = makeDrop();
        drop.holder.visible = false;
        scene.add(drop.holder);
        drops.push(drop);
      }
      const streaks = new InstancedMesh(edgeGeo, streakMaterial, STREAKS_PER_COLUMN);
      streaks.frustumCulled = false;
      streaks.visible = false;
      scene.add(marker, guide, curtain, edgeL, edgeR, streaks);
      this.slots.push({ id: -1, index: s, marker, guide, curtain, edgeL, edgeR, drops, streaks, splash: 0 });
    }
  }

  private hide(slot: Slot): void {
    slot.id = -1;
    slot.marker.visible = slot.guide.visible = slot.curtain.visible = slot.edgeL.visible = slot.edgeR.visible = slot.streaks.visible = false;
    for (const d of slot.drops) d.holder.visible = false;
  }

  /** The slot drawing column `id`, or a free one to claim; null if both are busy. */
  private slotFor(id: number): Slot | null {
    let free: Slot | null = null;
    for (const slot of this.slots) {
      if (slot.id === id) return slot;
      if (slot.id === -1 && free === null) free = slot;
    }
    if (free) {
      free.id = id;
      free.splash = 0;
    }
    return free;
  }

  /** Brings the drawn columns up to date with the run's. `time` is the view clock, `dt` the frame's seconds. */
  update(columns: readonly AcidColumn[], bunkers: readonly Bunker[], time: number, dt: number): void {
    // Free the slots whose column has gone, then draw each live one.
    for (const slot of this.slots) {
      let live = false;
      for (const c of columns) if (c.id === slot.id) live = true;
      if (!live && slot.id !== -1) this.hide(slot);
    }
    for (const column of columns) {
      const slot = this.slotFor(column.id);
      if (slot) this.draw(slot, column, bunkers, time, dt);
    }
  }

  private draw(slot: Slot, column: AcidColumn, bunkers: readonly Bunker[], time: number, dt: number): void {
    const x = Math.round(column.x);
    if (column.state === 'warn') {
      slot.curtain.visible = slot.edgeL.visible = slot.edgeR.visible = slot.streaks.visible = false;
      for (const d of slot.drops) d.holder.visible = false;
      slot.marker.visible = warnVisible(column.timeLeft);
      slot.guide.visible = true;
      slot.marker.position.x = slot.guide.position.x = x;
      (slot.marker.material as MeshBasicMaterial).map = this.markerMaps[Math.floor(time * 10) % 2];
      // The dots crawl down the guide, toward where the rain will land.
      const map = (slot.guide.material as MeshBasicMaterial).map as Texture;
      map.offset.y = -Math.floor(time * 16) / GUIDE_PERIOD;
      return;
    }

    slot.marker.visible = slot.guide.visible = false;
    const stop = beamStopY(bunkers, column.x, TOP, 'down');
    const floorY = Math.round(stop ?? SHIP_Y);
    const elapsed = ACID_RAIN_SECONDS - column.timeLeft;
    const [top, bottom] = rainSpan(elapsed, column.timeLeft, floorY, this.span);
    const height = Math.max(0, top - bottom);
    const show = height > 0;
    slot.curtain.visible = slot.edgeL.visible = slot.edgeR.visible = show;
    if (show) {
      const maps = this.curtainMaps[slot.index];
      const material = slot.curtain.material as MeshBasicMaterial;
      material.map = maps[Math.floor(time * 18) % 2];
      // One texel to one art pixel: the 4 by 4 dither repeats width/4 by height/4 times.
      maps[0].repeat.set(this.width / 4, height / 4);
      maps[1].repeat.copy(maps[0].repeat);
      slot.curtain.scale.set(1, height, 1);
      slot.curtain.position.set(x, (top + bottom) / 2, 0);
      const half = this.width / 2;
      slot.edgeL.scale.set(1, height, 1);
      slot.edgeR.scale.set(1, height, 1);
      slot.edgeL.position.set(x - half + 0.5, (top + bottom) / 2, 0.1);
      slot.edgeR.position.set(x + half - 0.5, (top + bottom) / 2, 0.1);
    }

    // The drops: a loop the height of the column, so they fall in a steady stream.
    const loop = TOP - floorY;
    for (let i = 0; i < slot.drops.length; i++) {
      const drop = slot.drops[i];
      const y = dropY(i, time + column.id * 0.37, TOP, loop);
      const inside = show && y <= top && y >= bottom + 3;
      drop.holder.visible = inside;
      if (inside) drop.holder.position.set(x + dropOffset(i, this.width / 2), y, 0.4);
    }

    // The streaks: one pixel wide and a few tall, falling at their own speeds, drawn in a single batch.
    slot.streaks.visible = show;
    if (show) {
      for (let i = 0; i < STREAKS_PER_COLUMN; i++) {
        const y = dropY(i + 3, time + column.id * 0.37, TOP, loop);
        const inside = y <= top && y >= bottom + 3;
        const length = 3 + (i % 3) * 2 + 1;
        this.dummy.position.set(x + Math.round(dropOffset(i, this.width / 2, STREAKS_PER_COLUMN)), Math.round(y), 0.2);
        this.dummy.scale.set(1, inside ? length : 0, 1);
        this.dummy.updateMatrix();
        slot.streaks.setMatrixAt(i, this.dummy.matrix);
      }
      slot.streaks.instanceMatrix.needsUpdate = true;
    }

    // Where it lands, a spray of drops (not while it is still filling or draining).
    if (show && bottom <= floorY + 1) {
      slot.splash -= dt;
      if (slot.splash <= 0) {
        slot.splash = SPLASH_SECONDS;
        const jitter = ((Math.floor(time * 60) * 7 + column.id * 3) % 11) - 5;
        this.effects.acidSplash(x + (jitter / 5) * (this.width / 2 - 2), floorY);
      }
    }
  }

  clear(): void {
    for (const slot of this.slots) this.hide(slot);
  }

  /** How many columns are being drawn (for tests). */
  get drawn(): number {
    let n = 0;
    for (const slot of this.slots) if (slot.id !== -1) n++;
    return n;
  }
}
