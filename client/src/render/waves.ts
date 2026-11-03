import { Color, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import type { Object3D } from 'three';

// Expanding rings with a constant thickness, for the Pulse Bomb and bomb-on-kill blasts. A
// scaled RingGeometry gets fatter as it grows, which is wrong for a wave crossing the whole
// field, so each wave is a big flat quad whose fragment shader draws the ring: a hard-edged
// band (no blending between pixels, to suit the art) with a dithered trail just behind it.
// The quads are pooled and only shown while a wave runs.

/** Half the quad's side, in art pixels: the biggest radius a wave can reach. */
export const WAVE_HALF_SIZE = 400;
const MAX_WAVES = 6;

const VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy * ${(WAVE_HALF_SIZE * 2).toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uRadius;
uniform float uThick;
uniform float uAlpha;
uniform float uGapAngle;
uniform float uGapHalf;
varying vec2 vP;
void main() {
  float d = length(vP);
  float band = step(uRadius - uThick, d) * step(d, uRadius);
  vec3 color = uColor;
  if (uGapHalf > 0.0) {
    // A notch: within the gap's angle the band is white and stands out past the ring.
    float da = abs(mod(atan(vP.y, vP.x) - uGapAngle + 3.14159265, 6.2831853) - 3.14159265);
    if (da < uGapHalf) {
      band = step(uRadius - uThick * 0.5, d) * step(d, uRadius + uThick * 1.6);
      color = vec3(1.0);
    }
  }
  // A checkerboard trail behind the band, three times as thick.
  float trail = step(uRadius - uThick * 4.0, d) * step(d, uRadius - uThick);
  float check = mod(floor(vP.x) + floor(vP.y), 2.0);
  float a = max(band, trail * (1.0 - check) * 0.9) * uAlpha;
  if (a < 0.5) discard;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}
`;

/** Where a wave's radius is `u` (0 to 1) of the way through: fast at first, easing off. */
export function waveRadius(from: number, to: number, u: number): number {
  const k = 1 - (1 - Math.min(1, Math.max(0, u))) ** 2;
  return from + (to - from) * k;
}

/** How solid a wave still is at `u`: fully for the first 60%, then it blinks out of existence. */
export function waveAlpha(u: number): number {
  return u < 0.6 ? 1 : Math.max(0, 1 - (u - 0.6) / 0.4);
}

export class WavePool {
  private readonly meshes: Mesh[] = [];
  private readonly age = new Float32Array(MAX_WAVES);
  private readonly life = new Float32Array(MAX_WAVES).fill(1);
  private readonly from = new Float32Array(MAX_WAVES);
  private readonly to = new Float32Array(MAX_WAVES);
  private cursor = 0;

  constructor(parent: Object3D) {
    const geometry = new PlaneGeometry(1, 1);
    for (let i = 0; i < MAX_WAVES; i++) {
      const material = new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(0xffffff) },
          uRadius: { value: 0 },
          uThick: { value: 2 },
          uAlpha: { value: 1 },
          uGapAngle: { value: 0 },
          uGapHalf: { value: 0 },
        },
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new Mesh(geometry, material);
      mesh.scale.set(WAVE_HALF_SIZE * 2, WAVE_HALF_SIZE * 2, 1);
      mesh.position.z = 5;
      mesh.frustumCulled = false;
      mesh.renderOrder = 50;
      mesh.visible = false;
      this.meshes.push(mesh);
      parent.add(mesh);
    }
  }

  /**
   * Starts a ring at (x, y) that grows from `from` to `to` art pixels in `seconds`. With a
   * `gapHalf` (radians), the ring has a bright white notch of that half-width at `gapAngle`.
   */
  start(x: number, y: number, from: number, to: number, seconds: number, thick: number, color: number, gapAngle = 0, gapHalf = 0): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_WAVES;
    const mesh = this.meshes[i];
    const u = (mesh.material as ShaderMaterial).uniforms;
    (u.uColor.value as Color).setHex(color);
    u.uThick.value = thick;
    u.uRadius.value = from;
    u.uAlpha.value = 1;
    u.uGapAngle.value = gapAngle;
    u.uGapHalf.value = gapHalf;
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.visible = true;
    this.age[i] = 0;
    this.life[i] = Math.max(seconds, 1e-3);
    this.from[i] = from;
    this.to[i] = to;
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_WAVES; i++) {
      const mesh = this.meshes[i];
      if (!mesh.visible) continue;
      this.age[i] += dt;
      const u = this.age[i] / this.life[i];
      if (u >= 1) {
        mesh.visible = false;
        continue;
      }
      const uniforms = (mesh.material as ShaderMaterial).uniforms;
      uniforms.uRadius.value = waveRadius(this.from[i], this.to[i], u);
      uniforms.uAlpha.value = waveAlpha(u);
    }
  }

  clear(): void {
    for (const m of this.meshes) m.visible = false;
  }
}
