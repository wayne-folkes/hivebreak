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
import { beamBunkerContacts } from '../game/hivemind';
import type { BeamContact } from '../game/hivemind';
import { FIELD_HEIGHT, FIELD_WIDTH, fitPlayfield } from '../game/playfield';
import type { Fit } from '../game/playfield';
import { SHIP_BOX_OFFSET_Y, SHIP_TOP, SHIP_Y, wingmanXs } from '../game/player';
import { POWER_UP_KINDS, enemyTimeScale, helperPosition } from '../game/powerups';
import { WARP_SECONDS } from '../game/sector3';
import { WAVES } from '../game/waves';
import type { Alien, AlienKind, BossKind, BossState, PlayerState, PowerUpKind, RunEvent, RunState, Shot, ShipId } from '../game/types';
import { AcidView } from './acidview';
import { ArcView } from './arcs';
import { BeamView } from './beams';
import { BossBeamView, rayToFieldEdge } from './bossbeams';
import { bayGlowName, bossPartNames, corePulse, hiveCorePulse, hiveGlowScale, launchWarning } from './bossparts';
import { BunkerView } from './bunkerview';
import { ACID_HALF_WIDTH } from '../game/hazards';
import { ARC_SPARK, BOSS_DEATH_SECONDS, Effects, PINCER_TRAIL, POWER_UP_COLOR, SEGMENT_SHARDS, SHIELD_SPARK, WELL_SPARK } from './effects';
import { approachAngle, Tracker } from './interp';
import { MendLinks } from './mendlinks';
import type { Sample } from './interp';
import { dropsTrail, exhaustScale, missileAngle } from './missile';
import { LOOK_FROZEN, LOOK_NORMAL, LOOK_SLOW, LOOK_WARP, Model, ModelKit, shipModelName } from './models';
import type { Look, ModelName } from './models';
import { PALETTE } from './palette';
import { PalettePass } from './post';
import { Starfield, sectorWeights } from './stars';
import { StunMarkers } from './stun';
import { TILT_DEG, createTiltCamera, placeTiltCamera } from './tilt';
import { WellView } from './wellview';
import { WARP_GHOST_SECONDS, ghostScale, warpProgress, warpScale, warpTint } from './warp';

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
const ALIEN_KINDS = ['drone', 'warden', 'diver', 'carrier', 'splitter', 'mini', 'warper', 'mender'] as const;

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
/** Seconds a sector change takes to fade the sky, nebula and light from one sector's look to the other's. */
const SECTOR_FADE_SECONDS = 1.6;
/** Lights: sector 1's cool blue and violet, sector 2's warm rose and brown, and sector 3's lime and gold. */
const HEMI_SKY = [0x9ab8ff, 0xffb8a0, 0xd4f08c] as const;
const HEMI_GROUND = [0x2a1a48, 0x2e0f14, 0x1c2a0c] as const;
const SUN = [0xffffff, 0xffe2d2, 0xfff0b8] as const;
/** The Splitter's halves, once it breaks: seconds they fly apart for, how far per second, and how many can fly at once. */
const SPLIT_SECONDS = 0.35;
const SPLIT_SPEED = 80;
const SPLIT_GHOSTS = 4;
/** How high above the field a mine is drawn, so it passes in front of the aliens, and how far the tilted camera lifts a point per unit of height. */
const MINE_Z = 4;
const MINE_SCALE = 1.35;
const LIFT_PER_Z = Math.tan((TILT_DEG * Math.PI) / 180);
/** A Warper's afterimages (two per blink): how many can show at once. */
const WARP_GHOSTS = 6;
/** A mender's cross glows white this long after a pulse, and starts to blink this long before the next. */
const MEND_GLOW_SECONDS = 0.3;
const MEND_CHARGE_SECONDS = 0.7;
/** A formation alien moving sideways faster than this (art pixels per step) is flying in, and trails pixels (the pincer). */
const TRAIL_SPEED = 0.9;
/** Seconds a ship flashes white after a hit, and a Lancer's muzzles flash after a volley. */
const HIT_FLASH_SECONDS = 0.14;
const MUZZLE_SECONDS = 0.09;
/** The Gravity Well's Special flash on the ship, and a swallowed shot's inward pop, in art pixels. */
const WELL_POP_RADIUS = 8;
/** The Hive Mind's decorative spikes turn this fast, radians per second. */
const SPIKE_TURN = 0.12;
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
  /** The ship this view is the model of. */
  id: ShipId;
  model: Model;
  shield: Mesh;
  /** The Shield Burst's hex shell. */
  burst: Group;
  bank: number;
  /** Seconds of white hit-flash left. */
  flash: number;
  /** Seconds of muzzle flash left (ships with `muzzle_L/R`). */
  muzzle: number;
}

/** Half of a broken Splitter, flying off. */
interface SplitGhost {
  model: Model;
  /** -1 for the left half, 1 for the right. */
  side: -1 | 1;
  /** Seconds since it broke; at SPLIT_SECONDS it is gone. */
  age: number;
  x: number;
  y: number;
}

