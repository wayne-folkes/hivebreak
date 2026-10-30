import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, ShaderMaterial } from 'three';
import type { Scene } from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import type { Effects } from './effects';

// The Hive Mind's beams. A warning beam is a dashed red line from the core along the beam's
// angle across the whole field, blinking faster as it nears firing. A firing beam is a thick
// red-and-white bar that stops at where it meets a bunker (the sim says where), with a flare
// and sparks there. Pooled: one set of meshes per beam that can be out at once.

const MAX_BEAMS = 4;
/** Art pixels per dash cycle of the warning line, and how much of each is lit. */
export const DASH_PERIOD = 8;
export const DASH_LIT = 4;
const SPARK_INTERVAL = 0.05;

export const WARN_COLOR = 0xff5a5a;
const AURA = 0xc0392b;
const MID = 0xff5a5a;
const CORE = 0xffffff;
const FIRE_SPARKS: readonly number[] = [0xffffff, 0xff8a45, 0xff5a5a];

/** How far a ray from (x, y) at `angle` runs before it leaves the field (plus a margin), art pixels. */
export function rayToFieldEdge(x: number, y: number, angle: number, margin = 6): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const halfW = FIELD_WIDTH / 2 + margin;
  const halfH = FIELD_HEIGHT / 2 + margin;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (halfW - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, (-halfW - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (halfH - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, (-halfH - y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/** How fast a warning beam blinks, in blinks per second: slow at first, frantic just before it fires. */
export function warnBlinkHz(timeLeft: number, warnSeconds = 1.2): number {
  const u = Math.min(1, Math.max(0, 1 - timeLeft / warnSeconds));
  return 3 + 15 * u * u;
}

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uLength;
uniform float uOn;
varying vec2 vUv;
void main() {
  float d = vUv.x * uLength;
  if (uOn < 0.5 || mod(d, ${DASH_PERIOD.toFixed(1)}) > ${DASH_LIT.toFixed(1)}) discard;
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}
`;

interface BeamMeshes {
  group: Group;
  warn: Mesh;
  aura: Mesh;
  mid: Mesh;
  core: Mesh;
  flareH: Mesh;
  flareV: Mesh;
}

export class BossBeamView {
  private readonly pool: BeamMeshes[] = [];
  private readonly phase = new Float32Array(MAX_BEAMS);
  private readonly sparkTimer = new Float32Array(MAX_BEAMS);
  private shown = 0;

  constructor(
    scene: Scene,
    private readonly effects: Effects,
  ) {
    const unit = new BoxGeometry(1, 1, 1);
    const plane = new PlaneGeometry(1, 1);
    const box = (color: number, z: number): Mesh => {
      const m = new Mesh(unit, new MeshBasicMaterial({ color }));
      m.position.z = z;
      return m;
    };
    for (let i = 0; i < MAX_BEAMS; i++) {
      const warn = new Mesh(
        plane,
        new ShaderMaterial({
          uniforms: { uColor: { value: new Color(WARN_COLOR) }, uLength: { value: 1 }, uOn: { value: 1 } },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
        }),
      );
      warn.position.z = 0.05;
      const group = new Group();
      const beam: BeamMeshes = {
        group,
        warn,
        aura: box(AURA, 0),
        mid: box(MID, 0.1),
        core: box(CORE, 0.2),
        flareH: box(CORE, 0.3),
        flareV: box(CORE, 0.3),
      };
      group.add(warn, beam.aura, beam.mid, beam.core, beam.flareH, beam.flareV);
      group.visible = false;
      this.pool.push(beam);
      scene.add(group);
    }
  }

  begin(): void {
    this.shown = 0;
  }

  private place(m: Mesh, x: number, y: number, angle: number, from: number, length: number, width: number): void {
    const mid = from + length / 2;
    m.position.x = x + Math.cos(angle) * mid;
    m.position.y = y + Math.sin(angle) * mid;
    m.rotation.z = angle;
    m.scale.set(length, width, 1);
  }

  /** A telegraphed beam: dashes along the line from the core (x, y) across the field. */
  warn(x: number, y: number, angle: number, timeLeft: number, dt: number): void {
    if (this.shown >= MAX_BEAMS) return;
    const i = this.shown++;
    const b = this.pool[i];
    this.phase[i] += warnBlinkHz(timeLeft) * dt;
    const length = rayToFieldEdge(x, y, angle);
    b.group.visible = true;
    b.aura.visible = b.mid.visible = b.core.visible = b.flareH.visible = b.flareV.visible = false;
    b.warn.visible = true;
    this.place(b.warn, x, y, angle, 0, length, 2);
    const u = (b.warn.material as ShaderMaterial).uniforms;
    u.uLength.value = length;
    u.uOn.value = this.phase[i] % 1 < 0.6 ? 1 : 0;
  }

  /** A firing beam from the core (x, y), `length` long (the sim's first contact, or the field's edge); `lands` says it stopped on something. */
  fire(x: number, y: number, angle: number, length: number, lands: boolean, time: number, dt: number): void {
    if (this.shown >= MAX_BEAMS) return;
    const i = this.shown++;
    const b = this.pool[i];
    b.group.visible = true;
    b.warn.visible = false;
    b.aura.visible = b.mid.visible = b.core.visible = true;
    const tick = Math.floor(time * 30 + i * 7);
    const flick = (Math.sin(tick * 12.9898) * 43758.5453) % 1;
    const f = flick < 0 ? flick + 1 : flick;
    this.place(b.aura, x, y, angle, 0, length, 9);
    this.place(b.mid, x, y, angle, 0, length, f > 0.5 ? 6 : 5);
    this.place(b.core, x, y, angle, 0, length, f > 0.8 ? 2 : 3);
    b.flareH.visible = b.flareV.visible = lands;
    if (!lands) {
      this.sparkTimer[i] = 0;
      return;
    }
    const ex = x + Math.cos(angle) * length;
    const ey = y + Math.sin(angle) * length;
    const size = 6 + (Math.floor(time * 24) % 2) * 2;
    b.flareH.position.set(ex, ey, 0.3);
    b.flareH.rotation.z = 0;
    b.flareH.scale.set(size + 4, 2, 1);
    b.flareV.position.set(ex, ey, 0.3);
    b.flareV.rotation.z = 0;
    b.flareV.scale.set(2, size, 1);
    this.sparkTimer[i] -= dt;
    if (this.sparkTimer[i] <= 0) {
      this.sparkTimer[i] = SPARK_INTERVAL;
      this.effects.sparksIn(ex, ey, FIRE_SPARKS, 4, 70);
    }
  }

  end(): void {
    for (let i = this.shown; i < MAX_BEAMS; i++) {
      this.pool[i].group.visible = false;
      this.phase[i] = 0;
      this.sparkTimer[i] = 0;
    }
  }

  clear(): void {
    this.shown = 0;
    this.end();
  }
}
