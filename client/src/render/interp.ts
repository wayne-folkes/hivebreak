// Renders run between simulation steps, so each entity's position is remembered for the last
// two steps and blended by how far the frame is into the next one. Entities are matched across
// steps by id: a new id appears where it is (no blending), and one that's gone disappears.

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wraps an angle in radians to [-PI, PI). */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = (a + Math.PI) % twoPi;
  if (r < 0) r += twoPi;
  return r - Math.PI;
}

/** Moves `current` towards `target` by the shortest way, closing `rate` per second (exponential). */
export function approachAngle(current: number, target: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return current + wrapAngle(target - current) * k;
}

interface Track {
  prevX: number;
  prevY: number;
  currX: number;
  currY: number;
  stamp: number;
}

/** A blended position, and how far the entity moved in the last step (for facing). */
export interface Sample {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export class Tracker {
  private readonly tracks = new Map<number, Track>();
  private stamp = 0;
  private readonly sweepOne = (track: Track, id: number): void => {
    if (track.stamp !== this.stamp) this.tracks.delete(id);
  };

  /** Starts recording one simulation step. */
  begin(): void {
    this.stamp++;
  }

  /** Records where entity `id` is after this step: prev <- curr <- now. */
  push(id: number, x: number, y: number): void {
    const t = this.tracks.get(id);
    if (!t) {
      this.tracks.set(id, { prevX: x, prevY: y, currX: x, currY: y, stamp: this.stamp });
      return;
    }
    t.prevX = t.currX;
    t.prevY = t.currY;
    t.currX = x;
    t.currY = y;
    t.stamp = this.stamp;
  }

  /** Ends the step: forgets entities that weren't pushed. */
  end(): void {
    this.tracks.forEach(this.sweepOne);
  }

  clear(): void {
    this.tracks.clear();
  }

  /** Writes the position blended by `alpha` (0 = previous step, 1 = latest) into `out`. False if unknown. */
  sample(id: number, alpha: number, out: Sample): boolean {
    const t = this.tracks.get(id);
    if (!t) return false;
    out.x = lerp(t.prevX, t.currX, alpha);
    out.y = lerp(t.prevY, t.currY, alpha);
    out.dx = t.currX - t.prevX;
    out.dy = t.currY - t.prevY;
    return true;
  }
}
