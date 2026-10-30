import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { OrthographicCamera } from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH, fitPlayfield } from '../game/playfield';
import type { Fit } from '../game/playfield';
import { SHIP_BOX_OFFSET_Y, SHIP_Y } from '../game/player';
import type { Alien, AlienKind, PlayerState, RunEvent, RunState, Shot } from '../game/types';
import { Effects } from './effects';
import { approachAngle, Tracker } from './interp';
import type { Sample } from './interp';
import { Model, ModelKit } from './models';
import type { ModelName } from './models';
import { PALETTE } from './palette';
import { PalettePass } from './post';
import { Starfield } from './stars';
import { createTiltCamera, placeTiltCamera } from './tilt';

// Draws a run. The sim steps at a fixed rate and the screen redraws at its own, so entities are
// drawn at positions blended between the last two steps. The view keeps no game state: it
// reads the RunState, plays effects from the events, and animates the models by name.

/** Snap the finished picture to the fixed palette and add the glow. Off draws the scene as is. */
export const PALETTE_PASS = true;

/** Longest frame the animation clock advances by, so a stalled tab doesn't leap. */
const MAX_FRAME_DT = 0.1;
const BG_COLOR = PALETTE[0];

/** How fast the ship's bank follows its sideways speed, per second. */
const BANK_RATE = 14;
const MAX_BANK = 0.65;
const FACING_RATE = 10;

const LEG_NAMES = ['leg_0', 'leg_1', 'leg_2'] as const;
const ALIEN_KINDS = ['drone', 'warden', 'diver'] as const;

/**
 * Models in use, found by entity id. Finished ones go back to a free list for reuse, so
 * after the first few waves nothing is created.
 */
class ViewPool {
  private readonly active = new Map<number, { model: Model; stamp: number }>();
  private readonly free: Model[] = [];
  private stamp = 0;
  private readonly release = (entry: { model: Model; stamp: number }, id: number): void => {
    if (entry.stamp === this.stamp) return;
    entry.model.holder.visible = false;
    this.free.push(entry.model);
    this.active.delete(id);
  };

  constructor(
    private readonly scene: Scene,
    private readonly make: () => Model,
  ) {}

  begin(): void {
    this.stamp++;
  }

  acquire(id: number): Model {
    let entry = this.active.get(id);
    if (!entry) {
      const model = this.free.pop() ?? this.make();
      if (!model.holder.parent) this.scene.add(model.holder);
      model.holder.visible = true;
      entry = { model, stamp: this.stamp };
      this.active.set(id, entry);
    }
    entry.stamp = this.stamp;
    return entry.model;
  }

  end(): void {
    this.active.forEach(this.release);
  }

  clear(): void {
    this.begin();
    this.end();
  }
}

interface ShipView {
  model: Model;
  shield: Mesh;
  bank: number;
}

