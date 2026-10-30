import {
  BackSide,
  Box3,
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
  Vector3,
} from 'three';
import type { Material, MeshStandardMaterial, Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ShipId } from '../game/types';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Loads the Blender models and gives them the pixel look: toon (stepped) shading, an unlit
// look for the glowing parts, and a dark outline built as an inverted hull (a slightly fattened
// copy of each part, drawn back faces only, so it peeks out around the edge).

export type ModelName =
  | 'player'
  | 'interceptor'
  | 'lancer'
  | 'bastion'
  | 'missile'
  | 'well'
  | 'drone'
  | 'warden'
  | 'diver'
  | 'carrier'
  | 'splitter'
  | 'mini'
  | 'brood_mother'
  | 'hive_mind'
  | 'helper'
  | 'pickup_spread'
  | 'pickup_laser'
  | 'pickup_slow'
  | 'pickup_helper'
  | 'shot_player'
  | 'shot_alien';

const FILES: Record<string, readonly ModelName[]> = {
  player: ['player'],
  interceptor: ['interceptor'],
  lancer: ['lancer'],
  bastion: ['bastion'],
  missile: ['missile'],
  well: ['well'],
  drone: ['drone'],
  warden: ['warden'],
  diver: ['diver'],
  carrier: ['carrier'],
  splitter: ['splitter'],
  mini: ['mini'],
  brood_mother: ['brood_mother'],
  hive_mind: ['hive_mind'],
  helper: ['helper'],
  pickups: ['pickup_spread', 'pickup_laser', 'pickup_slow', 'pickup_helper'],
  shots: ['shot_player', 'shot_alien'],
};

/** The model each ship is drawn with (the Breaker's is `player.glb`). */
export function shipModelName(ship: ShipId): ModelName {
  return ship === 'breaker' ? 'player' : ship;
}

/** The models that are ships, whose hull centre (flames left out) the kit measures. */
const SHIP_MODELS: readonly ModelName[] = ['player', 'interceptor', 'lancer', 'bastion'];

/** How a model is coloured: its own colours, a cool blue-shift (the slow field), or washed out and icy (Time Stop). */
export const LOOK_NORMAL = 0;
export const LOOK_SLOW = 1;
export const LOOK_FROZEN = 2;
export type Look = typeof LOOK_NORMAL | typeof LOOK_SLOW | typeof LOOK_FROZEN;

/** Outline thickness in art pixels (world units). */
const OUTLINE_THICKNESS = 0.8;
const OUTLINE_COLOR = 0x07040f;
/** The three light levels of the toon ramp, dark to bright. */
const TOON_STEPS = [74, 158, 255];

const outlineMaterial = new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide });
const flashMaterial = new MeshBasicMaterial({ color: 0xffffff });
/** What a destroyed boss part is drawn as: a dark, dead hulk. */
const wreckMaterial = new MeshBasicMaterial({ color: 0x1b1530 });

const COOL = new Color(0x4f8bff);
const ICE = new Color(0x8fb4ff);

/** A material's three looks (normal, slow, frozen), found by the material the Blender file gave a mesh. */
const looksOf = new WeakMap<Material, readonly Material[]>();

/** The slow field's cool look of a colour: pulled toward blue and a little darker. */
export function coolColor(source: Color, out: Color): Color {
  return out.copy(source).lerp(COOL, 0.45).multiplyScalar(0.92);
}

/** Time Stop's look of a colour: most of the colour drained out and an icy blue-grey left. */
export function frozenColor(source: Color, out: Color): Color {
  const grey = source.r * 0.2126 + source.g * 0.7152 + source.b * 0.0722;
  return out.setRGB(grey, grey, grey).lerp(ICE, 0.35).multiplyScalar(0.9);
}

function toonGradient(): DataTexture {
  const tex = new DataTexture(new Uint8Array(TOON_STEPS), TOON_STEPS.length, 1, RedFormat);
  tex.minFilter = tex.magFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
const gradientMap = toonGradient();

/**
 * A fattened copy of a mesh's geometry. The models are flat-shaded (every face has its own
 * vertices), so pushing vertices along their own normals would tear the shell apart; the
 * vertices are welded first and given smooth normals, then pushed out.
 */
function outlineGeometry(source: BufferGeometry): BufferGeometry {
  const bare = new BufferGeometry();
  bare.setAttribute('position', source.getAttribute('position').clone());
  if (source.index) bare.setIndex(source.index.clone());
  const welded = mergeVertices(bare, 1e-3);
  welded.computeVertexNormals();
  const pos = welded.getAttribute('position');
  const nor = welded.getAttribute('normal');
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    out[i * 3] = pos.getX(i) + nor.getX(i) * OUTLINE_THICKNESS;
    out[i * 3 + 1] = pos.getY(i) + nor.getY(i) * OUTLINE_THICKNESS;
    out[i * 3 + 2] = pos.getZ(i) + nor.getZ(i) * OUTLINE_THICKNESS;
  }
  welded.setAttribute('position', new Float32BufferAttribute(out, 3));
  return welded;
}

