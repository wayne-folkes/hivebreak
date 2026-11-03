import type { Frame, Rgb } from './frame';
import type { KeyMode } from './keys';
import { ART_PER_PX_X, ART_PER_PX_Y, FIELD_COLS, FIELD_PX_H, FIELD_PX_W, FIELD_ROWS, PANEL_COLS, toArt, toPixel } from './layout';
import type { Layout } from './layout';
import { Effects, edgeGlow, washField } from './effects';
import {
  ALIEN_SPRITES,
  Canvas,
  HELPER_SPRITE,
  SHIP_COLOUR,
  SHIP_FLAMES,
  SHIP_SPRITES,
  WINGMAN_SPRITE,
  alienPalette,
  darken,
  drawSprite,
  drawSpriteCentred,
  lighten,
  mix,
  shipPalette,
  spriteWidth,
} from './sprites';
import { ALIEN_SPECS } from '../src/game/aliens';
import { bunkerPixelSolid } from '../src/game/bunkers';
import { BOSS_HALF_WIDTH, bossHealth, partBox, platesStanding } from '../src/game/boss';
import { beamBunkerContacts } from '../src/game/hivemind';
import {
  HIVE_CORE_RADIUS,
  HIVE_RING_INNER,
  HIVE_RING_OUTER,
  HIVE_SEGMENT_ARC,
  HIVE_SEGMENT_COUNT,
  HIVE_SEGMENT_SPACING,
  HIVE_SPIKE_RADIUS,
} from '../src/game/hivemind';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../src/game/playfield';
import { SHIP_TOP, SHIP_Y, SHIP_BOX_OFFSET_Y, isAlive, wingmanXs } from '../src/game/player';
import { hasPowerUp, helperPosition } from '../src/game/powerups';
import { WAVE_INTRO_SECONDS } from '../src/game/run';
import { SHIPS } from '../src/game/ships';
import { isBursting } from '../src/game/special';
import { synergyDef } from '../src/game/synergies';
import { upgradeDef } from '../src/game/upgrades';
import { WELL_RADIUS, WELL_SECONDS } from '../src/game/well';
import type { Box, BossPart, BossState, PlayerState, PowerUpKind, RunEvent, RunState, Sector, Shot, SpecialId } from '../src/game/types';
import {
  BOSS_NAMES,
  bossBarLabel,
  bossPhaseLabel,
  comboLabel,
  formatScore,
  meterCells,
  powerUpChips,
  sectorBanner,
  SPECIAL_SHORT,
  summarizeUpgrades,
  synergyToast,
  waveLabel,
  waveSector,
} from '../src/ui/format';
import { WAVES, WAVE_COUNT } from '../src/game/waves';

// Draws a run into the terminal frame: the field (aliens, the ship, shots, bunkers, the bosses,
// pickups, beams, the gravity well, effects), the walls, the status lines and the side panels,
// plus the run's banners (wave, sector, boss phase, synergy unlocked).
//
// The field is 60 x 80 terminal pixels (3 x 4 art pixels each). Everything here works in those
// pixels, converting from the simulation's art-pixel coordinates with toPixel; every draw clips
// to the field, so nothing off the edge can spill onto the walls or status lines.

export interface HudInfo {
  /** The best score on record. */
  best: number;
  /** The title's demo run: no status lines or panels, just the field. */
  demo: boolean;
  /** Fire is on without holding a key. */
  autofire: boolean;
  keyMode: KeyMode;
}

// Colours ---------------------------------------------------------------------------------------

const INK = 0xece8ff;
const MUTED = 0x9a92c4;
const FAINT = 0x5b52a0;
const BAR_BG = 0x0c0918;
const ACCENT = 0xff4fd8;
const PILOT = 0x4ff0ff;
const WARM = 0xffb04f;
const DANGER = 0xff6b6b;
const GOLD = 0xffe14f;

/** The sky at the top and bottom of the field, by situation: a faint gradient gives it depth. */
const SKY = { normal: [0x07040f, 0x1a1030], red: [0x12040a, 0x2e0a16], frozen: [0x06142a, 0x12405c], slow: [0x0c0820, 0x2c1a66] } as const;
const WALL = { normal: 0x2c2450, red: 0x4a0f24 } as const;

export const POWER_UP_COLOUR: Record<PowerUpKind, Rgb> = { spread: 0xffb04f, laser: 0x4ff0ff, slow: 0x9b7bff, helper: 0x4fff9b };
const POWER_UP_LETTER: Record<PowerUpKind, string> = { spread: 'S', laser: 'L', slow: 'T', helper: 'H' };
const POWER_UP_WORD: Record<PowerUpKind, string> = { spread: 'SPR', laser: 'LSR', slow: 'SLW', helper: 'HLP' };

const BUNKER_BODY = 0x3fd6a0;
const BUNKER_TOP = 0x7af0c8;
const BUNKER_UNDER = 0x1f7a66;

const FIRE = [0xffffff, 0xfff27a, 0xffd36a, 0xff8a45, 0xc0392b];
const SHIP_BURST = [0xffffff, 0x9ffbff, 0x4ff0ff, 0xffd36a, 0xff6a3d];
const DEATH_BURST = [0xffffff, 0xfff27a, 0xffd36a, 0xff8a45, 0xff56da, 0xac55f7];
const WELL_SPARK = [0xffffff, 0xff56da, 0xac55f7, 0x9b7bff];
const ARC_COLOURS = [0xffffff, 0x9dfafd, 0x52ddeb];

/** A kill's sparks: white, then the alien's own hues. */
function killColours(kind: keyof typeof ALIEN_SPRITES): Rgb[] {
  const base = alienPalette(kind, 1, 1, false);
  return [0xffffff, lighten(base.b, 0.4), base.b, base.d];
}

// Starfield -------------------------------------------------------------------------------------

interface Star {
  x: number;
  y: number;
  layer: 0 | 1 | 2;
  phase: number;
}

/** Pixels per second each layer scrolls down, and its colours (cool for sector 1, warm for sector 2). */
const STAR_LAYERS = [
  { speed: 1.5, count: 28, cool: 0x342d66, warm: 0x6b2a3a },
  { speed: 3.2, count: 18, cool: 0x5b52a0, warm: 0xa8503f },
  { speed: 6.5, count: 9, cool: 0x8f86c9, warm: 0xd9826b },
] as const;

/** Stars from a fixed seed, so the field looks the same every run. */
function makeStars(): Star[] {
  let seed = 0x2f6e2b1;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars: Star[] = [];
  STAR_LAYERS.forEach((layer, i) => {
    for (let n = 0; n < layer.count; n++) stars.push({ x: Math.floor(next() * FIELD_PX_W), y: next() * FIELD_PX_H, layer: i as 0 | 1 | 2, phase: next() * 6.28 });
  });
  return stars;
}

// Banners ---------------------------------------------------------------------------------------

