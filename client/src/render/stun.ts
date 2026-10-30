import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';
import type { Scene } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Stun markers: little four-point stars that wobble in small ellipses over a stunned alien or
// the boss, the classic "seeing stars". Pooled; each frame the view asks for as many as it
// needs and the rest are hidden.

const MAX_STARS = 72;
const YELLOW = 0xffe164;
const WHITE = 0xffffff;

export class StunMarkers {
  private readonly stars: Mesh[] = [];
  private cursor = 0;
  private shown = 0;

  constructor(scene: Scene) {
    const bar = new BoxGeometry(3, 1, 1);
    const cross = mergeGeometries([bar, bar.clone().rotateZ(Math.PI / 2)]);
    const yellow = new MeshBasicMaterial({ color: YELLOW });
    const white = new MeshBasicMaterial({ color: WHITE });
    for (let i = 0; i < MAX_STARS; i++) {
      const m = new Mesh(cross, i % 3 === 0 ? white : yellow);
      m.position.z = 12;
      m.visible = false;
      this.stars.push(m);
      scene.add(m);
    }
  }

  /** Call before this frame's markers. */
  begin(): void {
    this.cursor = 0;
  }

  /**
   * Puts `count` stars circling around (x, y), wobbling in an ellipse `radius` wide. `phase`
   * staggers different aliens so they don't all move as one.
   */
  add(x: number, y: number, radius: number, count: number, time: number, phase: number): void {
    for (let n = 0; n < count && this.cursor < MAX_STARS; n++) {
      const a = time * 5 + phase + (n * Math.PI * 2) / count;
      const m = this.stars[this.cursor++];
      m.visible = true;
      m.position.x = x + Math.cos(a) * radius;
      m.position.y = y + Math.sin(a) * radius * 0.35;
      // Stars on the far side of the loop are drawn smaller, a cheap bit of depth.
      m.scale.setScalar(0.75 + 0.35 * Math.sin(a));
      m.rotation.z = time * 6 + n;
    }
  }

  /** Call after this frame's markers: hides the unused stars. */
  end(): void {
    for (let i = this.cursor; i < this.shown; i++) this.stars[i].visible = false;
    this.shown = this.cursor;
  }

  clear(): void {
    this.cursor = 0;
    this.shown = MAX_STARS;
    this.end();
  }
}
