import {
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Color,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three';
import type { WebGLRenderer } from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import { PALETTE, PALETTE_WEIGHT } from './palette';

// The palette pass: the scene is drawn to a render target at the art resolution, then a
// fullscreen quad snaps every pixel to the nearest palette colour, after adding a small
// glow around the brightest pixels (shots, engines, cores, explosions), so the halo is made of
// palette colours too.

/** How strongly bright pixels glow into their neighbours. 0 turns the glow off. */
export const GLOW_STRENGTH = 0.45;

const FRAGMENT = /* glsl */ `
uniform sampler2D tScene;
uniform vec3 uPalLinear[${PALETTE.length}];
uniform vec3 uPalSrgb[${PALETTE.length}];
uniform vec2 uTexel;
uniform float uGlow;
varying vec2 vUv;

const vec3 W = vec3(${PALETTE_WEIGHT.join(', ')});

// Cheap glow: bright texels one and two pixels away, in eight directions.
vec3 glowAt(vec2 uv) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982;
    vec2 dir = vec2(cos(a), sin(a));
    for (int r = 1; r <= 2; r++) {
      vec3 c = texture2D(tScene, uv + dir * float(r) * uTexel).rgb;
      float peak = max(c.r, max(c.g, c.b));
      sum += c * smoothstep(0.55, 0.95, peak) / float(r);
    }
  }
  return sum / 12.0;
}

void main() {
  vec3 lin = texture2D(tScene, vUv).rgb + glowAt(vUv) * uGlow;
  vec3 c = clamp(lin, 0.0, 1.0);
  vec3 srgb = mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  float best = 1e9;
  vec3 picked = uPalLinear[0];
  for (int i = 0; i < ${PALETTE.length}; i++) {
    vec3 d = srgb - uPalSrgb[i];
    float dist = dot(d * d, W);
    if (dist < best) {
      best = dist;
      picked = uPalLinear[i];
    }
  }
  gl_FragColor = vec4(picked, 1.0);
  #include <colorspace_fragment>
}
`;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export class PalettePass {
  readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: ShaderMaterial;

  constructor() {
    // Stored sRGB-encoded, so the 8-bit target keeps its precision in the dark colours.
    this.target = new WebGLRenderTarget(FIELD_WIDTH, FIELD_HEIGHT, {
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: true,
    });
    this.target.texture.colorSpace = SRGBColorSpace;

    const linear: Vector3[] = [];
    const srgb: Vector3[] = [];
    const c = new Color();
    for (const hex of PALETTE) {
      c.setHex(hex);
      linear.push(new Vector3(c.r, c.g, c.b));
      srgb.push(new Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255));
    }
    this.material = new ShaderMaterial({
      uniforms: {
        tScene: { value: this.target.texture },
        uPalLinear: { value: linear },
        uPalSrgb: { value: srgb },
        uTexel: { value: new Vector2(1 / FIELD_WIDTH, 1 / FIELD_HEIGHT) },
        uGlow: { value: GLOW_STRENGTH },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
  }

  /** Draws the target to the canvas through the palette. */
  present(renderer: WebGLRenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