export class GameView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera = createTiltCamera();
  private readonly stars = new Starfield();
  private readonly effects: Effects;
  private readonly pass = PALETTE_PASS ? new PalettePass() : null;
  private readonly kit = new ModelKit();
  private fitNow: Fit;

  private readonly alienTracks = new Tracker();
  private readonly shotTracks = new Tracker();
  private readonly shipTracks = new Tracker();
  private alienViews!: Record<AlienKind, ViewPool>;
  private playerShots!: ViewPool;
  private alienShots!: ViewPool;
  private readonly ships: ShipView[] = [];

  private time = 0;
  private readonly sample: Sample = { x: 0, y: 0, dx: 0, dy: 0 };
  private readonly shake = { x: 0, y: 0 };
  private readonly facing = new Map<number, number>();

  constructor(host: HTMLElement) {
    // No antialiasing and a pixel ratio of 1: the canvas is the art resolution, and CSS scales it up.
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(FIELD_WIDTH, FIELD_HEIGHT, false);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(new Color(BG_COLOR), 1);
    host.appendChild(this.renderer.domElement);

    this.scene.add(new HemisphereLight(0x9ab8ff, 0x2a1a48, 0.9));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const sun = new DirectionalLight(0xffffff, 2.6);
    sun.position.set(-2, 3, 4);
    this.scene.add(sun);
    this.effects = new Effects(this.scene);
    this.fitNow = this.layout();
  }

  get fit(): Fit {
    return this.fitNow;
  }

  /** Loads the models. Call once before the first `render`. */
  async load(): Promise<void> {
    await this.kit.load(import.meta.env.BASE_URL);
    const make = (name: ModelName) => () => this.kit.create(name);
    this.alienViews = {
      drone: new ViewPool(this.scene, make('drone')),
      warden: new ViewPool(this.scene, make('warden')),
      diver: new ViewPool(this.scene, make('diver')),
      // Placeholder until the Carrier model exists (slice 2a renderer step).
      carrier: new ViewPool(this.scene, make('warden')),
    };
    this.playerShots = new ViewPool(this.scene, make('shot_player'));
    this.alienShots = new ViewPool(this.scene, make('shot_alien'));
  }

  /** Sizes the canvas to the window. Call on resize. */
  layout(): Fit {
    const fit = fitPlayfield(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    const style = this.renderer.domElement.style;
    style.width = `${fit.width}px`;
    style.height = `${fit.height}px`;
    style.left = `${fit.left}px`;
    style.top = `${fit.top}px`;
    this.fitNow = fit;
    return fit;
  }

  /** Forgets all remembered positions and effects, e.g. when a new run starts. */
  reset(): void {
    this.alienTracks.clear();
    this.shotTracks.clear();
    this.shipTracks.clear();
    this.facing.clear();
    this.effects.clear();
  }

  /** Call after every sim step: records where everything is, so frames can blend between steps. */
  stepped(run: RunState): void {
    this.alienTracks.begin();
    for (const a of run.aliens) this.alienTracks.push(a.id, a.x, a.y);
    this.alienTracks.end();
    this.shotTracks.begin();
    for (const s of run.shots) this.shotTracks.push(s.id, s.x, s.y);
    this.shotTracks.end();
    this.shipTracks.begin();
    for (const p of run.players) this.shipTracks.push(p.id, p.x, 0);
    this.shipTracks.end();
  }

  /**
   * Draws one frame. `alpha` (0 to 1) is how far this frame is into the next sim step; `events`
   * is everything the steps since the last frame reported, which drives the effects.
   */
  render(run: RunState, events: readonly RunEvent[], alphaIn: number, frameDt: number): void {
    const alpha = Math.min(1, Math.max(0, alphaIn));
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    this.time += dt;

    for (const e of events) this.playEvent(run, e);
    this.effects.update(dt);

    this.drawShips(run, alpha, dt);
    this.drawAliens(run, alpha, dt);
    this.drawShots(run, alpha);
    this.stars.update(this.time);

    this.effects.shakeOffset(this.shake);
    placeTiltCamera(this.camera, this.shake.x, this.shake.y);
    this.draw();
  }

  private draw(): void {
    const r = this.renderer;
    r.setRenderTarget(this.pass ? this.pass.target : null);
    r.clear(true, true, false);
    r.render(this.stars.scene, this.stars.camera);
    r.clearDepth();
    r.render(this.scene, this.camera);
    this.pass?.present(r);
  }

  private playEvent(run: RunState, e: RunEvent): void {
    switch (e.type) {
      case 'alienKilled':
        this.effects.explode(e.x, e.y, e.kind);
        break;
      case 'alienHit':
        this.effects.sparks(e.x, e.y);
        break;
      case 'playerHit': {
        const p = run.players[e.playerId];
        if (p) this.effects.shipHit(p.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
        break;
      }
      case 'shieldHit': {
        const p = run.players[e.playerId];
        if (p) this.effects.shieldRing(p.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
        break;
      }
      case 'waveClear':
        this.effects.waveFlash();
        break;
      default:
        break;
    }
  }

  private shipFor(index: number): ShipView {
    let ship = this.ships[index];
    if (!ship) {
      const model = this.kit.create('player');
      // Centre the hull (not the flames) on the ship's hit box.
      model.body.position.y = -this.kit.hullCentreY;
      this.scene.add(model.holder);
      const shield = new Mesh(
        new RingGeometry(11, 12.2, 6),
        new MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.85 }),
      );
      shield.rotation.z = Math.PI / 6;
      shield.position.z = 1;
      shield.visible = false;
      model.holder.add(shield);
      ship = this.ships[index] = { model, shield, bank: 0 };
    }
    return ship;
  }

  private drawShips(run: RunState, alpha: number, dt: number): void {
    for (const p of run.players) this.drawShip(p, alpha, dt);
  }

  private drawShip(p: PlayerState, alpha: number, dt: number): void {
    const ship = this.shipFor(p.id);
    const { model } = ship;
    const alive = p.lives > 0;
    // Blink while invulnerable.
    const blinkOff = p.invulnerable > 0 && Math.floor(this.time * 16) % 2 === 0;
    model.holder.visible = alive && !blinkOff;
    if (!alive) return;

    const x = this.shipTracks.sample(p.id, alpha, this.sample) ? this.sample.x : p.x;
    model.holder.position.set(x, SHIP_Y + SHIP_BOX_OFFSET_Y, 0);

    // Bank into the turn.
    const target = Math.max(-MAX_BANK, Math.min(MAX_BANK, (p.vx / p.stats.speed) * MAX_BANK));
    ship.bank += (target - ship.bank) * (1 - Math.exp(-BANK_RATE * dt));
    model.body.rotation.y = ship.bank;

    // Engine flames flicker.
    const t = this.time;
    const { flame_L, flame_R } = model.parts;
    if (flame_L) flame_L.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38) + 0.1 * Math.sin(t * 61), 1);
    if (flame_R) flame_R.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38 + 2) + 0.1 * Math.sin(t * 53), 1);

    ship.shield.visible = p.shield > 0;
    if (p.shield > 0) ship.shield.scale.setScalar(1 + 0.04 * Math.sin(t * 8));
  }

  private drawAliens(run: RunState, alpha: number, dt: number): void {
    for (const kind of ALIEN_KINDS) this.alienViews[kind].begin();
    for (const a of run.aliens) this.drawAlien(a, alpha, dt);
    for (const kind of ALIEN_KINDS) this.alienViews[kind].end();
  }

  private drawAlien(a: Alien, alpha: number, dt: number): void {
    const model = this.alienViews[a.kind].acquire(a.id);
    const known = this.alienTracks.sample(a.id, alpha, this.sample);
    const { x, y, dx, dy } = known ? this.sample : { x: a.x, y: a.y, dx: 0, dy: 0 };
    model.holder.position.set(x, y, 0);
    model.setFlash(a.flash > 0);

    const t = this.time;
    const phase = a.id * 1.7;
    const parts = model.parts;

    if (a.kind === 'drone') {
      model.body.rotation.y = Math.sin(t * 1.8 + phase) * 0.28;
      for (let i = 0; i < 3; i++) {
        const leg = parts[LEG_NAMES[i]];
        if (leg) leg.rotation.z = Math.sin(t * 9 + phase + i * 2.1) * 0.4;
      }
      if (parts.antenna_L) parts.antenna_L.rotation.z = Math.sin(t * 5 + phase) * 0.22;
      if (parts.antenna_R) parts.antenna_R.rotation.z = -Math.sin(t * 5 + phase + 0.6) * 0.22;
    } else if (a.kind === 'warden') {
      model.body.rotation.y = Math.sin(t * 1.3 + phase) * 0.18;
      if (parts.core) parts.core.scale.setScalar(1 + 0.28 * Math.sin(t * 6 + phase));
    } else {
      const diving = a.mode !== 'formation';
      model.body.rotation.y = diving ? 0 : Math.sin(t * 1.6 + phase) * 0.25;
      const sweep = diving ? 0.5 + 0.12 * Math.sin(t * 22) : 0.1 * Math.sin(t * 4 + phase);
      if (parts.wing_L) parts.wing_L.rotation.z = -sweep;
      if (parts.wing_R) parts.wing_R.rotation.z = sweep;
      // Face the way it's flying: nose down on a straight dive, turning with the swoop.
      const moving = dx * dx + dy * dy > 1e-8;
      const want = diving && moving ? Math.atan2(dx, -dy) : 0;
      const now = this.facing.get(a.id) ?? want;
      const next = approachAngle(now, want, FACING_RATE, dt);
      this.facing.set(a.id, next);
      model.holder.rotation.z = next;
    }
  }

  private drawShots(run: RunState, alpha: number): void {
    this.playerShots.begin();
    this.alienShots.begin();
    for (const s of run.shots) this.drawShot(s, alpha);
    this.playerShots.end();
    this.alienShots.end();
  }

  private drawShot(s: Shot, alpha: number): void {
    const model = (s.owner === 'player' ? this.playerShots : this.alienShots).acquire(s.id);
    const known = this.shotTracks.sample(s.id, alpha, this.sample);
    model.holder.position.set(known ? this.sample.x : s.x, known ? this.sample.y : s.y, 0);
    if (s.owner === 'alien') model.body.rotation.y = this.time * 5 + s.id;
  }
}