interface Banner {
  title: string;
  sub: string | null;
  /** The title bar's background. */
  bar: Rgb;
  /** The field row (from the top) the banner is centred on. */
  row: number;
  age: number;
  life: number;
  /** Space the title's letters out (the short, loud banners). */
  letterSpaced: boolean;
}

type BannerSlot = 'wave' | 'phase' | 'synergy';
const BANNER_ROWS: Record<BannerSlot, number> = { wave: 15, phase: 21, synergy: 27 };
const PHASE_SECONDS = 1.8;
const SYNERGY_SECONDS = 2.2;

// The view --------------------------------------------------------------------------------------

/** What the field is doing to the world right now: sector tint, Time Stop, slow field, stun. */
interface Mood {
  sector: Sector;
  frozen: boolean;
  slowed: boolean;
  stunned: boolean;
  /** Tints an enemy-side colour for the frozen / slowed / stunned looks. */
  tint: (c: Rgb) => Rgb;
  time: number;
}

export class FieldView {
  private fx = new Effects();
  private stars = makeStars();
  private starTime = 0;
  private banners = new Map<BannerSlot, Banner>();
  /** Seconds each player's ship flashes white after a hit. */
  private shipFlash = new Map<number, number>();
  private edge = { colour: 0xff2a2a, alpha: 0, age: 0, life: 0 };
  private wash = { colour: 0xffffff, alpha: 0, age: 0, life: 0 };

  /** Forgets effects and banners, for a new run. */
  reset(): void {
    this.fx.clear();
    this.banners.clear();
    this.shipFlash.clear();
    this.edge.alpha = 0;
    this.wash.alpha = 0;
  }

  /** The effects, for tests. */
  get effectCount(): number {
    return this.fx.count;
  }

  /** The banners showing now, by slot, for tests. */
  get bannerTitles(): string[] {
    return [...this.banners.values()].map((b) => b.title);
  }