/** A Warper's afterimage where it blinked from, shrinking and flickering teal away. */
interface WarpGhost {
  model: Model;
  /** Seconds since it appeared; at WARP_GHOST_SECONDS it is gone. */
  age: number;
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
  private readonly arcs: ArcView;
  private wellView: WellView | null = null;
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
  private missileShots!: ViewPool;
  private pickupViews!: Record<PowerUpKind, ViewPool>;
  private helperViews!: ViewPool;
  private wingmanViews!: ViewPool;
  private shotPools: ViewPool[] = [];
  private ghosts: SplitGhost[] = [];
  private ghostCursor = 0;
  private warpGhosts: WarpGhost[] = [];
  private warpGhostCursor = 0;
  private mineViews!: ViewPool;
  private readonly mineTracks = new Tracker();
  private acid!: AcidView;
  private readonly links: MendLinks;
  /** Menders whose cross is glowing from a pulse: alien id to seconds left. */
  private readonly mendGlow = new Map<number, number>();
  private readonly bunkers: BunkerView;
  private readonly bossBeams: BossBeamView;
  private readonly contacts: BeamContact[] = [];
  private readonly hemi = new HemisphereLight(HEMI_SKY[0], HEMI_GROUND[0], 0.9);
  private readonly sun = new DirectionalLight(SUN[0], 2.6);
  private readonly lightColor = new Color();
  private readonly lightWeights = [1, 0, 0];
  private sectorBlend = 0;
  private sectorSnap = true;
  private lastSectorApplied = -1;
  private enemyScale = 1;
  /** Each player's ship views, one per ship flown so far (a new run with another ship swaps to that model). */
  private readonly ships: Partial<Record<ShipId, ShipView>>[] = [];
  /** The view each player's ship was last drawn with, so a swap to another ship hides the old model. */
  private readonly shipShown: (ShipView | undefined)[] = [];
  private frame = 0;

  private readonly bossModels: Partial<Record<BossKind, Model>> = {};
  private bossShield: Group | null = null;
  private hiveGlow: Group | null = null;
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

