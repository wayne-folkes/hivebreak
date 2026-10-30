import {
  AmbientLight,
  BoxGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import type { OrthographicCamera } from 'three';
import { bossDefeated, bossEntering, platesStanding } from '../game/boss';
import { FIELD_HEIGHT, FIELD_WIDTH, fitPlayfield } from '../game/playfield';
import type { Fit } from '../game/playfield';
import { SHIP_BOX_OFFSET_Y, SHIP_TOP, SHIP_Y, wingmanXs } from '../game/player';
import { POWER_UP_KINDS, enemyTimeScale, helperPosition } from '../game/powerups';
import type { Alien, AlienKind, BossState, PlayerState, PowerUpKind, RunEvent, RunState, Shot } from '../game/types';
import { BeamView } from './beams';
import { bayGlowName, bossPartNames, corePulse, launchWarning } from './bossparts';
import { BOSS_DEATH_SECONDS, Effects, POWER_UP_COLOR, SHIELD_SPARK } from './effects';
import { approachAngle, Tracker } from './interp';
import type { Sample } from './interp';
import { LOOK_FROZEN, LOOK_NORMAL, LOOK_SLOW, Model, ModelKit } from './models';
import type { Look, ModelName } from './models';
import { PALETTE } from './palette';
import { PalettePass } from './post';
import { Starfield } from './stars';
import { StunMarkers } from './stun';
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
const ALIEN_KINDS = ['drone', 'warden', 'diver', 'carrier'] as const;

/**
 * Pickups: how far they bob (art pixels), and how far and fast they swing about their vertical
 * axis. They rock back and forth rather than turn right round, because from behind a pickup is
 * only its dark backing plate, with no icon on it.
 */
const PICKUP_BOB = 1.4;
const PICKUP_SWING = 0.6;
const PICKUP_SWING_RATE = 2.8;
/** The wingmen are the ship, a little smaller. */
const WINGMAN_SCALE = 0.7;
/** Wingmen drawn per ship, at most. */
const MAX_WINGMEN = 4;
/** A power-up (the helper drone) blinks for this many seconds before it runs out. */
const POWER_UP_WARNING = 1.5;
/**
 * Screen tints behind the field. The sky only lifts to the palette's second colour (a bigger
 * jump would flood the screen); the stars carry the colour: the slow field's cool cyan, Time
 * Stop's pale ice.
 */
const TINT_SKY = 0x181226;
const SLOW_STARS = 0x52ddeb;
const FREEZE_STARS = 0xd3f1ff;
/** The Brood Mother's bays blink this many times a second as a launch nears (more as it gets close). */
const BAY_BLINK_HZ = 12;

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
  /** The Shield Burst's hex shell. */
  burst: Group;
  bank: number;
}

/** A hex shell: a bright double ring and a faint fill, for the Shield Burst (and, smaller, the boss's core shield). */
function hexShell(radius: number, ringColor: number, fillColor: number, fillOpacity: number): Group {
  const group = new Group();
  const outer = new Mesh(new RingGeometry(radius, radius + 1.4, 6), new MeshBasicMaterial({ color: ringColor }));
  const inner = new Mesh(
    new RingGeometry(radius * 0.72, radius * 0.72 + 1, 6),
    new MeshBasicMaterial({ color: fillColor, transparent: true, opacity: 0.8 }),
  );
  inner.rotation.z = Math.PI / 6;
  const fill = new Mesh(
    new CircleGeometry(radius, 6),
    new MeshBasicMaterial({ color: fillColor, transparent: true, opacity: fillOpacity, depthWrite: false }),
  );
  group.add(fill, inner, outer);
  group.rotation.z = Math.PI / 6;
  return group;
}

