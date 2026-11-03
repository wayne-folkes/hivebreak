import { ART_PER_PX_X, ART_PER_PX_Y } from './layout';
import { Canvas, mix } from './sprites';
import type { SpriteRows } from './sprites';
import type { Rgb } from './frame';

// The terminal's short-lived effects: sparks, expanding rings and jagged lightning arcs. All of it
// lives in terminal-pixel space (field pixels, y down), is aged by the seconds between draws (so
// a pause freezes it) and is capped, so a long fight can't pile up work. The random numbers come
// from the effects' own seeded generator: the same events give the same picture.

/** The most of each kind alive at once; new ones past this are dropped. */
export const MAX_PARTICLES = 480;
export const MAX_RINGS = 24;
export const MAX_ARCS = 24;
export const MAX_GHOSTS = 16;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  colours: readonly Rgb[];
  drag: number;
  gravity: number;
}

interface Ring {
  x: number;
  y: number;
  /** Start and end radius, art pixels (the ring is an ellipse on screen: art pixels are 3 wide and 4 tall per terminal pixel). */
  r0: number;
  r1: number;
  age: number;
  life: number;
  colour: Rgb;
  /** Seconds before it starts (negative age until then). */
  delay: number;
}

interface Arc {
  points: { x: number; y: number }[];
  age: number;
  life: number;
  colours: readonly Rgb[];
}

/** A fading, single-coloured copy of a sprite (a Warper's afterimage). */
interface Ghost {
  x: number;
  y: number;
  rows: SpriteRows;
  colour: Rgb;
  /** Opacity at its brightest. */
  alpha: number;
  age: number;
  life: number;
}

export interface BurstOptions {
  x: number;
  y: number;
  count: number;
  /** Top speed, terminal pixels per second. */
  speed: number;
  /** Longest life, seconds (each particle lives 55 to 100 % of it). */
  life: number;
  /** Colours from hot to cool over a particle's life. */
  colours: readonly Rgb[];
  /** Random offset of the spawn point either side of (x, y), pixels. */
  spreadX?: number;
  spreadY?: number;
  /** Pixels per second squared, positive is down. */
  gravity?: number;
  /** Fraction of speed lost per second. */
  drag?: number;
  /** Direction (radians, 0 = right, y up) and width of the cone to fire in; omitted means all round. */
  angle?: number;
  cone?: number;
}

export class Effects {
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private arcs: Arc[] = [];
  private ghosts: Ghost[] = [];
  private seed = 0x9e3779b9;

  /** A seeded random number in [0, 1). */
  random(): number {
    this.seed = (this.seed + 0x6d2b79f5) | 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** How many effects are alive (for tests). */
  get count(): number {
    return this.particles.length + this.rings.length + this.arcs.length + this.ghosts.length;
  }

  get particleCount(): number {
    return this.particles.length;
  }

  clear(): void {
    this.particles.length = 0;
    this.rings.length = 0;
    this.arcs.length = 0;
    this.ghosts.length = 0;
  }

  /** A burst of sparks. */
  burst(o: BurstOptions): void {
    for (let i = 0; i < o.count; i++) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const a = o.angle === undefined ? this.random() * Math.PI * 2 : o.angle + (this.random() - 0.5) * (o.cone ?? Math.PI * 2);
      const s = o.speed * (0.25 + 0.75 * this.random());
      this.particles.push({
        x: o.x + (this.random() - 0.5) * 2 * (o.spreadX ?? 0),
        y: o.y + (this.random() - 0.5) * 2 * (o.spreadY ?? 0),
        vx: Math.cos(a) * s,
        // Pixels grow downwards; angles count anticlockwise from right, so the sine flips.
        vy: -Math.sin(a) * s,
        age: 0,
        life: o.life * (0.55 + 0.45 * this.random()),
        colours: o.colours,
        drag: o.drag ?? 1.5,
        gravity: o.gravity ?? 0,
      });
    }
  }

  /** An expanding ring from art radius r0 to r1 over `life` seconds, centred on a pixel position. */
  ring(x: number, y: number, r0: number, r1: number, life: number, colour: Rgb, delay = 0): void {
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push({ x, y, r0, r1, age: -delay, life, colour, delay });
  }

  /** A copy of a sprite, centred on a pixel position, that fades out over `life` seconds (starting after `delay`). */
  ghost(x: number, y: number, rows: SpriteRows, colour: Rgb, alpha: number, life: number, delay = 0): void {
    if (this.ghosts.length >= MAX_GHOSTS) this.ghosts.shift();
    this.ghosts.push({ x, y, rows, colour, alpha, age: -delay, life });
  }