  /** One frame's events (explosions, hit flashes, banners). `run` is the run after them. */
  events(events: readonly RunEvent[], run: RunState): void {
    const fx = this.fx;
    const sectorStart = events.find((e) => e.type === 'sectorStart');
    for (const e of events) {
      switch (e.type) {
        case 'waveStart': {
          const sector = sectorStart && sectorStart.type === 'sectorStart' ? sectorBanner(sectorStart.sector) : null;
          const def = WAVES[Math.min(Math.max(0, e.wave), WAVES.length - 1)];
          if (sector) {
            this.banner('wave', sector.title, sector.sub, 0xa8203c, WAVE_INTRO_SECONDS);
            this.flashWash(0xff5a3c, 0.16, 0.7);
          } else {
            const boss = def?.boss ? `BOSS: ${BOSS_NAMES[def.boss].toUpperCase()}` : null;
            this.banner('wave', `WAVE ${e.wave + 1}`, boss, def?.boss ? 0xa8203c : 0x6a1a8a, WAVE_INTRO_SECONDS);
          }
          break;
        }
        case 'bossPhase': {
          const kind = run.boss?.kind;
          const label = kind ? bossPhaseLabel(kind, e.phase) : null;
          this.banner('phase', label ?? `PHASE ${e.phase}`, kind ? BOSS_NAMES[kind].toUpperCase() : null, 0xa8203c, PHASE_SECONDS);
          this.flashWash(0xff5a5a, 0.22, 0.4);
          break;
        }
        case 'synergyUnlocked': {
          const t = synergyToast(e.synergy);
          this.banner('synergy', t.text, t.sub, 0x8a6a10, SYNERGY_SECONDS);
          break;
        }
        case 'alienHit': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 2, speed: 14, life: 0.18, colours: [0xffffff, 0xfff27a] });
          break;
        }
        case 'alienKilled': {
          const p = toPixel(e.x, e.y);
          const size = ALIEN_SPECS[e.kind].hp;
          fx.burst({ x: p.px, y: p.py, count: 7 + size * 3, speed: 22 + size * 3, life: 0.5, colours: killColours(e.kind), spreadX: 1.5, spreadY: 1 });
          fx.ring(p.px, p.py, 3, 10 + size * 2, 0.2, 0xfff27a);
          break;
        }
        case 'alienSplit': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 8, speed: 20, life: 0.35, colours: [0xff8a3d, 0xffe14f, 0xc0392b, 0xffffff] });
          break;
        }
        case 'blast': {
          const p = toPixel(e.x, e.y);
          fx.ring(p.px, p.py, e.radius * 0.3, e.radius, 0.3, 0xffd36a);
          fx.burst({ x: p.px, y: p.py, count: 10, speed: 28, life: 0.4, colours: FIRE });
          break;
        }
        case 'chainSpark': {
          const a = toPixel(e.fromX, e.fromY);
          const b = toPixel(e.toX, e.toY);
          fx.arc(a.px, a.py, b.px, b.py, 0.16, ARC_COLOURS);
          break;
        }
        case 'bossPartHit':
        case 'coreBlocked': {
          const p = toPixel(e.x, e.y);
          const blocked = e.type === 'coreBlocked';
          fx.burst({ x: p.px, y: p.py, count: blocked ? 4 : 3, speed: 16, life: 0.2, colours: blocked ? [0xffffff, 0x9dfafd, 0x52ddeb] : [0xffffff, 0xfff27a, 0xffb04f] });
          break;
        }
        case 'bossPartDestroyed': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 26, speed: 34, life: 0.7, colours: FIRE, spreadX: 3, spreadY: 1.5 });
          fx.ring(p.px, p.py, 6, 40, 0.35, 0xff8a45);
          break;
        }
        case 'bossKilled': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 110, speed: 52, life: 1.2, colours: DEATH_BURST, spreadX: 14, spreadY: 4, drag: 1.1 });
          fx.ring(p.px, p.py, 8, 130, 0.55, 0xffffff);
          fx.ring(p.px, p.py, 4, 100, 0.65, 0xff56da, 0.12);
          fx.ring(p.px, p.py, 2, 70, 0.7, 0xff8a45, 0.24);
          this.flashWash(0xffffff, 0.55, 0.45);
          break;
        }
        case 'playerHit': {
          const player = run.players[e.playerId];
          this.shipFlash.set(e.playerId, 0.45);
          this.edge = { colour: 0xff2a2a, alpha: 0.75, age: 0, life: 0.5 };
          if (player) {
            const p = toPixel(player.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
            fx.burst({ x: p.px, y: p.py, count: e.livesLeft <= 0 ? 60 : 16, speed: e.livesLeft <= 0 ? 40 : 26, life: 0.8, colours: SHIP_BURST, spreadX: 2, spreadY: 1.5 });
            if (e.livesLeft <= 0) fx.ring(p.px, p.py, 6, 60, 0.5, 0xffffff);
          }
          break;
        }
        case 'shieldHit': {
          const player = run.players[e.playerId];
          if (!player) break;
          const p = toPixel(player.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
          fx.burst({ x: p.px, y: p.py - 1, count: 10, speed: 22, life: 0.3, colours: [0xffffff, 0x9dfafd, 0x52ddeb] });
          fx.ring(p.px, p.py, 8, 20, 0.2, 0x9dfafd);
          break;
        }
        case 'bunkerHit': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 3, speed: 9, life: 0.35, colours: [0x7af0c8, 0x3fd6a0, 0x1f7a66], gravity: 18 });
          break;
        }
        case 'shotReflected': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 6, speed: 18, life: 0.25, colours: [0xffffff, 0x9dfafd, 0x52ddeb] });
          fx.ring(p.px, p.py, 3, 12, 0.18, 0x9dfafd);
          break;
        }
        case 'wellConsumed': {
          const p = toPixel(e.x, e.y);
          fx.burst({ x: p.px, y: p.py, count: 8, speed: 14, life: 0.4, colours: WELL_SPARK });
          break;
        }
        case 'pickupCollected': {
          const player = run.players[e.playerId];
          if (!player) break;
          const p = toPixel(player.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
          const c = POWER_UP_COLOUR[e.kind];
          fx.burst({ x: p.px, y: p.py, count: 12, speed: 24, life: 0.45, colours: [0xffffff, c, darken(c, 0.4)] });
          fx.ring(p.px, p.py, 6, 26, 0.3, c);
          break;
        }
        case 'specialFired':
          this.specialEffect(e.special, e.x, e.y);
          break;
        default:
          break;
      }
    }
  }

  private specialEffect(special: SpecialId, x: number, y: number): void {
    const fx = this.fx;
    const p = toPixel(x, y);
    switch (special) {
      case 'pulseBomb':
        fx.ring(p.px, p.py, 6, 400, 0.6, 0xd3f1ff);
        fx.ring(p.px, p.py, 4, 300, 0.7, 0x52ddeb, 0.08);
        this.flashWash(0x9dfafd, 0.25, 0.35);
        break;
      case 'shieldBurst':
        fx.ring(p.px, p.py, 8, 36, 0.35, 0x9dfafd);
        fx.burst({ x: p.px, y: p.py, count: 16, speed: 22, life: 0.5, colours: [0xffffff, 0x9dfafd, 0x52ddeb] });
        break;
      case 'timeStop':
        fx.ring(p.px, p.py, 6, 380, 0.7, 0xffffff);
        this.flashWash(0xd3f1ff, 0.4, 0.45);
        break;
      case 'missileSwarm':
        fx.burst({ x: p.px, y: p.py - 3, count: 22, speed: 34, life: 0.5, colours: [0xffffff, 0xffe164, 0xff8a45], angle: Math.PI / 2, cone: Math.PI * 0.9 });
        fx.ring(p.px, p.py, 4, 24, 0.25, 0xffe164);
        break;
      case 'gravityWell':
        fx.ring(p.px, p.py, 50, 6, 0.45, 0xac55f7);
        fx.burst({ x: p.px, y: p.py, count: 16, speed: 24, life: 0.5, colours: WELL_SPARK });
        break;
    }
  }

  private banner(slot: BannerSlot, title: string, sub: string | null, bar: Rgb, life: number): void {
    this.banners.set(slot, { title, sub, bar, row: BANNER_ROWS[slot], age: 0, life, letterSpaced: slot !== 'synergy' });
  }

  private flashWash(colour: Rgb, alpha: number, life: number): void {
    this.wash = { colour, alpha, age: 0, life };
  }

  /** Draws everything for this run; `dt` is the seconds since the last draw (0 while paused). */
  draw(frame: Frame, layout: Layout, run: RunState, hud: HudInfo, dt: number): void {
    dt = Number.isFinite(dt) ? Math.min(0.25, Math.max(0, dt)) : 0;
    this.age(dt, run);

    const cv = new Canvas(frame, layout.fieldCol, layout.fieldRow * 2);
    const mood = this.mood(run);

    this.drawBackground(cv, mood);
    this.drawWell(cv, run);
    this.drawBossBeams(cv, run, mood);
    this.drawBunkers(cv, run);
    this.drawPickups(frame, layout, run, mood.time);
    this.drawLasers(cv, run);
    this.drawAliens(cv, run, mood);
    this.drawBoss(cv, run, mood);
    for (const player of run.players) this.drawShip(cv, run, player);
    this.drawShots(cv, run, mood);
    this.fx.draw(cv);
    this.drawFlashes(cv, mood);

    if (hud.demo) return;
    this.drawWalls(frame, layout, mood);
    this.drawTopLine(frame, layout, run, hud);
    this.drawBottomLine(frame, layout, run, hud);
    this.drawBossBar(frame, layout, run);
    this.drawLeftPanel(frame, layout, run);
    this.drawRightPanel(frame, layout, hud);
    this.drawBanners(frame, layout);
  }

  private age(dt: number, run: RunState): void {
    this.fx.update(dt);
    // Time Stop freezes the stars, the slow power-up halves them.
    this.starTime += dt * (run.freeze > 0 ? 0 : run.slow > 0 ? 0.5 : 1);
    for (const [slot, b] of this.banners) {
      b.age += dt;
      if (b.age >= b.life) this.banners.delete(slot);
    }
    for (const [id, t] of this.shipFlash) {
      if (t - dt <= 0) this.shipFlash.delete(id);
      else this.shipFlash.set(id, t - dt);
    }
    this.edge.age += dt;
    this.wash.age += dt;
  }

  private mood(run: RunState): Mood {
    const frozen = run.freeze > 0;
    const slowed = !frozen && run.slow > 0;
    const stunned = run.stun > 0 || (run.boss?.stun ?? 0) > 0;
    const flicker = Math.floor(run.time * 14) % 2 === 0;
    const tint = (c: Rgb): Rgb => {
      if (frozen) return mix(c, 0x9dfafd, 0.5);
      if (stunned && flicker) return mix(c, 0xffe164, 0.55);
      if (slowed) return mix(c, 0x9b7bff, 0.35);
      return c;
    };
    return { sector: waveSector(run.wave), frozen, slowed, stunned, tint, time: run.time };
  }

  // Field ---------------------------------------------------------------------------------------

  private drawBackground(cv: Canvas, m: Mood): void {
    const [top, bottom] = m.frozen ? SKY.frozen : m.slowed ? SKY.slow : m.sector === 2 ? SKY.red : SKY.normal;
    for (let y = 0; y < FIELD_PX_H; y++) {
      const t = y / (FIELD_PX_H - 1);
      const c = mix(top, bottom, t * t * 0.7);
      for (let x = 0; x < FIELD_PX_W; x++) cv.set(x, y, c);
    }
    for (const s of this.stars) {
      const layer = STAR_LAYERS[s.layer];
      const y = (s.y + this.starTime * layer.speed) % FIELD_PX_H;
      let c: Rgb = m.sector === 2 && !m.frozen && !m.slowed ? layer.warm : layer.cool;
      if (m.frozen) c = mix(c, 0xd3f1ff, 0.55);
      else if (m.slowed) c = mix(c, 0x52ddeb, 0.5);
      // The near stars twinkle.
      if (s.layer === 2) c = mix(darken(c, 0.35), c, 0.5 + 0.5 * Math.sin(m.time * 3 + s.phase));
      cv.set(s.x, y, c);
    }
  }

  private drawWell(cv: Canvas, run: RunState): void {
    const well = run.well;
    if (!well) return;
    const { px, py } = toPixel(well.x, well.y);
    const age = WELL_SECONDS - well.timeLeft;
    const grow = Math.min(1, Math.max(0, age / 0.25));
    const collapse = Math.min(1, Math.max(0, well.timeLeft / 0.3));
    const scale = grow * collapse * collapse;
    if (scale <= 0) return;
    const t = run.time;
    const put = (ax: number, ay: number, c: Rgb, alpha = 1) => cv.blend(px + ax / ART_PER_PX_X, py - ay / ART_PER_PX_Y, c, alpha);

    // The pull's reach: a faint ring of dashes turning slowly.
    const reach = WELL_RADIUS * scale;
    for (let i = 0; i < 48; i++) {
      if ((i + Math.floor(t * 6)) % 3 !== 0) continue;
      const a = (i / 48) * Math.PI * 2;
      put(Math.cos(a) * reach, Math.sin(a) * reach, 0x5b3fd0, 0.7);
    }
    // Four spiral arms winding into the core, bright near the middle.
    for (let arm = 0; arm < 4; arm++) {
      for (let r = 7; r < 46; r += 0.9) {
        const a = arm * (Math.PI / 2) + t * 2.6 - r * 0.11;
        const u = (r - 7) / 39;
        const c = u < 0.25 ? 0xffffff : u < 0.55 ? 0xff56da : u < 0.8 ? 0xac55f7 : 0x5b3fd0;
        put(Math.cos(a) * r * scale, Math.sin(a) * r * scale, c, 1 - u * 0.55);
      }
    }
    // The core: a dark disc with a bright rim that throbs.
    const rim = (7 + Math.sin(t * 9) * 1.2) * scale;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      put(Math.cos(a) * rim, Math.sin(a) * rim, 0xffffff);
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cv.set(px + dx, py + dy, 0x07040f);
  }

  private drawBunkers(cv: Canvas, run: RunState): void {
    for (const b of run.bunkers) {
      // The bunker snaps to the pixel grid (20 x 10 art pixels become 7 x 3 terminal pixels), so
      // it keeps one shape wherever it sits. Each terminal pixel is how much of its patch of the
      // mask is left: solid while most of it stands, rubble when little does, gone when almost nothing.
      const w = Math.max(1, Math.round(b.width / ART_PER_PX_X));
      const h = Math.max(1, Math.round(b.height / ART_PER_PX_Y));
      const left = Math.round(toPixel(b.x, 0).px + (b.width / ART_PER_PX_X - w) / 2);
      const top = Math.round(toPixel(0, b.y + b.height).py + (b.height / ART_PER_PX_Y - h) / 2);
      const solid = new Float32Array(w * h);
      const total = new Float32Array(w * h);
      for (let row = 0; row < b.height; row++) {
        const cy = h - 1 - Math.min(h - 1, Math.floor((row * h) / b.height));
        for (let col = 0; col < b.width; col++) {
          const i = cy * w + Math.min(w - 1, Math.floor((col * w) / b.width));
          total[i]++;
          if (bunkerPixelSolid(b, col, row)) solid[i]++;
        }
      }
      const cover = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : solid[y * w + x] / Math.max(1, total[y * w + x]));
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const c = cover(x, y);
          if (c < 0.3) continue;
          const exposed = cover(x, y - 1) < 0.3;
          const colour = c >= 0.85 ? (exposed ? BUNKER_TOP : BUNKER_BODY) : c >= 0.6 ? BUNKER_UNDER : darken(BUNKER_UNDER, 0.4);
          cv.set(left + x, top + y, colour);
        }
      }
    }
  }

  private drawPickups(frame: Frame, layout: Layout, run: RunState, time: number): void {
    for (const p of run.pickups) {
      const { px, py } = toPixel(p.x, p.y);
      // A pickup is three cells wide and one cell tall: the letter sits in the middle cell.
      const col = Math.round(px - 1.5);
      const row = Math.floor(py / 2);
      if (col < 0 || col + 2 >= FIELD_COLS || row < 0 || row >= FIELD_ROWS) continue;
      const base = POWER_UP_COLOUR[p.kind];
      const bright = mix(base, 0xffffff, 0.35 + 0.3 * Math.sin(time * 8 + p.id));
      const fc = layout.fieldCol + col;
      const fr = layout.fieldRow * 2 + row * 2;
      for (const dx of [0, 2]) {
        frame.pixel(fc + dx, fr, bright);
        frame.pixel(fc + dx, fr + 1, darken(base, 0.35));
      }
      frame.text(fc + 1, layout.fieldRow + row, POWER_UP_LETTER[p.kind], 0x07040f, bright, true);
    }
  }

  private drawLasers(cv: Canvas, run: RunState): void {
    for (const beam of run.beams) {
      const x = toPixel(beam.x, 0).px;
      const top = toPixel(0, beam.topY).py;
      const bottom = toPixel(0, SHIP_TOP).py;
      const flow = Math.floor(run.time * 40);
      for (let py = Math.floor(top); py < bottom; py++) {
        const k = (py + flow) % 3;
        cv.set(x, py, k === 0 ? 0xffffff : k === 1 ? 0x9dfafd : 0x52ddeb);
        if ((py + flow) % 2 === 0) {
          cv.blend(x - 1, py, 0x52ddeb, 0.55);
          cv.blend(x + 1, py, 0x52ddeb, 0.55);
        }
      }
      // Where it lands.
      cv.set(x, top, 0xffffff);
      cv.blend(x - 1, top, 0x9dfafd, 0.8);
      cv.blend(x + 1, top, 0x9dfafd, 0.8);
    }
  }

  private drawAliens(cv: Canvas, run: RunState, m: Mood): void {
    for (const a of run.aliens) {
      const spec = ALIEN_SPECS[a.kind];
      const frames = ALIEN_SPRITES[a.kind];
      const { px, py } = toPixel(a.x, a.y);
      const pal = alienPalette(a.kind, a.hp, spec.hp, a.flash > 0, m.tint);
      const frameIndex = Math.floor(run.time * 3) % 2;
      drawSpriteCentred(cv, frames[frameIndex], px, py, pal);
    }
  }

  private drawShip(cv: Canvas, run: RunState, player: PlayerState): void {
    if (!isAlive(player)) return;
    const { px, py } = toPixel(player.x, SHIP_Y + SHIP_BOX_OFFSET_Y);
    const bursting = isBursting(player);
    const colour = SHIP_COLOUR[player.ship];

    // A Shield Burst: a bright, pulsing bubble. Spare shield hits: a faint dotted one.
    if (bursting) {
      const pulse = 0.5 + 0.5 * Math.sin(run.time * 14);
      for (let y = -5; y <= 5; y++) {
        for (let x = -6; x <= 6; x++) {
          const d = Math.hypot(x / 5.2, y / 4);
          if (d <= 1) cv.blend(px + x, py + y, 0x52ddeb, 0.14);
          if (d > 0.82 && d <= 1.05) cv.blend(px + x, py + y, mix(0x52ddeb, 0xffffff, pulse), 0.9);
        }
      }
    } else if (player.shield > 0) {
      for (let i = 0; i < 20; i++) {
        if (i % 2 === 1) continue;
        const a = (i / 20) * Math.PI * 2;
        cv.blend(px + Math.cos(a) * 4.8, py + Math.sin(a) * 3.6, 0x52ddeb, 0.6);
      }
    }

    // Wingmen and the helper drone.
    for (const wx of wingmanXs(player)) {
      const w = toPixel(wx, SHIP_Y + SHIP_BOX_OFFSET_Y);
      drawSpriteCentred(cv, WINGMAN_SPRITE, w.px, w.py + 0.5, { h: lighten(colour, 0.4), b: darken(colour, 0.15), d: darken(colour, 0.5) });
    }
    if (hasPowerUp(player, 'helper')) {
      const h = helperPosition(player, run.time);
      const hp = toPixel(h.x, h.y);
      drawSpriteCentred(cv, HELPER_SPRITE, hp.px, hp.py, { h: 0xd3f1ff, b: 0x4fff9b, d: 0x1f9e63 });
    }

    const rows = SHIP_SPRITES[player.ship];
    const w = spriteWidth(rows);
    const left = Math.round(px - w / 2);
    const top = Math.round(py - rows.length / 2);
    const flashing = (this.shipFlash.get(player.id) ?? 0) > 0;
    // After a hit the ship blinks between full and dim while it can't be hurt.
    const blink = player.invulnerable > 0 && !bursting && Math.floor(run.time * 12) % 2 === 0;
    let pal = shipPalette(player.ship, blink ? (c) => darken(c, 0.65) : undefined);
    if (flashing && Math.floor(run.time * 20) % 2 === 0) pal = { h: 0xffffff, b: 0xffffff, d: 0xffffff, e: 0xffffff };
    drawSprite(cv, rows, left, top, pal);

    // Engine flames flicker below the hull.
    const flame = Math.floor(run.time * 24) % 2 === 0 ? 0xffd36a : 0xff6a3d;
    for (const col of SHIP_FLAMES[player.ship]) {
      cv.set(left + col, top + rows.length, blink ? darken(flame, 0.6) : flame);
      if (Math.floor(run.time * 24) % 3 === 0) cv.blend(left + col, top + rows.length + 1, 0xff6a3d, 0.5);
    }
  }

  private drawShots(cv: Canvas, run: RunState, m: Mood): void {
    for (const s of run.shots) this.drawShot(cv, s, m);
  }

  /**
   * One shot: a head pixel and a tail trailing back along its velocity, so even a fast shot is a
   * few pixels long and never vanishes between two frames.
   */
  private drawShot(cv: Canvas, s: Shot, m: Mood): void {
    const { px, py } = toPixel(s.x, s.y);
    if (!(px > -3 && px < FIELD_PX_W + 3 && py > -5 && py < FIELD_PX_H + 5)) return;
    const vx = s.vx / ART_PER_PX_X;
    const vy = -s.vy / ART_PER_PX_Y;
    const speed = Math.hypot(vx, vy);
    // The direction it travels in; a still shot points the way its side fires.
    const ux = speed > 1e-6 ? vx / speed : 0;
    const uy = speed > 1e-6 ? vy / speed : s.owner === 'player' ? -1 : 1;
    // Sideways, for the wide shots.
    const sx = Math.round(-uy);
    const sy = Math.round(ux);
    const hx = Math.floor(px);
    const hy = Math.floor(py);
    const put = (i: number, c: Rgb, side = 0) => cv.set(hx - Math.round(ux * i) + sx * side, hy - Math.round(uy * i) + sy * side, c);

    switch (s.kind) {
      case 'normal':
        put(0, 0xffffff);
        put(1, 0x9dfafd);
        break;
      case 'overcharge':
        put(0, 0xffffff);
        put(1, 0xffe164);
        put(2, 0xffb04f);
        for (let i = 0; i < 3; i++) {
          put(i, 0xff8a45, -1);
          put(i, 0xff8a45, 1);
        }
        put(0, 0xffe164, -1);
        put(0, 0xffe164, 1);
        break;
      case 'lance':
        put(0, 0xffffff);
        put(1, 0xffffff);
        put(2, 0xffe164);
        put(3, 0xffb04f);
        put(1, 0x52ddeb, -1);
        put(1, 0x52ddeb, 1);
        break;
      case 'missile':
        put(0, 0xffffff);
        put(1, 0xffe164);
        put(2, 0xff8a45);
        put(3, 0x9391b9);
        put(4, 0x7869aa);
        break;
      case 'reflected':
        put(0, 0xffffff);
        put(1, 0x9dfafd);
        put(2, 0x52ddeb);
        put(1, 0x2a5b80, -1);
        put(1, 0x2a5b80, 1);
        break;
      case 'enemy':
        put(0, m.tint(0xffb04f));
        put(1, m.tint(0xff4a3a));
        break;
    }
  }

  private drawFlashes(cv: Canvas, m: Mood): void {
    if (this.wash.life > 0 && this.wash.age < this.wash.life) {
      washField(cv, this.wash.colour, this.wash.alpha * (1 - this.wash.age / this.wash.life));
    }
    if (this.edge.life > 0 && this.edge.age < this.edge.life) {
      edgeGlow(cv, this.edge.colour, this.edge.alpha * (1 - this.edge.age / this.edge.life), 4);
    }
    // Time Stop and the slow field keep a steady icy or violet glow at the field's edge.
    if (m.frozen) edgeGlow(cv, 0x9dfafd, 0.2 + 0.06 * Math.sin(m.time * 6), 2);
    else if (m.slowed) edgeGlow(cv, 0x9b7bff, 0.2, 2);
  }

  // Bosses --------------------------------------------------------------------------------------

  private drawBoss(cv: Canvas, run: RunState, m: Mood): void {
    const boss = run.boss;
    if (!boss) return;
    if (boss.kind === 'hiveMind') this.drawHive(cv, run, boss, m);
    else this.drawBrood(cv, run, boss, m);
  }

  private drawBrood(cv: Canvas, run: RunState, boss: BossState, m: Mood): void {
    const enraged = boss.phase >= 2;
    const tint = (c: Rgb) => m.tint(enraged ? mix(c, 0xff5a5a, 0.22) : c);
    // The hull behind the parts: a dark spine with swept tips.
    forBox({ x: boss.x, y: boss.y, halfWidth: BOSS_HALF_WIDTH - 4, halfHeight: 3.5 }, (x, y, _u, v) => {
      cv.set(x, y, tint(v < 0.4 ? 0x5f28a0 : 0x3d2475));
    });
    forBox({ x: boss.x, y: boss.y - 6, halfWidth: 30, halfHeight: 4 }, (x, y) => cv.set(x, y, tint(0x2a1a55)));

    const order: BossPart[] = [...boss.parts].sort((a, b) => partRank(a) - partRank(b));
    const shielded = platesStanding(boss);
    for (const part of order) {
      const box = partBox(boss, part);
      const flash = part.flash > 0;
      const dead = part.hp <= 0;
      const dmg = part.maxHp > 0 ? 1 - Math.max(0, part.hp) / part.maxHp : 0;
      forBox(box, (x, y, u, v) => {
        if (dead) {
          // A wreck: scorched, with a few embers.
          const k = (x * 7 + y * 13) % 5;
          cv.set(x, y, k === 0 ? 0x3d2475 : k === 1 && Math.floor(run.time * 4 + x) % 3 === 0 ? 0xff6a3d : 0x1b1330);
          return;
        }
        if (flash) {
          cv.set(x, y, 0xffffff);
          return;
        }
        let c: Rgb;
        if (part.kind === 'plate') {
          c = v < 0.34 ? 0xc1c3eb : v < 0.67 ? 0x9391b9 : 0x604da8;
          if (u < 0.12 || u > 0.88) c = 0x604da8;
          if (dmg > 0.3 && (x * 5 + y * 3) % 4 === 0) c = 0x2a1a55;
        } else if (part.kind === 'bay') {
          const about = boss.launchTimer < 0.8;
          c = v < 0.5 ? 0xff8a45 : about ? 0xffe164 : 0xc0392b;
          if (u > 0.3 && u < 0.7 && v >= 0.5) c = about ? 0xffffff : 0x6e1830;
        } else {
          const pulse = 0.5 + 0.5 * Math.sin(run.time * (shielded ? 3 : 8));
          c = shielded ? mix(0x6a2a8a, 0x8f2a8a, pulse) : mix(0xff56da, 0xffffff, pulse * 0.45);
          if (u > 0.3 && u < 0.7 && v > 0.2 && v < 0.8) c = shielded ? 0xac55f7 : mix(0xffffff, 0xff8ae8, 1 - pulse);
        }
        cv.set(x, y, tint(c));
      });
    }
  }

  private drawHive(cv: Canvas, run: RunState, boss: BossState, m: Mood): void {
    const { px: cx, py: cy } = toPixel(boss.x, boss.y);
    const reach = HIVE_SPIKE_RADIUS + 2;
    const core = boss.parts[HIVE_SEGMENT_COUNT];
    const ring = boss.parts.slice(0, HIVE_SEGMENT_COUNT);
    const ringAngle = boss.ringAngle ?? 0;
    const phase3 = boss.phase >= 3;
    const tint = m.tint;
    const halfArc = HIVE_SEGMENT_ARC / 2;
    const flashCore = core?.flash > 0;
    const pulse = 0.5 + 0.5 * Math.sin(run.time * (phase3 ? 12 : boss.phase === 2 ? 8 : 5));

    for (let py = Math.floor(cy - reach / ART_PER_PX_Y) - 1; py <= Math.ceil(cy + reach / ART_PER_PX_Y) + 1; py++) {
      for (let px = Math.floor(cx - reach / ART_PER_PX_X) - 1; px <= Math.ceil(cx + reach / ART_PER_PX_X) + 1; px++) {
        const ax = (px + 0.5 - cx) * ART_PER_PX_X;
        const ay = -(py + 0.5 - cy) * ART_PER_PX_Y;
        const r = Math.hypot(ax, ay);
        if (r > reach) continue;
        const ang = Math.atan2(ay, ax);
        const rel = ang - ringAngle;
        const k = Math.round(rel / HIVE_SEGMENT_SPACING);
        const off = rel - k * HIVE_SEGMENT_SPACING;

        if (r <= HIVE_CORE_RADIUS) {
          let c: Rgb = r < 4.5 ? mix(0xffffff, 0xff8ae8, 1 - pulse) : r < 8 ? mix(0xff56da, 0xffffff, pulse * 0.4) : 0xc0399f;
          if (phase3) c = mix(c, 0xff5a5a, 0.35);
          cv.set(px, py, flashCore ? 0xffffff : tint(c));
        } else if (r < HIVE_RING_INNER - 1.2) {
          cv.set(px, py, tint(r < HIVE_CORE_RADIUS + 3 ? 0x6e1830 : 0x3a0c1c));
        } else if (r <= HIVE_RING_OUTER + 1.2) {
          const idx = (((k % HIVE_SEGMENT_COUNT) + HIVE_SEGMENT_COUNT) % HIVE_SEGMENT_COUNT) | 0;
          const seg = ring[idx];
          if (Math.abs(off) <= halfArc && seg && seg.hp > 0) {
            if (seg.flash > 0) cv.set(px, py, 0xffffff);
            else {
              const hurt = 1 - seg.hp / seg.maxHp;
              let c = r > (HIVE_RING_INNER + HIVE_RING_OUTER) / 2 ? 0xd04a64 : 0x8e2a3c;
              if (Math.abs(off) > halfArc * 0.72) c = darken(c, 0.35);
              cv.set(px, py, tint(darken(c, hurt * 0.4)));
            }
          } else if (!phase3) {
            // The ring's empty track: a gap or a lost segment.
            cv.set(px, py, tint(0x24081a));
          }
        } else {
          // The decorative spikes stand out from the gaps between segments.
          const spikeOff = rel - (Math.round(rel / HIVE_SEGMENT_SPACING - 0.5) + 0.5) * HIVE_SEGMENT_SPACING;
          const taper = 1 - (r - HIVE_RING_OUTER - 1.2) / (HIVE_SPIKE_RADIUS - HIVE_RING_OUTER - 1.2);
          if (!phase3 && taper > 0 && Math.abs(spikeOff) * r <= 1.2 + 2.6 * taper) cv.set(px, py, tint(taper > 0.7 ? 0xc0392b : taper > 0.3 ? 0x8e2a3c : 0x6e1830));
        }
      }
    }
  }

  private drawBossBeams(cv: Canvas, run: RunState, m: Mood): void {
    const boss = run.boss;
    if (!boss || boss.kind !== 'hiveMind' || !boss.beams || boss.beams.length === 0) return;
    const contacts = boss.stun > 0 ? [] : beamBunkerContacts(boss, run.bunkers);
    boss.beams.forEach((beam, i) => {
      const dirX = Math.cos(beam.angle);
      const dirY = Math.sin(beam.angle);
      // Out of the field and a little beyond.
      let reach = rayToEdge(boss.x, boss.y, beam.angle);
      const contact = contacts.find((c) => c.beam === i);
      if (contact) reach = Math.min(reach, Math.hypot(contact.x - boss.x, contact.y - boss.y));
      if (beam.state === 'warn') {
        // A dotted line, blinking faster as it nears firing.
        const hz = 3 + 15 * Math.pow(Math.min(1, Math.max(0, 1 - beam.timeLeft / 1.2)), 2);
        if ((run.time * hz) % 1 > 0.6) return;
        for (let t = HIVE_CORE_RADIUS; t < reach; t += 1) {
          if (Math.floor(t / 4) % 2 !== 0) continue;
          const p = toPixel(boss.x + dirX * t, boss.y + dirY * t);
          cv.set(p.px, p.py, m.tint(0xff5a5a));
        }
        return;
      }
      // Firing: a thick bar, white-hot in the middle.
      const nx = -dirY;
      const ny = dirX;
      for (let t = HIVE_CORE_RADIUS; t <= reach; t += 0.8) {
        for (const [off, c] of [[-2, 0xc0392b], [2, 0xc0392b], [-1, 0xff5a5a], [1, 0xff5a5a], [0, 0xffffff]] as const) {
          const p = toPixel(boss.x + dirX * t + nx * off, boss.y + dirY * t + ny * off);
          cv.set(p.px, p.py, c);
        }
      }
      if (contact) {
        const p = toPixel(contact.x, contact.y);
        cv.set(p.px, p.py, 0xffffff);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) cv.blend(p.px + dx, p.py + dy, 0xff8a45, 0.8);
      }
    });
  }

  // Walls, status lines and panels ----------------------------------------------------------------

  private drawWalls(frame: Frame, layout: Layout, m: Mood): void {
    const wall = m.sector === 2 ? WALL.red : WALL.normal;
    const sky = m.sector === 2 ? SKY.red[0] : SKY.normal[0];
    for (let r = 0; r < FIELD_ROWS; r++) {
      frame.text(layout.fieldCol - 1, layout.fieldRow + r, '│', wall, sky);
      frame.text(layout.fieldCol + FIELD_COLS, layout.fieldRow + r, '│', wall, sky);
    }
  }

  private drawTopLine(frame: Frame, layout: Layout, run: RunState, hud: HudInfo): void {
    const col = layout.fieldCol - 1;
    const width = FIELD_COLS + 2;
    frame.text(col, layout.topRow, ' '.repeat(width), INK, BAR_BG);
    const comboColour = run.combo >= 8 ? ACCENT : run.combo >= 4 ? WARM : run.combo >= 2 ? GOLD : MUTED;
    const left: Seg[] = [
      [' SCORE ', MUTED],
      [formatScore(run.score), INK, true],
      ['  ', MUTED],
      [comboLabel(run.combo), comboColour, true],
      ['  WAVE ', MUTED],
      [waveLabel(Math.min(WAVE_COUNT, run.wave + 1), WAVE_COUNT), INK, true],
    ];
    const right: Seg[] = [['BEST ', MUTED], [formatScore(hud.best), GOLD, true], [' ', MUTED]];
    const rw = segsWidth(right);
    writeSegs(frame, col, layout.topRow, width - rw, left, BAR_BG);
    writeSegs(frame, col + width - rw, layout.topRow, rw, right, BAR_BG);
  }

  private drawBottomLine(frame: Frame, layout: Layout, run: RunState, hud: HudInfo): void {
    const col = layout.fieldCol - 1;
    const width = FIELD_COLS + 2;
    const row = layout.bottomRow;
    frame.text(col, row, ' '.repeat(width), INK, BAR_BG);
    const player = run.players[0];
    if (!player) return;

    const auto: Seg[] = hud.autofire ? [[' AUTO ', 0x07040f, true, PILOT]] : [];
    const build = (compact: boolean): Seg[] => {
      const segs: Seg[] = [[' ', MUTED]];
      segs.push([player.lives > 0 ? '♥'.repeat(Math.min(8, player.lives)) : '-', DANGER, true]);
      if (player.shield > 0) segs.push([`  SHIELD x${player.shield}`, 0x52ddeb, true]);
      if (player.special) {
        const ready = player.specialCharge >= 1;
        segs.push(['  ' + SPECIAL_SHORT[player.special].toUpperCase() + ' ', ready ? GOLD : MUTED, ready]);
        const cells = meterCells(player.specialCharge);
        segs.push([cells.map(meterChar).join(''), ready ? GOLD : 0xac55f7, ready]);
        if (ready) {
          const blink = Math.floor(run.time * 4) % 2 === 0;
          segs.push([' READY ', 0x07040f, true, blink ? GOLD : ACCENT]);
        }
      }
      for (const chip of powerUpChips(player.powerUps)) {
        const hidden = chip.low && Math.floor(run.time * 4) % 2 === 0;
        const c = hidden ? MUTED : POWER_UP_COLOUR[chip.kind];
        segs.push([compact ? ` ${POWER_UP_WORD[chip.kind]}${chip.seconds}` : ` ${chip.label}`, c, true]);
      }
      return segs;
    };
    const room = width - segsWidth(auto);
    let segs = build(false);
    if (segsWidth(segs) > room) segs = build(true);
    writeSegs(frame, col, row, room, segs, BAR_BG);
    if (auto.length > 0) writeSegs(frame, col + width - segsWidth(auto), row, segsWidth(auto), auto, BAR_BG);
  }

  private drawBossBar(frame: Frame, layout: Layout, run: RunState): void {
    const boss = run.boss;
    if (!boss) return;
    const health = Math.min(1, Math.max(0, bossHealth(boss)));
    const label = ` ${bossBarLabel(boss.kind, boss.phase)} `;
    const labelLen = [...label].length;
    const col = layout.fieldCol;
    const row = layout.fieldRow;
    frame.text(col, row, ' '.repeat(FIELD_COLS), INK, 0x120a24);
    frame.text(col, row, label, INK, 0x120a24, true);
    const barCol = col + labelLen;
    const barWidth = FIELD_COLS - labelLen - 1;
    if (barWidth <= 0) return;
    const filled = health * barWidth;
    const hot = health < 0.34 ? 0xff5a5a : health < 0.67 ? 0xffb04f : 0xff56da;
    for (let i = 0; i < barWidth; i++) {
      const f = Math.min(1, Math.max(0, filled - i));
      if (f >= 0.999) frame.text(barCol + i, row, '█', hot, 0x120a24);
      else if (f >= 0.5) frame.text(barCol + i, row, '▌', hot, 0x120a24);
      else frame.text(barCol + i, row, '▏', 0x3d2475, 0x120a24);
    }
  }

  private drawLeftPanel(frame: Frame, layout: Layout, run: RunState): void {
    if (layout.leftPanelCol === null) return;
    const player = run.players[0];
    if (!player) return;
    const lines: Seg[][] = [];
    lines.push([[SHIPS[player.ship].name.toUpperCase(), SHIP_COLOUR[player.ship], true]]);
    lines.push([]);
    lines.push([['UPGRADES', FAINT, true]]);
    const taken = summarizeUpgrades(player.upgrades);
    if (taken.length === 0) lines.push([['none yet', FAINT]]);
    const max = 15;
    taken.slice(0, max).forEach((u) => {
      const rarity = upgradeDef(u.id).rarity;
      const c = rarity === 'rare' ? GOLD : rarity === 'uncommon' ? 0x9dfafd : 0xc1c3eb;
      lines.push([[u.count > 1 ? `${u.name} x${u.count}` : u.name, c]]);
    });
    if (taken.length > max) lines.push([[`+${taken.length - max} more`, FAINT]]);
    if (player.synergies.length > 0) {
      lines.push([]);
      lines.push([['SYNERGIES', FAINT, true]]);
      for (const s of player.synergies) lines.push([['* ', GOLD, true], [synergyDef(s).name, GOLD]]);
    }
    this.drawPanel(frame, layout.leftPanelCol, layout.fieldRow, lines, 'right');
  }

  private drawRightPanel(frame: Frame, layout: Layout, hud: HudInfo): void {
    if (layout.rightPanelCol === null) return;
    const lines: Seg[][] = [[['CONTROLS', FAINT, true]]];
    const keys: [string, string][] = [
      ['<-/-> A/D', 'move'],
      ['Space Z', 'fire'],
      ['X', 'special'],
      ['F', 'auto-fire'],
      ['Esc', 'pause'],
    ];
    for (const [k, what] of keys) lines.push([[k.padEnd(10), INK, true], [what, MUTED]]);
    if (hud.keyMode === 'repeat') {
      lines.push([]);
      for (const l of wrap("This terminal doesn't report key releases, so a key stays held a moment after each press.", PANEL_COLS)) lines.push([[l, FAINT]]);
    }
    this.drawPanel(frame, layout.rightPanelCol, layout.fieldRow, lines, 'left');
  }

  private drawPanel(frame: Frame, col: number, row: number, lines: Seg[][], align: 'left' | 'right'): void {
    lines.forEach((segs, i) => {
      const w = segsWidth(segs);
      const at = align === 'right' ? col + Math.max(0, PANEL_COLS - w) : col;
      writeSegs(frame, at, row + i, PANEL_COLS, segs, null);
    });
  }

  private drawBanners(frame: Frame, layout: Layout): void {
    for (const b of this.banners.values()) {
      const row = layout.fieldRow + b.row;
      const title = ` ${b.letterSpaced ? spaced(b.title) : b.title} `;
      const sub = b.sub ? ` ${b.sub} ` : '';
      const width = Math.min(FIELD_COLS, Math.max([...title].length, [...sub].length) + 8);
      const col = layout.fieldCol + Math.floor((FIELD_COLS - width) / 2);
      const fade = b.age > b.life - 0.25 ? 0.5 : 1;
      const bar = mix(0x07040f, b.bar, fade);
      const edge = mix(0x07040f, b.bar, fade * 0.55);
      // A three-row title block (dimmer rows above and below), and the subtitle on a dark strip.
      frame.text(col, row - 1, ' '.repeat(width), INK, edge);
      frame.text(col, row, ' '.repeat(width), INK, bar);
      frame.textCentered(col, row, width, title, 0xffffff, bar, true);
      frame.text(col, row + 1, ' '.repeat(width), INK, edge);
      if (b.sub) {
        frame.text(col, row + 2, ' '.repeat(width), INK, 0x120a24);
        frame.textCentered(col, row + 2, width, sub, 0xd9d2ff, 0x120a24, false);
      }
    }
  }
}