export class GameView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera = createTiltCamera();
  private readonly stars = new Starfield();
  private readonly effects: Effects;
  private readonly beams: BeamView;
  private readonly stun: StunMarkers;
  private readonly pass = PALETTE_PASS ? new PalettePass() : null;
  private readonly kit = new ModelKit();
  private fitNow: Fit;

  private readonly alienTracks = new Tracker();
  private readonly shotTracks = new Tracker();
  private readonly shipTracks = new Tracker();
  private readonly pickupTracks = new Tracker();
  private readonly bossTrack = new Tracker();
  private alienViews!: Record<AlienKind, ViewPool>;
  private playerShots!: ViewPool;
  private alienShots!: ViewPool;
  private overchargeShots!: ViewPool;
  private lanceShots!: ViewPool;
  private reflectedShots!: ViewPool;
  private pickupViews!: Record<PowerUpKind, ViewPool>;
  private helperViews!: ViewPool;
  private wingmanViews!: ViewPool;
  private shotPools: ViewPool[] = [];
  private readonly ships: ShipView[] = [];

  private bossModel: Model | null = null;
  private bossShield: Group | null = null;
  private bossShieldFlash = 0;
  /** The parts the boss model was last set up for, so a new boss gets a fresh model. */
  private bossPartsRef: BossState['parts'] | null = null;
  private bossNames: string[] = [];
  /** Seconds since the boss's core fell, or -1 while it lives; it flickers and then vanishes. */
  private bossDying = -1;

  private time = 0;
  /** A clock for the enemies' animation: stops during Time Stop and runs at half speed in the slow field. */
  private enemyTime = 0;
  private look: Look = LOOK_NORMAL;
  private tintAmount = 0;
  private tintStars = SLOW_STARS;
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
    this.beams = new BeamView(this.scene, this.effects);
    this.stun = new StunMarkers(this.scene);
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
      carrier: new ViewPool(this.scene, make('carrier')),
    };
    this.playerShots = new ViewPool(this.scene, make('shot_player'));
    this.alienShots = new ViewPool(this.scene, make('shot_alien'));
    this.overchargeShots = new ViewPool(this.scene, () => this.makeBigShot('overcharge'));
    this.lanceShots = new ViewPool(this.scene, () => this.makeBigShot('lance'));
    this.reflectedShots = new ViewPool(this.scene, () => this.makeBigShot('reflected'));
    this.shotPools = [this.playerShots, this.alienShots, this.overchargeShots, this.lanceShots, this.reflectedShots];
    this.pickupViews = {
      spread: new ViewPool(this.scene, () => this.makePickup('spread')),
      laser: new ViewPool(this.scene, () => this.makePickup('laser')),
      slow: new ViewPool(this.scene, () => this.makePickup('slow')),
      helper: new ViewPool(this.scene, () => this.makePickup('helper')),
    };
    this.helperViews = new ViewPool(this.scene, make('helper'));
    this.wingmanViews = new ViewPool(this.scene, () => {
      const model = this.makeShipModel();
      model.holder.scale.setScalar(WINGMAN_SCALE);
      return model;
    });
  }

  /** A pickup: its model, with a thin ring of its colour around it so it stands out against the dark field. */
  private makePickup(kind: PowerUpKind): Model {
    const model = this.kit.create(`pickup_${kind}`);
    const ring = new Mesh(new RingGeometry(5.6, 6.6, 12), new MeshBasicMaterial({ color: POWER_UP_COLOR[kind] }));
    ring.name = 'aura';
    ring.position.z = -1.4;
    ring.rotation.z = Math.PI / 12;
    model.holder.add(ring);
    return model;
  }

  /** The ship model with its hull (not its flames) centred on the holder's origin. */
  private makeShipModel(): Model {
    const model = this.kit.create('player');
    model.body.position.y = -this.kit.hullCentreY;
    return model;
  }

  /**
   * The special player shots: an Overcharge is a big, white-hot bolt in an orange halo; a Lance
   * a long, thin white bolt in a cyan one; a reflected enemy shot the ordinary bolt, a little
   * fatter, in the ship's own colour.
   */
  private makeBigShot(kind: 'overcharge' | 'lance' | 'reflected'): Model {
    const model = this.kit.create('shot_player');
    if (kind === 'reflected') {
      model.holder.scale.set(1.3, 1, 1.3);
      return model;
    }
    model.setFlash(true);
    const big = kind === 'overcharge';
    model.holder.scale.set(big ? 2.2 : 0.8, big ? 1.5 : 3.4, big ? 2.2 : 0.8);
    const halo = new Mesh(
      new BoxGeometry(big ? 3.4 : 3.2, big ? 1.22 : 1.04, 0.6),
      new MeshBasicMaterial({ color: big ? 0xffb04f : 0x52ddeb }),
    );
    halo.name = 'halo';
    halo.position.z = -0.9;
    model.body.add(halo);
    return model;
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
    this.pickupTracks.clear();
    this.bossTrack.clear();
    this.facing.clear();
    this.effects.clear();
    this.beams.clear();
    this.stun.clear();
    this.hideBoss();
    this.bossDying = -1;
    this.tintAmount = 0;
    this.stars.setTint(TINT_SKY, SLOW_STARS, 0);
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
    this.pickupTracks.begin();
    for (const p of run.pickups) this.pickupTracks.push(p.id, p.x, p.y);
    this.pickupTracks.end();
    this.bossTrack.begin();
    if (run.boss) this.bossTrack.push(0, run.boss.x, run.boss.y);
    this.bossTrack.end();
  }

  /**
   * Draws one frame. `alpha` (0 to 1) is how far this frame is into the next sim step; `events`
   * is everything the steps since the last frame reported, which drives the effects.
   */
  render(run: RunState, events: readonly RunEvent[], alphaIn: number, frameDt: number): void {
    const alpha = Math.min(1, Math.max(0, alphaIn));
    const dt = Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    this.time += dt;
    const enemyScale = enemyTimeScale(run);
    this.enemyTime += dt * enemyScale;
    this.look = run.freeze > 0 ? LOOK_FROZEN : run.slow > 0 ? LOOK_SLOW : LOOK_NORMAL;

    for (const e of events) this.playEvent(run, e);
    this.effects.update(dt);
    this.bossShieldFlash = Math.max(0, this.bossShieldFlash - dt);

    this.stun.begin();
    this.drawShips(run, alpha, dt);
    this.drawBeams(run, alpha, dt);
    this.drawAliens(run, alpha, dt, enemyScale);
    this.drawBoss(run, alpha, dt);
    this.stun.end();
    this.drawPickups(run, alpha);
    this.drawShots(run, alpha);
    this.drawTint(run, dt);
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

  /** A subtle wash behind the field while the slow field or Time Stop runs, faded in and out. */
  private drawTint(run: RunState, dt: number): void {
    const target = run.freeze > 0 ? 1 : run.slow > 0 ? 0.7 : 0;
    if (target > 0) this.tintStars = run.freeze > 0 ? FREEZE_STARS : SLOW_STARS;
    this.tintAmount += (target - this.tintAmount) * (1 - Math.exp(-6 * dt));
    if (Math.abs(target - this.tintAmount) < 0.005) this.tintAmount = target;
    this.stars.setTint(TINT_SKY, this.tintStars, this.tintAmount);
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
      case 'blast':
        // The Pulse Bomb reports a blast as big as the field; its own wave is played from specialFired.
        if (e.radius < BIG_BLAST) this.effects.blast(e.x, e.y, e.radius);
        break;
      case 'pickupSpawned':
        this.effects.pickupSparkle(e.x, e.y, e.kind);
        break;
      case 'pickupCollected': {
        const p = run.players[e.playerId];
        if (p) this.effects.pickupCaught(p.x, SHIP_Y + SHIP_BOX_OFFSET_Y, e.kind);
        break;
      }
      case 'specialFired':
        this.playSpecial(e.special, e.x, e.y);
        break;
      case 'shotReflected':
        this.effects.sparksIn(e.x, e.y, SHIELD_SPARK, 6, 70);
        break;
      case 'bossLaunched': {
        for (const a of run.aliens) {
          if (a.id !== e.alienId) continue;
          this.effects.sparksIn(a.x, a.y, BAY_SPARK, 8, 45);
          break;
        }
        break;
      }
      case 'bossFired':
        this.effects.sparksIn(e.x, e.y, CORE_FIRE, 4, 40);
        break;
      case 'bossPartHit':
        if (e.part === 'core' && run.boss && platesStanding(run.boss)) {
          // A shot the shielded core stopped: the shield flares.
          this.bossShieldFlash = 0.2;
          this.effects.sparksIn(e.x, e.y, SHIELD_SPARK, 5, 60);
        } else if (e.part === 'core') {
          this.effects.sparksIn(e.x, e.y, CORE_FIRE, 5, 60);
        } else {
          this.effects.sparks(e.x, e.y);
        }
        break;
      case 'bossPartDestroyed':
        this.effects.partBurst(e.x, e.y);
        // The last plate: the core's shield pops and the bare core shows.
        if (e.part === 'plate' && run.boss && !platesStanding(run.boss)) {
          this.effects.coreBare(run.boss.x, run.boss.y);
          this.effects.sparksIn(run.boss.x, run.boss.y, SHIELD_SPARK, 10, 90);
        }
        break;
      case 'bossPhase':
        if (run.boss) this.effects.wave(run.boss.x, run.boss.y, 6, 120, 0.45, 3, 0xff56da);
        this.effects.waveFlash(0xff56da, 0.22, 0.35);
        break;
      case 'bossKilled':
        this.bossDying = 0;
        this.effects.bigExplosion(e.x, e.y, BOSS_BLAST_HALF_WIDTH);
        break;
      default:
        break;
    }
  }

  private playSpecial(special: string, x: number, y: number): void {
    if (special === 'pulseBomb') {
      this.effects.pulse(x, y);
    } else if (special === 'shieldBurst') {
      this.effects.wave(x, y + SHIP_BOX_OFFSET_Y, 10, 36, 0.35, 2, 0xffffff);
      this.effects.sparksIn(x, y + SHIP_BOX_OFFSET_Y, SHIELD_SPARK, 10, 70);
    } else if (special === 'timeStop') {
      this.effects.waveFlash(0x9dfafd, 0.25, 0.35);
      this.effects.wave(x, y, 4, 400, 0.55, 2, 0x52ddeb);
    }
  }

  private shipFor(index: number): ShipView {
    let ship = this.ships[index];
    if (!ship) {
      const model = this.makeShipModel();
      this.scene.add(model.holder);
      const shield = new Mesh(
        new RingGeometry(11, 12.2, 6),
        new MeshBasicMaterial({ color: 0x4ff0ff, transparent: true, opacity: 0.85 }),
      );
      shield.rotation.z = Math.PI / 6;
      shield.position.z = 1;
      shield.visible = false;
      model.holder.add(shield);
      const burst = hexShell(14.5, 0xffffff, 0x9dfafd, 0.16);
      burst.position.z = 1.5;
      burst.visible = false;
      model.holder.add(burst);
      ship = this.ships[index] = { model, shield, burst, bank: 0 };
    }
    return ship;
  }

  private drawShips(run: RunState, alpha: number, dt: number): void {
    this.wingmanViews.begin();
    this.helperViews.begin();
    for (const p of run.players) this.drawShip(run, p, alpha, dt);
    this.wingmanViews.end();
    this.helperViews.end();
  }

  private drawShip(run: RunState, p: PlayerState, alpha: number, dt: number): void {
    const ship = this.shipFor(p.id);
    const { model } = ship;
    const alive = p.lives > 0;
    const bursting = p.burst > 0;
    // Blink while invulnerable; a Shield Burst's invulnerability shows as its shell instead.
    const blinkOff = p.invulnerable > 0 && !bursting && Math.floor(this.time * 16) % 2 === 0;
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
    flicker(model, t);

    ship.shield.visible = p.shield > 0;
    if (p.shield > 0) ship.shield.scale.setScalar(1 + 0.04 * Math.sin(t * 8));

    // The Shield Burst's hex shell spins, and blinks in its last moments.
    ship.burst.visible = bursting && (p.burst > 0.8 || Math.floor(t * 14) % 2 === 0);
    if (bursting) {
      ship.burst.rotation.z = Math.PI / 6 + t * 1.6;
      ship.burst.scale.setScalar(1 + 0.05 * Math.sin(t * 10));
    }

    if (p.stats.wingmen > 0) this.drawWingmen(p, x, ship.bank);
    this.drawHelper(run, p, x);
  }

  /** The wingmen: smaller copies of the ship at their sideways places, banking and flaring with it. */
  private drawWingmen(p: PlayerState, shipX: number, bank: number): void {
    const xs = wingmanXs(p);
    for (let i = 0; i < xs.length && i < MAX_WINGMEN; i++) {
      const model = this.wingmanViews.acquire(p.id * MAX_WINGMEN + i);
      // Offsets come from the sim; the ship's blended x keeps them with the ship between steps.
      model.holder.position.set(shipX + (xs[i] - p.x), SHIP_Y + SHIP_BOX_OFFSET_Y - 3, 0);
      model.body.rotation.y = bank;
      flicker(model, this.time + i * 1.3);
    }
  }

  /** The helper drone, orbiting where the sim fires its shots from; it blinks as its power-up runs out. */
  private drawHelper(run: RunState, p: PlayerState, shipX: number): void {
    let left = -1;
    for (const power of p.powerUps) if (power.kind === 'helper') left = power.timeLeft;
    if (left <= 0) return;
    const model = this.helperViews.acquire(p.id);
    const pos = helperPosition(p, run.time);
    model.holder.position.set(shipX + (pos.x - p.x), pos.y, 0.5);
    model.holder.visible = left > POWER_UP_WARNING || Math.floor(this.time * 10) % 2 === 0;
    const t = this.time;
    model.body.rotation.y = Math.sin(t * 2.4) * 0.5;
    if (model.parts.fin_L) model.parts.fin_L.rotation.z = Math.sin(t * 14) * 0.3;
    if (model.parts.fin_R) model.parts.fin_R.rotation.z = -Math.sin(t * 14 + 0.5) * 0.3;
  }

  private drawBeams(run: RunState, alpha: number, dt: number): void {
    this.beams.begin();
    for (const b of run.beams) {
      const x = this.shipTracks.sample(b.playerId, alpha, this.sample) ? this.sample.x : b.x;
      this.beams.draw(x, SHIP_TOP - 1, b.topY, this.time, dt);
    }
    this.beams.end();
  }

  private drawAliens(run: RunState, alpha: number, dt: number, enemyScale: number): void {
    for (const kind of ALIEN_KINDS) this.alienViews[kind].begin();
    const stunned = run.stun > 0;
    for (const a of run.aliens) this.drawAlien(a, alpha, dt, enemyScale, stunned);
    for (const kind of ALIEN_KINDS) this.alienViews[kind].end();
  }

  private drawAlien(a: Alien, alpha: number, dt: number, enemyScale: number, stunned: boolean): void {
    const model = this.alienViews[a.kind].acquire(a.id);
    const known = this.alienTracks.sample(a.id, alpha, this.sample);
    const { x, y, dx, dy } = known ? this.sample : { x: a.x, y: a.y, dx: 0, dy: 0 };
    model.holder.position.set(x, y, 0);
    model.setFlash(a.flash > 0);
    model.setLook(this.look);
    if (stunned && a.mode === 'formation') this.stun.add(x, y + 9, 5, 2, this.time, a.id * 1.3);

    const t = this.enemyTime;
    const phase = a.id * 1.7;
    const parts = model.parts;

    if (a.kind === 'drone') {
      const free = a.mode === 'free';
      model.body.rotation.y = Math.sin(t * 1.8 + phase) * 0.28;
      // A Drone launched by the boss tips into its fall, and flaps its legs faster.
      model.holder.rotation.z = free ? -(a.vx ?? 0) * 0.012 : 0;
      const legRate = free ? 14 : 9;
      for (let i = 0; i < 3; i++) {
        const leg = parts[LEG_NAMES[i]];
        if (leg) leg.rotation.z = Math.sin(t * legRate + phase + i * 2.1) * 0.4;
      }
      if (parts.antenna_L) parts.antenna_L.rotation.z = Math.sin(t * 5 + phase) * 0.22;
      if (parts.antenna_R) parts.antenna_R.rotation.z = -Math.sin(t * 5 + phase + 0.6) * 0.22;
    } else if (a.kind === 'warden') {
      model.body.rotation.y = Math.sin(t * 1.3 + phase) * 0.18;
      if (parts.core) parts.core.scale.setScalar(1 + 0.28 * Math.sin(t * 6 + phase));
    } else if (a.kind === 'carrier') {
      model.body.rotation.y = Math.sin(t * 1.1 + phase) * 0.15;
      // The pod spins about its own vertical axis.
      if (parts.pod) parts.pod.rotation.y = t * 3.2 + phase;
    } else {
      const diving = a.mode !== 'formation';
      model.body.rotation.y = diving ? 0 : Math.sin(t * 1.6 + phase) * 0.25;
      const sweep = diving ? 0.5 + 0.12 * Math.sin(t * 22) : 0.1 * Math.sin(t * 4 + phase);
      if (parts.wing_L) parts.wing_L.rotation.z = -sweep;
      if (parts.wing_R) parts.wing_R.rotation.z = sweep;
      // Face the way it's flying: nose down on a straight dive, turning with the swoop. Frozen,
      // it holds its facing (it isn't moving, which would otherwise read as "turn upright").
      const moving = dx * dx + dy * dy > 1e-8;
      const want = diving && moving ? Math.atan2(dx, -dy) : 0;
      const now = this.facing.get(a.id) ?? want;
      const next = enemyScale > 0 ? approachAngle(now, want, FACING_RATE, dt * enemyScale) : now;
      this.facing.set(a.id, next);
      model.holder.rotation.z = next;
    }
  }

  // The Brood Mother ----------------------------------------------------------------------------

  private hideBoss(): void {
    if (this.bossModel) this.bossModel.holder.visible = false;
    if (this.bossShield) this.bossShield.visible = false;
  }

  private bossModelFor(): Model {
    if (!this.bossModel) {
      const model = this.kit.create('brood_mother');
      this.scene.add(model.holder);
      const shield = hexShell(8.6, 0x9dfafd, 0x52ddeb, 0.2);
      shield.position.z = 10.6;
      model.holder.add(shield);
      this.bossModel = model;
      this.bossShield = shield;
    }
    return this.bossModel;
  }

  /** Puts a fresh Brood Mother model in order for a new boss: every part whole, nothing flashing. */
  private resetBossModel(model: Model, boss: BossState): void {
    this.bossPartsRef = boss.parts;
    this.bossNames = bossPartNames(boss.parts);
    model.setFlash(false);
    for (const name of this.bossNames) {
      model.setPartWreck(name, false);
      const node = model.parts[name];
      if (node) node.visible = true;
      const glow = model.parts[bayGlowName(name)];
      if (glow) glow.visible = true;
    }
  }

  private drawBoss(run: RunState, alpha: number, dt: number): void {
    const boss = run.boss;
    if (!boss) {
      this.bossDying = -1;
      this.hideBoss();
      return;
    }
    const dead = bossDefeated(boss);
    if (dead) {
      // The core fell. If the kill was seen, the boss flickers through its death bursts, then goes.
      if (this.bossDying < 0 || this.bossDying >= BOSS_DEATH_SECONDS) {
        this.hideBoss();
        return;
      }
      this.bossDying += dt;
    } else {
      this.bossDying = -1;
    }

    const model = this.bossModelFor();
    if (this.bossPartsRef !== boss.parts) this.resetBossModel(model, boss);
    model.holder.visible = true;
    const known = this.bossTrack.sample(0, alpha, this.sample);
    const x = known ? this.sample.x : boss.x;
    const y = known ? this.sample.y : boss.y;
    model.holder.position.set(x, y, 0);

    const t = this.enemyTime;
    const parts = model.parts;
    const dying = this.bossDying >= 0;
    if (dying) {
      model.setFlash(Math.floor(this.bossDying * 12) % 3 === 0);
    } else {
      const active = !bossEntering(boss) && boss.stun <= 0 && !dead;
      const warn = launchWarning(boss.launchTimer, active);
      for (let i = 0; i < boss.parts.length; i++) {
        const part = boss.parts[i];
        const name = this.bossNames[i];
        const node = parts[name];
        if (!node) continue;
        if (part.kind === 'plate') {
          node.visible = part.hp > 0;
        } else if (part.kind === 'bay') {
          const alive = part.hp > 0;
          model.setPartWreck(name, !alive);
          const glowName = bayGlowName(name);
          const glow = parts[glowName];
          if (glow) {
            glow.visible = alive;
            // Before a launch the light strip swells and blinks white, faster the nearer it is.
            const blink = warn > 0 && Math.floor(this.time * BAY_BLINK_HZ * (1 + warn)) % 2 === 0;
            model.setPartFlash(glowName, alive && blink);
            glow.scale.set(1 + 0.5 * warn, 1 + (0.15 + 1.6 * warn) * (0.6 + 0.4 * Math.sin(t * 30)), 1);
          }
        } else {
          node.scale.setScalar(corePulse(boss.phase, t));
        }
        model.setPartFlash(name, part.flash > 0 && part.hp > 0 && !(part.kind === 'core' && dead));
      }
      if (parts.wing_L) parts.wing_L.rotation.z = Math.sin(t * 1.5) * 0.05;
      if (parts.wing_R) parts.wing_R.rotation.z = -Math.sin(t * 1.5 + 0.4) * 0.05;
      model.body.rotation.y = Math.sin(t * 0.8) * 0.04;
    }
    model.setLook(this.look);

    // The core's shield while any plate stands, flaring when a shot is stopped on it.
    const shield = this.bossShield;
    if (shield) {
      const up = !dying && platesStanding(boss);
      shield.visible = up;
      if (up) {
        const flare = this.bossShieldFlash > 0;
        shield.rotation.z = Math.PI / 6 + this.time * 0.9;
        shield.scale.setScalar((flare ? 1.18 : 1) + 0.04 * Math.sin(this.time * 9));
      }
    }

    if (boss.stun > 0 && !dying) this.stun.add(x, y + 17, 38, 7, this.time, 0);
  }

  // Pickups and shots ---------------------------------------------------------------------------

  private drawPickups(run: RunState, alpha: number): void {
    for (const kind of POWER_UP_KINDS) this.pickupViews[kind].begin();
    const t = this.time;
    for (const p of run.pickups) {
      const model = this.pickupViews[p.kind].acquire(p.id);
      const known = this.pickupTracks.sample(p.id, alpha, this.sample);
      const x = known ? this.sample.x : p.x;
      const y = known ? this.sample.y : p.y;
      // Bobbing on the way down, spinning about its vertical axis, with a gentle breathing.
      model.holder.position.set(x, y + Math.sin(t * 5 + p.id) * PICKUP_BOB, 0);
      model.body.rotation.y = Math.sin(t * PICKUP_SWING_RATE + p.id * 1.9) * PICKUP_SWING;
      model.holder.scale.setScalar(1 + 0.07 * Math.sin(t * 7 + p.id));
    }
    for (const kind of POWER_UP_KINDS) this.pickupViews[kind].end();
  }

  private drawShots(run: RunState, alpha: number): void {
    const pools = this.shotPools;
    for (const pool of pools) pool.begin();
    for (const s of run.shots) this.drawShot(s, alpha);
    for (const pool of pools) pool.end();
  }

  private poolFor(s: Shot): ViewPool {
    if (s.kind === 'overcharge') return this.overchargeShots;
    if (s.kind === 'lance') return this.lanceShots;
    if (s.kind === 'reflected') return this.reflectedShots;
    return s.owner === 'player' ? this.playerShots : this.alienShots;
  }

  private drawShot(s: Shot, alpha: number): void {
    const model = this.poolFor(s).acquire(s.id);
    const known = this.shotTracks.sample(s.id, alpha, this.sample);
    model.holder.position.set(known ? this.sample.x : s.x, known ? this.sample.y : s.y, 0);
    if (s.owner === 'alien') {
      model.body.rotation.y = this.enemyTime * 5 + s.id;
      model.setLook(this.look);
      return;
    }
    // A player's shot points the way it flies (spread, homing and ricochet shots slant).
    model.holder.rotation.z = s.vx === 0 ? 0 : Math.atan2(-s.vx, s.vy);
    if (s.kind === 'overcharge') {
      const halo = model.parts.halo;
      if (halo) halo.scale.set(1 + 0.2 * Math.sin(this.time * 30 + s.id), 1 + 0.1 * Math.sin(this.time * 23), 1);
    } else if (s.kind === 'reflected') {
      model.body.rotation.y = this.time * 9 + s.id;
    }
  }
}

/** Blasts at least this big (the Pulse Bomb's field-wide one) are played by their Special, not as a bomb-on-kill burst. */
const BIG_BLAST = 100;
/** Half the Brood Mother's width, for scattering its death bursts across its body. */
const BOSS_BLAST_HALF_WIDTH = 46;
const BAY_SPARK: readonly number[] = [0xffb04f, 0xffe164, 0xffffff];
const CORE_FIRE: readonly number[] = [0xff56da, 0xffffff, 0xff8a45];

/** Flickers a ship model's two engine flames. */
function flicker(model: Model, t: number): void {
  const { flame_L, flame_R } = model.parts;
  if (flame_L) flame_L.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38) + 0.1 * Math.sin(t * 61), 1);
  if (flame_R) flame_R.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38 + 2) + 0.1 * Math.sin(t * 53), 1);
}