  /** A jagged bolt between two pixel positions; `jitter` is how far (pixels) the bolt strays from the straight line. */
  arc(x0: number, y0: number, x1: number, y1: number, life: number, colours: readonly Rgb[], jitter = 2.4): void {
    if (this.arcs.length >= MAX_ARCS) this.arcs.shift();
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const segs = Math.max(2, Math.round(len / 2.5));
    const nx = len > 0 ? -dy / len : 0;
    const ny = len > 0 ? dx / len : 0;
    const points = [{ x: x0, y: y0 }];
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const off = (this.random() - 0.5) * jitter;
      points.push({ x: x0 + dx * t + nx * off, y: y0 + dy * t + ny * off });
    }
    points.push({ x: x1, y: y1 });
    this.arcs.push({ points, age: 0, life, colours });
  }

  /** Ages everything by `dt` seconds and drops what has finished. */
  update(dt: number): void {
    if (!(dt > 0)) return;
    for (const p of this.particles) {
      p.age += dt;
      const keep = Math.max(0, 1 - p.drag * dt);
      p.vx *= keep;
      p.vy = p.vy * keep + p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    for (const r of this.rings) r.age += dt;
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const a of this.arcs) a.age += dt;
    this.arcs = this.arcs.filter((a) => a.age < a.life);
    for (const g of this.ghosts) g.age += dt;
    this.ghosts = this.ghosts.filter((g) => g.age < g.life);
  }

  /** Draws everything onto the canvas. */
  draw(cv: Canvas): void {
    for (const g of this.ghosts) {
      if (g.age < 0) continue;
      const alpha = g.alpha * (1 - g.age / g.life);
      const w = Math.max(...g.rows.map((r) => r.length));
      const left = Math.round(g.x - w / 2);
      const top = Math.round(g.y - g.rows.length / 2);
      for (let j = 0; j < g.rows.length; j++) {
        for (let i = 0; i < g.rows[j].length; i++) {
          const ch = g.rows[j][i];
          if (ch !== '.' && ch !== ' ') cv.blend(left + i, top + j, g.colour, alpha);
        }
      }
    }
    for (const r of this.rings) {
      if (r.age < 0) continue;
      const u = r.age / r.life;
      const radius = r.r0 + (r.r1 - r.r0) * (1 - (1 - u) * (1 - u));
      const rx = radius / ART_PER_PX_X;
      const ry = radius / ART_PER_PX_Y;
      const steps = Math.min(1400, Math.max(16, Math.ceil(Math.PI * 2 * Math.max(rx, ry) * 1.6)));
      const alpha = Math.min(1, (1 - u) * 1.4);
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = r.x + Math.cos(a) * rx;
        const y = r.y + Math.sin(a) * ry;
        // Big rings spend most of their samples off the field.
        if (x < -1 || y < -1 || x > cv.width + 1 || y > cv.height + 1) continue;
        cv.blend(x, y, r.colour, alpha);
      }
    }
    for (const a of this.arcs) {
      const u = a.age / a.life;
      const colour = a.colours[Math.min(a.colours.length - 1, Math.floor(u * a.colours.length))];
      for (let i = 1; i < a.points.length; i++) cv.line(a.points[i - 1].x, a.points[i - 1].y, a.points[i].x, a.points[i].y, colour);
    }
    for (const p of this.particles) {
      const u = p.age / p.life;
      const colour = p.colours[Math.min(p.colours.length - 1, Math.floor(u * p.colours.length))];
      // Fade out over the last 40 % of its life by mixing into whatever is behind it.
      cv.blend(p.x, p.y, colour, Math.min(1, (1 - u) / 0.4));
    }
  }
}

/** A tint for the whole field: `mix`ed into every pixel at `alpha`. */
export function washField(cv: Canvas, colour: Rgb, alpha: number): void {
  if (alpha <= 0) return;
  for (let y = 0; y < cv.height; y++) {
    for (let x = 0; x < cv.width; x++) cv.set(x, y, mix(cv.get(x, y), colour, alpha));
  }
}

/** A coloured glow along the field's edges, `depth` pixels deep, strongest at the very edge. */
export function edgeGlow(cv: Canvas, colour: Rgb, alpha: number, depth = 3): void {
  if (alpha <= 0) return;
  for (let y = 0; y < cv.height; y++) {
    for (let d = 0; d < depth; d++) {
      const a = alpha * (1 - d / depth);
      cv.blend(d, y, colour, a);
      cv.blend(cv.width - 1 - d, y, colour, a);
    }
  }
  for (let x = depth; x < cv.width - depth; x++) {
    for (let d = 0; d < depth; d++) {
      const a = alpha * (1 - d / depth);
      cv.blend(x, d, colour, a);
      cv.blend(x, cv.height - 1 - d, colour, a);
    }
  }
}