/** Swaps a model's Blender materials for toon / unlit ones by role and adds outlines. */
function stylize(root: Object3D): void {
  const meshes: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) meshes.push(o as Mesh);
  });
  const swapped = new Map<Material, Material>();
  for (const mesh of meshes) {
    const source = mesh.material as MeshStandardMaterial;
    const glows = source.name.startsWith('glow');
    let material = swapped.get(source);
    if (!material) {
      material = glows
        ? new MeshBasicMaterial({ color: source.color.clone() })
        : new MeshToonMaterial({ color: source.color.clone(), gradientMap });
      swapped.set(source, material);
    }
    mesh.material = material;
    if (!looksOf.has(material)) {
      const make = (colour: Color): Material =>
        glows ? new MeshBasicMaterial({ color: colour }) : new MeshToonMaterial({ color: colour, gradientMap });
      looksOf.set(material, [
        material,
        make(coolColor(source.color, new Color())),
        make(frozenColor(source.color, new Color())),
      ]);
    }
    if (!glows) {
      const outline = new Mesh(outlineGeometry(mesh.geometry), outlineMaterial);
      outline.name = 'outline';
      mesh.add(outline);
    }
  }
}

/** One placed copy of a model. `holder` is what the view positions; `body` is what animations rotate. */
export class Model {
  readonly holder = new Group();
  readonly body: Object3D;
  /** Named parts of the model (`leg_0`, `wing_L`, ...), pivoting about their own origin. */
  readonly parts: Record<string, Object3D> = {};
  private readonly meshes: Mesh[] = [];
  private readonly looks: (readonly Material[])[] = [];
  private readonly flashed: boolean[] = [];
  private readonly wrecked: boolean[] = [];
  private readonly partMeshes = new Map<string, number[]>();
  private look: Look = LOOK_NORMAL;

  constructor(template: Object3D) {
    this.body = template.clone(true);
    this.holder.add(this.body);
    const index = new Map<Object3D, number>();
    this.body.traverse((o) => {
      if (o.name && o !== this.body && o.name !== 'outline') this.parts[o.name] = o;
      const mesh = o as Mesh;
      if (mesh.isMesh && o.name !== 'outline') {
        index.set(o, this.meshes.length);
        this.meshes.push(mesh);
        this.looks.push(looksOf.get(mesh.material as Material) ?? [mesh.material as Material]);
        this.flashed.push(false);
        this.wrecked.push(false);
      }
    });
    for (const name of Object.keys(this.parts)) {
      const ids: number[] = [];
      this.parts[name].traverse((o) => {
        const i = index.get(o);
        if (i !== undefined) ids.push(i);
      });
      if (ids.length > 0) this.partMeshes.set(name, ids);
    }
  }

  private apply(i: number): void {
    const looks = this.looks[i];
    this.meshes[i].material = this.flashed[i] ? flashMaterial : this.wrecked[i] ? wreckMaterial : (looks[this.look] ?? looks[0]);
  }

  private applyAll(): void {
    for (let i = 0; i < this.meshes.length; i++) this.apply(i);
  }

  /** Draws the model all white (the hit flash) or back to its own colours. */
  setFlash(on: boolean): void {
    for (let i = 0; i < this.meshes.length; i++) {
      if (this.flashed[i] === on) continue;
      this.flashed[i] = on;
      this.apply(i);
    }
  }

  /** Flashes one named part (and anything under it) white, leaving the rest alone. */
  setPartFlash(name: string, on: boolean): void {
    const ids = this.partMeshes.get(name);
    if (!ids) return;
    for (const i of ids) {
      if (this.flashed[i] === on) continue;
      this.flashed[i] = on;
      this.apply(i);
    }
  }

  /** Draws one named part as a dark wreck (a destroyed boss part), or back to normal. */
  setPartWreck(name: string, on: boolean): void {
    const ids = this.partMeshes.get(name);
    if (!ids) return;
    for (const i of ids) {
      if (this.wrecked[i] === on) continue;
      this.wrecked[i] = on;
      this.apply(i);
    }
  }

  /** Recolours the whole model: its own colours, the slow field's cool blue, or Time Stop's icy grey. */
  setLook(look: Look): void {
    if (look === this.look) return;
    this.look = look;
    this.applyAll();
  }
}

export class ModelKit {
  private readonly templates = new Map<ModelName, Object3D>();
  /** Y of the Breaker's hull centre (flames left out) in the model's own space. */
  hullCentreY = 0;
  private readonly hullCentres = new Map<ModelName, number>();

  async load(baseUrl: string): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(
      Object.entries(FILES).map(async ([file, names]) => {
        const gltf = await loader.loadAsync(`${baseUrl}models/${file}.glb`);
        for (const name of names) {
          const node = gltf.scene.getObjectByName(name);
          if (!node) throw new Error(`models/${file}.glb has no "${name}" node`);
          node.removeFromParent();
          if (SHIP_MODELS.includes(name)) {
            const centre = hullCentre(node);
            this.hullCentres.set(name, centre);
            if (name === 'player') this.hullCentreY = centre;
          }
          stylize(node);
          this.templates.set(name, node);
        }
      }),
    );
  }

  /** Y of a ship model's hull centre (flames left out) in its own space; 0 for models that are not ships. */
  hullCentreOf(name: ModelName): number {
    return this.hullCentres.get(name) ?? 0;
  }

  create(name: ModelName): Model {
    const template = this.templates.get(name);
    if (!template) throw new Error(`Model "${name}" is not loaded`);
    return new Model(template);
  }
}

/** Centre in y of the ship without its engine flames, which the exported bounding box includes. */
function hullCentre(player: Object3D): number {
  player.updateMatrixWorld(true);
  const box = new Box3();
  for (const child of player.children) if (!child.name.startsWith('flame')) box.expandByObject(child);
  return box.getCenter(new Vector3()).y;
}
