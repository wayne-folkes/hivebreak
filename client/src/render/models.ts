import {
  BackSide,
  Box3,
  BufferGeometry,
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
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Loads the Blender models and gives them the pixel look: toon (stepped) shading, an unlit
// look for the glowing parts, and a dark outline built as an inverted hull (a slightly fattened
// copy of each part, drawn back faces only, so it peeks out around the edge).

export type ModelName = 'player' | 'drone' | 'warden' | 'diver' | 'shot_player' | 'shot_alien';

const FILES: Record<string, readonly ModelName[]> = {
  player: ['player'],
  drone: ['drone'],
  warden: ['warden'],
  diver: ['diver'],
  shots: ['shot_player', 'shot_alien'],
};

/** Outline thickness in art pixels (world units). */
const OUTLINE_THICKNESS = 0.8;
const OUTLINE_COLOR = 0x07040f;
/** The three light levels of the toon ramp, dark to bright. */
const TOON_STEPS = [74, 158, 255];

const outlineMaterial = new MeshBasicMaterial({ color: OUTLINE_COLOR, side: BackSide });
const flashMaterial = new MeshBasicMaterial({ color: 0xffffff });

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
  private readonly materials: Material[] = [];
  private flashing = false;

  constructor(template: Object3D) {
    this.body = template.clone(true);
    this.holder.add(this.body);
    this.body.traverse((o) => {
      if (o.name && o !== this.body && o.name !== 'outline') this.parts[o.name] = o;
      const mesh = o as Mesh;
      if (mesh.isMesh && o.name !== 'outline') {
        this.meshes.push(mesh);
        this.materials.push(mesh.material as Material);
      }
    });
  }

  /** Draws the model all white (the hit flash) or back to its own colours. */
  setFlash(on: boolean): void {
    if (on === this.flashing) return;
    this.flashing = on;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].material = on ? flashMaterial : this.materials[i];
  }
}

export class ModelKit {
  private readonly templates = new Map<ModelName, Object3D>();
  /** Y of the ship's hull centre (flames left out) in the model's own space. */
  hullCentreY = 0;

  async load(baseUrl: string): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all(
      Object.entries(FILES).map(async ([file, names]) => {
        const gltf = await loader.loadAsync(`${baseUrl}models/${file}.glb`);
        for (const name of names) {
          const node = gltf.scene.getObjectByName(name);
          if (!node) throw new Error(`models/${file}.glb has no "${name}" node`);
          node.removeFromParent();
          if (name === 'player') this.hullCentreY = hullCentre(node);
          stylize(node);
          this.templates.set(name, node);
        }
      }),
    );
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