    this.scene.add(this.hemi);
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    this.sun.position.set(-2, 3, 4);
    this.scene.add(this.sun);
    this.effects = new Effects(this.scene);
    this.bunkers = new BunkerView(this.scene);
    this.bossBeams = new BossBeamView(this.scene, this.effects);
    this.beams = new BeamView(this.scene, this.effects);
    this.stun = new StunMarkers(this.scene);
    this.arcs = new ArcView(this.scene);
    this.links = new MendLinks(this.scene);
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
      splitter: new ViewPool(this.scene, make('splitter')),
      mini: new ViewPool(this.scene, make('mini')),
      warper: new ViewPool(this.scene, make('warper')),
      mender: new ViewPool(this.scene, make('mender')),
    };
    this.mineViews = new ViewPool(this.scene, () => this.makeMine());
    this.acid = new AcidView(this.scene, this.effects, make('acid_drop'), ACID_HALF_WIDTH);
    this.warpGhosts = Array.from({ length: WARP_GHOSTS }, () => this.makeWarpGhost());
    this.playerShots = new ViewPool(this.scene, make('shot_player'));
    this.alienShots = new ViewPool(this.scene, make('shot_alien'));
    this.overchargeShots = new ViewPool(this.scene, () => this.makeBigShot('overcharge'));
    this.lanceShots = new ViewPool(this.scene, () => this.makeBigShot('lance'));
    this.reflectedShots = new ViewPool(this.scene, () => this.makeBigShot('reflected'));
    this.missileShots = new ViewPool(this.scene, make('missile'));
    this.shotPools = [this.playerShots, this.alienShots, this.overchargeShots, this.lanceShots, this.reflectedShots, this.missileShots];
    this.wellView = new WellView(this.scene, this.kit.create('well'), this.effects);
    this.pickupViews = {
      spread: new ViewPool(this.scene, () => this.makePickup('spread')),
      laser: new ViewPool(this.scene, () => this.makePickup('laser')),
      slow: new ViewPool(this.scene, () => this.makePickup('slow')),
      helper: new ViewPool(this.scene, () => this.makePickup('helper')),
    };
    this.helperViews = new ViewPool(this.scene, make('helper'));
    // Each Splitter that breaks sends a left half and a right half flying: a small pool of half-models.
    this.ghosts = Array.from({ length: SPLIT_GHOSTS }, (_, i) => this.makeGhost(i % 2 === 0 ? -1 : 1));
    this.wingmanViews = new ViewPool(this.scene, () => {
      const model = this.makeShipModel();
      model.holder.scale.setScalar(WINGMAN_SCALE);
      return model;
    });
  }

  /** One half of a broken Splitter: the splitter model with the other half, its eye and the seam hidden. */
  private makeGhost(side: -1 | 1): SplitGhost {
    const model = this.kit.create('splitter');
    const gone = side === -1 ? ['half_R', 'eye_R', 'seam'] : ['half_L', 'eye_L', 'seam'];
    for (const name of gone) if (model.parts[name]) model.parts[name].visible = false;
    model.holder.visible = false;
    this.scene.add(model.holder);
    return { model, side, age: SPLIT_SECONDS, x: 0, y: 0 };
  }

  /**
   * A mine: its model a little larger than its hit box so it reads at this size, with a thin red
   * ring about it that blinks with its light, so a mine stands out from the aliens it drifts among.
   */
  private makeMine(): Model {
    const model = this.kit.create('mine');
    model.holder.scale.setScalar(MINE_SCALE);
    const halo = new Mesh(new RingGeometry(5.6, 6.6, 10), new MeshBasicMaterial({ color: 0xc0392b }));
    halo.name = 'halo';
    halo.position.z = -1.5;
    model.holder.add(halo);
    return model;
  }

  /** An afterimage of a Warper: its model washed teal, hidden until a blink starts it. */
  private makeWarpGhost(): WarpGhost {
    const model = this.kit.create('warper');
    model.setLook(LOOK_WARP);
    model.holder.visible = false;
    this.scene.add(model.holder);
    return { model, age: WARP_GHOST_SECONDS };
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

  /** A ship model (the Breaker's by default) with its hull (not its flames) centred on the holder's origin. */
  private makeShipModel(ship: ShipId = 'breaker'): Model {
    const name = shipModelName(ship);
    const model = this.kit.create(name);
    model.body.position.y = -this.kit.hullCentreOf(name);
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
    this.arcs.clear();
    this.links.clear();
    this.mendGlow.clear();
    this.mineTracks.clear();
    this.mineViews?.clear();
    this.acid?.clear();
    for (const g of this.warpGhosts) {
      g.age = WARP_GHOST_SECONDS;
      g.model.holder.visible = false;
    }
    this.wellView?.clear();
    for (const views of this.ships) for (const view of Object.values(views)) view.model.holder.visible = false;
    this.hideBoss();
    this.bossDying = -1;
    this.bossBeams.clear();
    this.bunkers.clear();
    for (const g of this.ghosts) {
      g.age = SPLIT_SECONDS;
      g.model.holder.visible = false;
    }
    this.sectorSnap = true;
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
    this.mineTracks.begin();
    for (const m of run.mines) this.mineTracks.push(m.id, m.x, m.y);
    this.mineTracks.end();
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
    this.frame++;
    const enemyScale = enemyTimeScale(run);
    this.enemyScale = enemyScale;
    this.enemyTime += dt * enemyScale;
    this.drawSector(run, dt);
    this.look = run.freeze > 0 ? LOOK_FROZEN : run.slow > 0 ? LOOK_SLOW : LOOK_NORMAL;

    for (const e of events) this.playEvent(run, e);
    this.effects.update(dt);
    this.arcs.update(dt);
    this.wellView?.update(run.well, dt, this.time);
    this.bossShieldFlash = Math.max(0, this.bossShieldFlash - dt);

    this.stun.begin();
    this.drawShips(run, alpha, dt);
    this.drawBeams(run, alpha, dt);
    this.drawAliens(run, alpha, dt, enemyScale);
    this.links.update(dt);
    this.drawBoss(run, alpha, dt);
    this.stun.end();
    this.drawGhosts(dt);
    this.drawWarpGhosts(dt);
    this.drawMines(run, alpha);
    // On enemy time, so Time Stop freezes the rain and the warning flicker along with the sim's clocks.
    this.acid.update(run.acid, run.bunkers, this.enemyTime, dt * enemyScale);
    this.bunkers.update(run.bunkers);
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

  /**
   * Fades the whole look between the sectors' as the wave's sector changes: the sky, the nebula,
   * the stars' colour and the light. The blend is 0 for sector 1, 1 for sector 2 and 2 for sector
   * 3, so a fade always runs through the look in between. Snaps on the first frame and after a reset.
   */
  private drawSector(run: RunState, dt: number): void {
    const wave = WAVES[Math.min(run.wave, WAVES.length - 1)];
    const target = wave && wave.sector >= 2 ? wave.sector - 1 : 0;
    const before = this.sectorBlend;
    if (this.sectorSnap) {
      this.sectorBlend = target;
      this.sectorSnap = false;
    } else {
      const step = dt / SECTOR_FADE_SECONDS;
      this.sectorBlend += Math.max(-step, Math.min(step, target - this.sectorBlend));
    }
    if (this.sectorBlend === before && before === this.lastSectorApplied) return;
    this.lastSectorApplied = this.sectorBlend;
    const b = this.sectorBlend;
    this.stars.setSector(b);
    this.blendLight(this.hemi.color, HEMI_SKY, b);
    this.blendLight(this.hemi.groundColor, HEMI_GROUND, b);
    this.blendLight(this.sun.color, SUN, b);
  }

  /** Sets a light's colour to the look for sector blend `b` (0 to 2) from the sectors' colours. */
  private blendLight(out: Color, looks: readonly number[], b: number): void {
    const w = sectorWeights(b, this.lightWeights);
    out.setHex(looks[0]).multiplyScalar(w[0]);
    for (let i = 1; i < looks.length; i++) {
      this.lightColor.setHex(looks[i]).multiplyScalar(w[i]);
      out.add(this.lightColor);
    }
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
        if (p) {
          this.effects.shipHit(p.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
          const view = this.ships[p.id]?.[p.ship];
          if (view) view.flash = HIT_FLASH_SECONDS;
        }
        break;
      }
      case 'playerFired': {
        const p = run.players[e.playerId];
        const view = p ? this.ships[p.id]?.[p.ship] : undefined;
        if (view) view.muzzle = MUZZLE_SECONDS;
        break;
      }
      case 'chainSpark':
        // A jagged arc from one alien to the next, and a few sparks where it lands.
        this.arcs.add(e.fromX, e.fromY, e.toX, e.toY);
        this.effects.sparksIn(e.toX, e.toY, ARC_SPARK, 3, 38);
        break;
      case 'wellConsumed':
        // An enemy shot swallowed at the core: motes drawn in and a tiny pop.
        this.effects.implode(e.x, e.y, WELL_POP_RADIUS, 5, WELL_SPARK);
        this.effects.sparksIn(e.x, e.y, WELL_SPARK, 2, 20);
        break;
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
        if (e.part === 'core') this.effects.sparksIn(e.x, e.y, CORE_FIRE, 5, 60);
        else this.effects.sparks(e.x, e.y);
        break;
      case 'coreBlocked':
        // A shot (or the laser) the shielded core stopped: the shield flares.
        this.bossShieldFlash = 0.2;
        this.effects.sparksIn(e.x, e.y, SHIELD_SPARK, 5, 60);
        break;
      case 'bossPartDestroyed':
        if (e.part === 'segment') {
          // A ring segment shatters: shards fly outward from the core, through where it was.
          const boss = run.boss;
          this.effects.shatter(e.x, e.y, boss ? boss.x : e.x, boss ? boss.y : e.y, SEGMENT_SHARDS);
          this.effects.sparksIn(e.x, e.y, SEGMENT_SHARDS, 6, 60);
          break;
        }
        this.effects.partBurst(e.x, e.y);
        // The last plate: the core's shield pops and the bare core shows.
        if (e.part === 'plate' && run.boss && !platesStanding(run.boss)) {
          this.effects.coreBare(run.boss.x, run.boss.y);
          this.effects.sparksIn(run.boss.x, run.boss.y, SHIELD_SPARK, 10, 90);
        }
        break;
      case 'bossPhase':
        if (run.boss) {
          const red = run.boss.kind === 'hiveMind';
          this.effects.wave(run.boss.x, run.boss.y, 6, red ? 150 : 120, 0.45, 3, red ? 0xff5a5a : 0xff56da);
          this.effects.waveFlash(red ? 0xff5a5a : 0xff56da, 0.22, 0.35);
        }
        break;
      case 'bossKilled':
        this.bossDying = 0;
        if (e.kind === 'hiveMind') this.effects.bigExplosion(e.x, e.y, HIVE_BLAST_HALF_SIZE, HIVE_BLAST_HALF_SIZE, true);
        else this.effects.bigExplosion(e.x, e.y, BOSS_BLAST_HALF_WIDTH);
        break;
      case 'bunkerHit':
        this.effects.debris(e.x, e.y);
        break;
      case 'alienSplit':
        this.effects.splitBurst(e.x, e.y);
        this.startSplit(e.x, e.y);
        break;
      case 'formationSplit':
        // The formation tears in two: a subtle orange flash across the field.
        this.effects.waveFlash(0xff8a3d, 0.1, 0.25);
        break;
      case 'sectorStart':
        if (e.sector === 2) this.effects.waveFlash(0xff5a3c, 0.16, 0.7);
        else if (e.sector === 3) this.effects.waveFlash(0xc6f23c, 0.14, 0.7);
        break;
      case 'alienWarped':
        // The Warper vanishes from where it was (an afterimage and a trail of teal pixels) and lands at its new slot.
        this.effects.warpTrail(e.fromX, e.fromY, e.toX, e.toY);
        this.effects.warpArrived(e.toX, e.toY);
        this.startWarpGhosts(e.fromX, e.fromY, e.toX, e.toY);
        break;
      case 'mendPulse':
        // A green ring from the Mender, a link to each alien it healed, and its cross lights up.
        this.effects.mendRing(e.x, e.y);
        this.mendGlow.set(e.alienId, MEND_GLOW_SECONDS);
        for (const h of e.healed) {
          this.links.add(e.alienId, e.x, e.y, h.x, h.y);
          this.effects.mended(h.x, h.y);
        }
        break;
      case 'mineBurst':
        this.effects.mineBurst(e.x, e.y, e.radius, e.cause);
        break;
      case 'bossBeam':
        if (e.state === 'fire' && run.boss) this.effects.beamFlare(run.boss.x, run.boss.y);
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
    } else if (special === 'missileSwarm') {
      // The missiles leave the nose in a puff of exhaust.
      this.effects.sparksIn(x, y + SHIP_BOX_OFFSET_Y + 8, MISSILE_PUFF, 10, 75);
      this.effects.wave(x, y + SHIP_BOX_OFFSET_Y + 6, 4, 22, 0.25, 2, 0xffe164);
    } else if (special === 'gravityWell') {
      this.effects.sparksIn(x, y + SHIP_BOX_OFFSET_Y + 8, WELL_SPARK, 8, 60);
    } else if (special === 'timeStop') {
      this.effects.waveFlash(0x9dfafd, 0.25, 0.35);
      this.effects.wave(x, y, 4, 400, 0.55, 2, 0x52ddeb);
    }
  }

  private shipFor(index: number, id: ShipId): ShipView {
    const views = (this.ships[index] ??= {});
    let ship = views[id];
    if (!ship) {
      const model = this.makeShipModel(id);
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
      ship = views[id] = { id, model, shield, burst, bank: 0, flash: 0, muzzle: 0 };
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
    const ship = this.shipFor(p.id, p.ship);
    const { model } = ship;
    // A new run can fly another ship: only the model for the current one shows.
    const shown = this.shipShown[p.id];
    if (shown && shown !== ship) shown.model.holder.visible = false;
    this.shipShown[p.id] = ship;
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

    // Engine flames flicker; a hit flashes the hull white for a moment.
    const t = this.time;
    flicker(model, t);
    ship.flash = Math.max(0, ship.flash - dt);
    model.setFlash(ship.flash > 0);
    this.drawShipDetails(p, ship, dt);

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

  /**
   * The parts only some ships have: the Bastion's emitters glow and pulse while it has shield
   * hits left and go dark when they are spent, and the Lancer's muzzles flash white as it fires.
   */
  private drawShipDetails(p: PlayerState, ship: ShipView, dt: number): void {
    const { parts } = ship.model;
    if (parts.emitter_L || parts.emitter_R) {
      const live = p.shield > 0;
      const pulse = live ? 1.05 + 0.2 * Math.sin(this.time * 9) : 0.85;
      for (const name of EMITTERS) {
        ship.model.setPartWreck(name, !live);
        const node = parts[name];
        if (node) node.scale.setScalar(pulse);
      }
    }
    ship.muzzle = Math.max(0, ship.muzzle - dt);
    if (parts.muzzle_L || parts.muzzle_R) {
      const lit = ship.muzzle > 0 && ship.flash <= 0;
      for (const name of MUZZLES) {
        ship.model.setPartFlash(name, lit);
        const node = parts[name];
        if (node) node.scale.setScalar(lit ? 1.35 : 1);
      }
    }
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
    let flash = a.flash > 0;
    let look = this.look;
    if (a.kind === 'warper') {
      // Materialising after a blink: it grows into place, flashing white as it lands and then
      // flickering teal. (The slow field and Time Stop keep their own looks.)
      const progress = warpProgress(a.warp, WARP_SECONDS);
      model.holder.scale.setScalar(warpScale(progress));
      const tint = warpTint(progress, this.frame);
      if (tint === 'white') flash = true;
      else if (tint === 'teal' && look === LOOK_NORMAL) look = LOOK_WARP;
    }
    model.setFlash(flash);
    model.setLook(look);
    if (stunned && a.mode === 'formation') this.stun.add(x, y + 9, 5, 2, this.time, a.id * 1.3);
    // The pincer's halves rush in from the sides: each leaves a short trail of pixels behind it.
    if (known && a.mode === 'formation' && Math.abs(dx) > TRAIL_SPEED && (this.frame + a.id) % 3 === 0) {
      const side = dx > 0 ? -1 : 1;
      this.effects.trailPixel(x + side * 7, y + (((a.id * 7 + this.frame) % 5) - 2) * 2, PINCER_TRAIL[dx > 0 ? 0 : 1]);
    }

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
    } else if (a.kind === 'warper') {
      model.body.rotation.y = Math.sin(t * 1.4 + phase) * 0.22;
      // One that still has its blink flutters its prongs and keeps a wide, restless eye; one
      // that has used it hangs calmer, so the player can tell which Warpers will still jump.
      const spent = a.warped === true;
      const flutter = spent ? 0.06 : 0.2;
      if (parts.prong_L) parts.prong_L.rotation.z = Math.sin(t * 6 + phase) * flutter;
      if (parts.prong_R) parts.prong_R.rotation.z = -Math.sin(t * 6 + phase + 0.7) * flutter;
      if (parts.eye) parts.eye.scale.setScalar(spent ? 0.85 : 1 + 0.25 * Math.sin(t * 7 + phase));
      if (parts.core) parts.core.scale.setScalar(1 + 0.12 * Math.sin(t * 4 + phase));
    } else if (a.kind === 'mender') {
      model.body.rotation.y = Math.sin(t * 1.2 + phase) * 0.18;
      if (parts.pod_L) parts.pod_L.rotation.z = Math.sin(t * 2.4 + phase) * 0.12;
      if (parts.pod_R) parts.pod_R.rotation.z = -Math.sin(t * 2.4 + phase + 0.5) * 0.12;
      if (parts.leg_L) parts.leg_L.rotation.z = Math.sin(t * 3 + phase) * 0.18;
      if (parts.leg_R) parts.leg_R.rotation.z = -Math.sin(t * 3 + phase + 1) * 0.18;
      this.drawMenderCross(a, model, dt);
      // Its links follow it as the formation marches.
      this.links.follow(a.id, x, y);
    } else if (a.kind === 'splitter') {
      model.body.rotation.y = Math.sin(t * 1.5 + phase) * 0.22;
      // The two halves chomp a little, and the seam between them glows and throbs.
      const chomp = Math.sin(t * 4 + phase) * 0.06;
      if (parts.half_L) parts.half_L.rotation.z = chomp;
      if (parts.half_R) parts.half_R.rotation.z = -chomp;
      if (parts.seam) parts.seam.scale.set(1 + 0.12 * Math.sin(t * 7 + phase), 1 + 0.08 * Math.sin(t * 7 + phase), 1);
    } else if (a.kind === 'mini') {
      // A mini always flies free: it tips into its fall and scuttles.
      model.body.rotation.y = Math.sin(t * 2.4 + phase) * 0.3;
      model.holder.rotation.z = -(a.vx ?? 0) * 0.014;
      if (parts.leg_0) parts.leg_0.rotation.z = Math.sin(t * 16 + phase) * 0.5;
      if (parts.leg_1) parts.leg_1.rotation.z = -Math.sin(t * 16 + phase + 1.5) * 0.5;
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

  /**
   * A Mender's white cross breathes; as its pulse nears it blinks white, faster and faster, and
   * for a moment after the pulse it burns white and swollen.
   */
  private drawMenderCross(a: Alien, model: Model, dt: number): void {
    const cross = model.parts.cross;
    if (!cross) return;
    let glow = this.mendGlow.get(a.id) ?? 0;
    if (glow > 0) {
      glow -= dt;
      if (glow > 0) this.mendGlow.set(a.id, glow);
      else this.mendGlow.delete(a.id);
    }
    const left = a.mendTimer ?? MEND_CHARGE_SECONDS + 1;
    const charging = left < MEND_CHARGE_SECONDS && a.mode === 'formation';
    const blink = charging && Math.floor(this.time * (8 + 14 * (1 - left / MEND_CHARGE_SECONDS))) % 2 === 0;
    model.setPartFlash('cross', glow > 0 || blink);
    cross.scale.setScalar(glow > 0 ? 1.45 : 1 + 0.1 * Math.sin(this.enemyTime * 4 + a.id) + (charging ? 0.15 : 0));
  }

  /** A Warper blinked: afterimages at the spot it left and a third of the way along, shrinking and flickering teal. */
  private startWarpGhosts(fromX: number, fromY: number, toX: number, toY: number): void {
    for (let n = 0; n < 2; n++) {
      const g = this.warpGhosts[this.warpGhostCursor];
      this.warpGhostCursor = (this.warpGhostCursor + 1) % this.warpGhosts.length;
      g.age = n * 0.08;
      const u = n === 0 ? 0 : 0.33;
      g.model.holder.position.set(fromX + (toX - fromX) * u, fromY + (toY - fromY) * u, 0.5);
      g.model.holder.visible = true;
    }
  }

  private drawWarpGhosts(dt: number): void {
    for (const g of this.warpGhosts) {
      if (g.age >= WARP_GHOST_SECONDS) {
        g.model.holder.visible = false;
        continue;
      }
      g.age += dt;
      const scale = ghostScale(g.age);
      g.model.holder.visible = scale > 0 && Math.floor(g.age * 40) % 2 === 0;
      g.model.holder.scale.setScalar(scale);
    }
  }

  /** The mines: slowly turning, with a red light that blinks faster as the mine nears the ship's row. */
  private drawMines(run: RunState, alpha: number): void {
    this.mineViews.begin();
    // Enemy time: Time Stop stops the mines' turning and blinking, and the slow field slows them.
    const t = this.enemyTime;
    for (const m of run.mines) {
      const model = this.mineViews.acquire(m.id);
      const known = this.mineTracks.sample(m.id, alpha, this.sample);
      // In front of the aliens, so a mine drifting through the formation can be seen (and shot). The
      // tilted camera lifts anything above the field, so it is set down by the same amount.
      model.holder.position.set(known ? this.sample.x : m.x, (known ? this.sample.y : m.y) - MINE_Z * LIFT_PER_Z, MINE_Z);
      model.holder.rotation.z = t * 0.7 + m.id;
      model.body.rotation.y = Math.sin(t * 1.3 + m.id) * 0.35;
      // From the top of the field to the ship's row, 0 to 1.
      const near = Math.min(1, Math.max(0, (FIELD_HEIGHT / 2 - m.y) / (FIELD_HEIGHT / 2 + SHIP_Y)));
      const lit = Math.floor(t * (2.5 + 7 * near * near) + m.id) % 2 === 0;
      // The light is red and flashes white as it blinks; the red ring blinks with it.
      model.setPartFlash('light', lit);
      if (model.parts.light) model.parts.light.scale.setScalar(lit ? 1.7 : 1.3);
      const halo = model.holder.getObjectByName('halo');
      if (halo) halo.visible = lit;
      model.setLook(this.look);
    }
    this.mineViews.end();
  }

  /** A Splitter broke: its halves fly apart, tumbling and shrinking away as the minis come out. */
  private startSplit(x: number, y: number): void {
    // Two ghosts per split: the next left one and the next right one.
    for (let n = 0; n < 2; n++) {
      const i = (this.ghostCursor + n) % SPLIT_GHOSTS;
      const g = this.ghosts[i];
      g.age = 0;
      g.x = x;
      g.y = y;
      g.model.holder.visible = true;
    }
    this.ghostCursor = (this.ghostCursor + 2) % SPLIT_GHOSTS;
  }

  private drawGhosts(dt: number): void {
    for (const g of this.ghosts) {
      if (g.age >= SPLIT_SECONDS) {
        g.model.holder.visible = false;
        continue;
      }
      g.age += dt;
      const u = Math.min(1, g.age / SPLIT_SECONDS);
      // Fast out, easing off, with a tumble and a shrink over the last half.
      const dist = SPLIT_SPEED * SPLIT_SECONDS * (1 - (1 - u) * (1 - u));
      g.model.holder.position.set(g.x + g.side * dist, g.y - 6 * u * u, 0.5);
      g.model.holder.rotation.z = g.side * -u * 1.2;
      g.model.holder.scale.setScalar(u < 0.5 ? 1 : 1 - (u - 0.5) * 1.6);
    }
  }

  // The Brood Mother ----------------------------------------------------------------------------

  private hideBoss(): void {
    for (const model of Object.values(this.bossModels)) model.holder.visible = false;
    if (this.bossShield) this.bossShield.visible = false;
    this.bossBeams.clear();
  }

  private bossModelFor(kind: BossKind): Model {
    let model = this.bossModels[kind];
    if (!model) {
      model = this.kit.create(kind === 'hiveMind' ? 'hive_mind' : 'brood_mother');
      this.scene.add(model.holder);
      if (kind === 'hiveMind') {
        // The phase 3 glow: a red-pink disc and ring behind the core.
        const glow = new Group();
        glow.add(
          new Mesh(new CircleGeometry(14, 12), new MeshBasicMaterial({ color: 0x8f2a8a })),
          new Mesh(new RingGeometry(14, 16.5, 12), new MeshBasicMaterial({ color: 0xff56da })),
        );
        glow.position.z = -2;
        glow.visible = false;
        model.holder.add(glow);
        this.hiveGlow = glow;
      } else {
        const shield = hexShell(8.6, 0x9dfafd, 0x52ddeb, 0.2);
        shield.position.z = 10.6;
        model.holder.add(shield);
        this.bossShield = shield;
      }
      this.bossModels[kind] = model;
    }
    return model;
  }

  /** Puts a fresh boss model in order for a new boss: every part whole, nothing flashing. */
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

    // Only the model for this kind of boss shows.
    for (const [kind, other] of Object.entries(this.bossModels)) if (kind !== boss.kind) other.holder.visible = false;
    const model = this.bossModelFor(boss.kind);
    if (this.bossPartsRef !== boss.parts) this.resetBossModel(model, boss);
    model.holder.visible = true;
    const known = this.bossTrack.sample(0, alpha, this.sample);
    const x = known ? this.sample.x : boss.x;
    const y = known ? this.sample.y : boss.y;
    model.holder.position.set(x, y, 0);

    const dying = this.bossDying >= 0;
    if (boss.kind === 'hiveMind') this.drawHive(run, boss, model, x, y, dying, dead, dt);
    else this.drawBrood(boss, model, dying, dead);
    model.setLook(this.look);

    if (boss.stun > 0 && !dying) this.stun.add(x, y + (boss.kind === 'hiveMind' ? 30 : 17), boss.kind === 'hiveMind' ? 28 : 38, 7, this.time, 0);
  }

  private drawBrood(boss: BossState, model: Model, dying: boolean, dead: boolean): void {
    const t = this.enemyTime;
    const parts = model.parts;
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
  }

  /**
   * The Hive Mind: the ring's eight segments turn about the core with the sim's `ringAngle` (a
   * destroyed one is hidden), the spikes drift the other way, the core pulses harder each phase
   * and glows in phase 3, and the beams are drawn from the core.
   */
  private drawHive(run: RunState, boss: BossState, model: Model, x: number, y: number, dying: boolean, dead: boolean, dt: number): void {
    const t = this.enemyTime;
    const parts = model.parts;
    const ring = boss.ringAngle ?? 0;
    for (let i = 0; i < boss.parts.length; i++) {
      const part = boss.parts[i];
      const node = parts[this.bossNames[i]];
      if (node && part.kind === 'segment') {
        // Destroyed segments stay gone, even through the death flicker.
        node.visible = part.hp > 0;
        node.rotation.z = ring;
      }
    }
    if (dying) {
      model.setFlash(Math.floor(this.bossDying * 12) % 3 === 0);
    } else {
      for (let i = 0; i < boss.parts.length; i++) {
        const part = boss.parts[i];
        model.setPartFlash(this.bossNames[i], part.flash > 0 && part.hp > 0);
      }
      const pulse = hiveCorePulse(boss.phase, t);
      if (parts.core) parts.core.scale.setScalar(pulse);
      if (parts.core_eye) parts.core_eye.scale.setScalar(2 - pulse);
      for (let i = 0; i < 6; i++) {
        const spike = parts[`spike_${i}`];
        if (spike) spike.rotation.z = -t * SPIKE_TURN;
      }
    }
    const glow = this.hiveGlow;
    if (glow) {
      const size = dying ? 0 : hiveGlowScale(boss.phase, this.time);
      glow.visible = size > 0;
      glow.scale.setScalar(size);
    }

    // Beams: dashed warnings and firing bars, from the core; a firing one stops where the sim stops it.
    const beams = this.bossBeams;
    beams.begin();
    if (!dead && boss.beams) {
      const scaled = dt * (this.enemyScale > 0 ? 1 : 0);
      const contacts = beamBunkerContacts(boss, run.bunkers, this.contacts);
      for (let i = 0; i < boss.beams.length; i++) {
        const beam = boss.beams[i];
        if (beam.state === 'warn') {
          beams.warn(x, y, beam.angle, beam.timeLeft, scaled);
          continue;
        }
        let hit: BeamContact | null = null;
        for (const c of contacts) if (c.beam === i) hit = c;
        const length = hit ? Math.hypot(hit.x - x, hit.y - y) : rayToFieldEdge(x, y, beam.angle);
        beams.fire(x, y, beam.angle, length, hit !== null, this.time, scaled);
      }
    }
    beams.end();
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
    if (s.kind === 'missile') return this.missileShots;
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
    if (s.kind === 'missile') {
      this.drawMissile(model, s, known ? this.sample.x : s.x, known ? this.sample.y : s.y);
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

  /** A missile points along its flight, its exhaust flickers and stretches, and it leaves a trail. */
  private drawMissile(model: Model, s: Shot, x: number, y: number): void {
    model.holder.rotation.z = missileAngle(s.vx, s.vy, model.holder.rotation.z);
    const exhaust = model.parts.exhaust;
    if (exhaust) exhaust.scale.set(1, exhaustScale(this.time, s.id), 1);
    if (dropsTrail(this.frame, s.id)) this.effects.missileTrail(x, y, s.vx, s.vy);
  }
}

const EMITTERS = ['emitter_L', 'emitter_R'] as const;
const MUZZLES = ['muzzle_L', 'muzzle_R'] as const;

/** Blasts at least this big (the Pulse Bomb's field-wide one) are played by their Special, not as a bomb-on-kill burst. */
const BIG_BLAST = 100;
/** Half the Brood Mother's width, for scattering its death bursts across its body. */
const BOSS_BLAST_HALF_WIDTH = 46;
/** Half the Hive Mind's span (its spikes reach 42 from the centre), for scattering its death bursts. */
const HIVE_BLAST_HALF_SIZE = 34;
const BAY_SPARK: readonly number[] = [0xffb04f, 0xffe164, 0xffffff];
const MISSILE_PUFF: readonly number[] = [0xffe164, 0xff8a45, 0xffffff];
const CORE_FIRE: readonly number[] = [0xff56da, 0xffffff, 0xff8a45];

/** Flickers a ship model's two engine flames. */
function flicker(model: Model, t: number): void {
  const { flame_L, flame_R } = model.parts;
  if (flame_L) flame_L.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38) + 0.1 * Math.sin(t * 61), 1);
  if (flame_R) flame_R.scale.set(1, 0.8 + 0.3 * Math.sin(t * 38 + 2) + 0.1 * Math.sin(t * 53), 1);
}