// Helpers -----------------------------------------------------------------------------------------

type Seg = [text: string, fg: Rgb, bold?: boolean, bg?: Rgb];

function segsWidth(segs: readonly Seg[]): number {
  let w = 0;
  for (const s of segs) w += [...s[0]].length;
  return w;
}

/** Writes coloured runs of text from `col`, clipped to `width` cells. */
function writeSegs(frame: Frame, col: number, row: number, width: number, segs: readonly Seg[], bg: Rgb | null): void {
  let c = col;
  const end = col + width;
  for (const [text, fg, bold, segBg] of segs) {
    const chars = [...text];
    const room = end - c;
    if (room <= 0) break;
    const s = chars.length > room ? chars.slice(0, room).join('') : text;
    frame.text(c, row, s, fg, segBg ?? bg, bold ?? false);
    c += Math.min(chars.length, room);
  }
}

/** A Special meter cell: full, or a shade for a part-filled one. */
function meterChar(fill: number): string {
  if (fill >= 0.999) return '█';
  if (fill >= 0.66) return '▓';
  if (fill >= 0.33) return '▒';
  if (fill > 0.02) return '░';
  return '·';
}

/** "WAVE 3" as "W A V E   3". */
function spaced(s: string): string {
  return [...s].join(' ');
}

/** Words wrapped to lines no longer than `width`. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (word === '') continue;
    if (line === '') line = word;
    else if ([...line].length + 1 + [...word].length <= width) line += ' ' + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Calls `fn` for every terminal pixel whose centre lies in an art-pixel box, with its place in the box (u across, v down, each 0 to 1). */
