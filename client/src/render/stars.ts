import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
} from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';

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
}

const LAYERS: readonly Layer[] = [
  { count: 44, speed: 5, color: 0x342d66, twinkle: 0 },
  { count: 28, speed: 11, color: 0x5b52a0, twinkle: 0.1 },
  { count: 14, speed: 22, color: 0x8f86c9, twinkle: 0.3 },
];

/** The sky colour. Also the first palette colour. */
const SKY = 0x07040f;

export class Starfield {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-FIELD_WIDTH / 2, FIELD_WIDTH / 2, FIELD_HEIGHT / 2, -FIELD_HEIGHT / 2, -10, 10);
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly column: Int16Array;
  private readonly startRow: Float32Array;
  private readonly speed: Float32Array;
  private readonly phase: Float32Array;
  private readonly twinkles: Uint8Array;
  private readonly total: number;
  private readonly geometry = new BufferGeometry();
  private readonly white = new Color(0xc1c3eb);

  constructor() {
    this.camera.position.z = 5;
    const sky = new Mesh(new PlaneGeometry(FIELD_WIDTH, FIELD_HEIGHT), new MeshBasicMaterial({ color: SKY, depthWrite: false }));
    sky.position.z = -5;
    this.scene.add(sky);
    this.total = LAYERS.reduce((n, l) => n + l.count, 0);
    this.positions = new Float32Array(this.total * 3);
    this.colors = new Float32Array(this.total * 3);
    this.baseColors = new Float32Array(this.total * 3);
    this.column = new Int16Array(this.total);
    this.startRow = new Float32Array(this.total);
    this.speed = new Float32Array(this.total);
    this.phase = new Float32Array(this.total);
    this.twinkles = new Uint8Array(this.total);

    // A fixed seed, so the sky is the same every run.
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const c = new Color();
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
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    const points = new Points(this.geometry, new PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true }));
    points.frustumCulled = false;
    this.scene.add(points);
    this.update(0);
  }

  /** Moves the stars to where they are `time` seconds into the run. */
  update(time: number): void {
    const pos = this.positions;
    const col = this.colors;
    for (let i = 0; i < this.total; i++) {
      // Whole pixels only, centred on the pixel, so each star fills exactly one.
      const row = Math.floor((this.startRow[i] + time * this.speed[i]) % FIELD_HEIGHT);
      pos[i * 3] = this.column[i] - FIELD_WIDTH / 2 + 0.5;
      pos[i * 3 + 1] = FIELD_HEIGHT / 2 - row - 0.5;
      const on = this.twinkles[i] === 1 && Math.sin(time * 4 + this.phase[i]) > 0.92;
      col[i * 3] = on ? this.white.r : this.baseColors[i * 3];
      col[i * 3 + 1] = on ? this.white.g : this.baseColors[i * 3 + 1];
      col[i * 3 + 2] = on ? this.white.b : this.baseColors[i * 3 + 2];
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }
}
