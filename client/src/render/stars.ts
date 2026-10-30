import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  NearestFilter,
  Points,
  PointsMaterial,
  RGBAFormat,
  Scene,
  SRGBColorSpace,
} from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import { buildNebula } from './nebula';

// The starfield: single-pixel stars in three layers that drift down at different speeds, which
// reads as depth. It has its own flat (untilted) camera and is drawn first, behind everything,
// along with the background colour (a quad, since clearing a render target to a colour comes out
// wrong when the target stores sRGB).

interface Layer {
  count: number;
  /** Art pixels per second. */
  speed: number;
  color: number;
  /** Chance that a star in this layer twinkles white now and then. */
  twinkle: number;
  /** The colour in sector 2's red sky. */
  warm: number;
}

const LAYERS: readonly Layer[] = [
  { count: 44, speed: 5, color: 0x342d66, twinkle: 0, warm: 0x6b2a3a },
  { count: 28, speed: 11, color: 0x5b52a0, twinkle: 0.1, warm: 0xa8503f },
  { count: 14, speed: 22, color: 0x8f86c9, twinkle: 0.3, warm: 0xd9826b },
];

/** The sky colour. Also the first palette colour. */
const SKY = 0x07040f;
/** Sector 2's sky: a touch of red in the black. */
export const SKY_RED = 0x12040a;

export class Starfield {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-FIELD_WIDTH / 2, FIELD_WIDTH / 2, FIELD_HEIGHT / 2, -FIELD_HEIGHT / 2, -10, 10);
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly warmColors: Float32Array;
  private readonly column: Int16Array;
  private readonly startRow: Float32Array;
  private readonly speed: Float32Array;
  private readonly phase: Float32Array;
  private readonly twinkles: Uint8Array;
  private readonly total: number;
  private readonly geometry = new BufferGeometry();
  private readonly white = new Color(0xc1c3eb);
  private readonly skyMaterial: MeshBasicMaterial;
  private readonly skyColor = new Color(SKY);
  private readonly tintColor = new Color();
  private readonly skyRed = new Color(SKY_RED);
  private tintAmount = 0;
  private sectorBlend = 0;
  private readonly nebula: Mesh;
  private readonly skyBase = new Color(SKY);
  private tintSky = new Color(SKY);

  constructor() {
    this.camera.position.z = 5;
    this.skyMaterial = new MeshBasicMaterial({ color: SKY, depthWrite: false });
    const sky = new Mesh(new PlaneGeometry(FIELD_WIDTH, FIELD_HEIGHT), this.skyMaterial);
    sky.position.z = -5;
    this.scene.add(sky);
    // Sector 2's nebula: a pixel-quantised texture over the sky, faded in by `setSector`.
    const texture = new DataTexture(buildNebula(), FIELD_WIDTH, FIELD_HEIGHT, RGBAFormat);
    texture.magFilter = texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.nebula = new Mesh(
      new PlaneGeometry(FIELD_WIDTH, FIELD_HEIGHT),
      new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false }),
    );
    this.nebula.position.z = -4.5;
    this.nebula.visible = false;
    this.scene.add(this.nebula);
    this.total = LAYERS.reduce((n, l) => n + l.count, 0);
    this.positions = new Float32Array(this.total * 3);
    this.colors = new Float32Array(this.total * 3);
    this.baseColors = new Float32Array(this.total * 3);
    this.warmColors = new Float32Array(this.total * 3);
    this.column = new Int16Array(this.total);
    this.startRow = new Float32Array(this.total);
    this.speed = new Float32Array(this.total);
    this.phase = new Float32Array(this.total);
    this.twinkles = new Uint8Array(this.total);

    // A fixed seed, so the sky is the same every run.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = new Color();
    const warm = new Color();
    let i = 0;
    for (const layer of LAYERS) {
      c.setHex(layer.color);
      for (let n = 0; n < layer.count; n++, i++) {
        this.column[i] = Math.floor(rnd() * FIELD_WIDTH);
        this.startRow[i] = rnd() * FIELD_HEIGHT;
        this.speed[i] = layer.speed;
        this.phase[i] = rnd() * 10;
        this.twinkles[i] = rnd() < layer.twinkle ? 1 : 0;
        this.baseColors.set([c.r, c.g, c.b], i * 3);
        this.colors.set([c.r, c.g, c.b], i * 3);
        this.warmColors.set(warm.setHex(layer.warm).toArray(), i * 3);
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const points = new Points(this.geometry, new PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true }));
    points.frustumCulled = false;
    this.scene.add(points);
    this.update(0);
  }

  /**
   * Washes the sky toward `sky` and the stars toward `stars`: 0 leaves them as they are, 1 is
   * fully tinted. The slow field and Time Stop use it for a subtle screen tint behind everything.
   * The palette pass snaps the sky to a palette colour, so pick `sky` from the palette (and a
   * dark one: a bright sky would flood the screen).
   */
  setTint(sky: number, stars: number, amount: number): void {
    this.tintColor.setHex(stars);
    this.tintAmount = Math.min(1, Math.max(0, amount));
    this.tintSky.setHex(sky);
    this.applySky();
  }

  private applySky(): void {
    this.skyMaterial.color.copy(this.skyBase).lerp(this.tintSky, this.tintAmount);
  }

  /**
   * Blends the whole sky between sector 1 (0) and sector 2 (1): the sky takes on a red cast, the
   * nebula fades in and the stars turn warm.
   */
  setSector(blend: number): void {
    this.sectorBlend = Math.min(1, Math.max(0, blend));
    this.skyBase.copy(this.skyColor).lerp(this.skyRed, this.sectorBlend);
    this.applySky();
    const material = this.nebula.material as MeshBasicMaterial;
    material.opacity = this.sectorBlend;
    this.nebula.visible = this.sectorBlend > 0.01;
  }

  /** Moves the stars to where they are `time` seconds into the run. */
  update(time: number): void {
    const pos = this.positions;
    const col = this.colors;
    const tint = this.tintAmount * 0.7;
    for (let i = 0; i < this.total; i++) {
      // Whole pixels only, centred on the pixel, so each star fills exactly one.
      const row = Math.floor((this.startRow[i] + time * this.speed[i]) % FIELD_HEIGHT);
      pos[i * 3] = this.column[i] - FIELD_WIDTH / 2 + 0.5;
      pos[i * 3 + 1] = FIELD_HEIGHT / 2 - row - 0.5;
      const on = this.twinkles[i] === 1 && Math.sin(time * 4 + this.phase[i]) > 0.92;
      const k = this.sectorBlend;
      const r = on ? this.white.r : this.baseColors[i * 3] + (this.warmColors[i * 3] - this.baseColors[i * 3]) * k;
      const g = on ? this.white.g : this.baseColors[i * 3 + 1] + (this.warmColors[i * 3 + 1] - this.baseColors[i * 3 + 1]) * k;
      const b = on ? this.white.b : this.baseColors[i * 3 + 2] + (this.warmColors[i * 3 + 2] - this.baseColors[i * 3 + 2]) * k;
      col[i * 3] = r + (this.tintColor.r - r) * tint;
      col[i * 3 + 1] = g + (this.tintColor.g - g) * tint;
      col[i * 3 + 2] = b + (this.tintColor.b - b) * tint;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