function forBox(box: Box, fn: (x: number, y: number, u: number, v: number) => void): void {
  const tl = toPixel(box.x - box.halfWidth, box.y + box.halfHeight);
  const br = toPixel(box.x + box.halfWidth, box.y - box.halfHeight);
  // A pixel counts when its centre is within half a pixel's worth of art of the box, so thin boxes keep a row.
  const x0 = Math.floor(tl.px);
  const x1 = Math.ceil(br.px);
  const y0 = Math.floor(tl.py);
  const y1 = Math.ceil(br.py);
  const w = Math.max(1e-6, br.px - tl.px);
  const h = Math.max(1e-6, br.py - tl.py);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = toArt(x, y);
      if (Math.abs(a.x - box.x) > box.halfWidth + 1 || Math.abs(a.y - box.y) > box.halfHeight + 1) continue;
      fn(x, y, Math.min(1, Math.max(0, (x + 0.5 - tl.px) / w)), Math.min(1, Math.max(0, (y + 0.5 - tl.py) / h)));
    }
  }
}

/** Parts draw back to front: hull pieces, then plates and bays, the core last. */
function partRank(p: BossPart): number {
  return p.kind === 'core' ? 2 : p.kind === 'bay' ? 1 : 0;
}

/** How far a ray from (x, y) at `angle` runs before it leaves the field, art pixels. */
function rayToEdge(x: number, y: number, angle: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const halfW = FIELD_WIDTH / 2 + 6;
  const halfH = FIELD_HEIGHT / 2 + 6;
  let t = Infinity;
  if (dx > 1e-6) t = Math.min(t, (halfW - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, (-halfW - x) / dx);
  if (dy > 1e-6) t = Math.min(t, (halfH - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, (-halfH - y) / dy);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}
