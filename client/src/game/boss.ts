import { ALIEN_SPECS, HIT_FLASH_SECONDS, createAlien } from './aliens';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { SHIP_TOP, SHIP_Y, nearestPlayer } from './player';
import type { Rng } from './rng';
import type { Alien, BossKind, BossPart, BossPartKind, BossState, Box, PlayerState, RunEvent, Shot } from './types';

// The Brood Mother, the boss of wave 5: a wide carrier near the top of the field. Four armour
// plates run across its front and shield the core behind them; two bays underneath launch Drones.
// Shoot the plates off to expose the core. With the last plate gone it enters phase 2: faster
// launches and a five-way spread from the core.
//
// Everything here is pure functions over `BossState`, for run.ts to call:
//
//   spawn      createBoss(kind, newId)                    when the boss wave is set up
//   each step  stepBoss(boss, { players, rng, dt, newId })  then add `launched` to run.aliens,
//              `shots` to run.shots and `events` to the step's events. Step it during the wave
//              intro too, so it descends from above; it neither fires nor launches until it has
//              landed, and takes no damage on the way down. Skip it while `run.freeze > 0`, and
//              pass `dt / 2` while `run.slow > 0`.
//   each step  stepFreeAlien(alien, targetX, dt) for every alien with mode 'free' (not
//              stepAlien, which would treat it as a returning diver), then drop the ones
//              freeAlienGone() reports. A free Drone that overlaps a ship should be handled like
//              a crashing diver (it dies and hits the ship): extend that check to mode 'free'.
//              Free aliens are not part of the formation, so the wave isn't clear while the boss
//              lives: end a boss wave on `bossDefeated`, not on an empty alien list.
//   per shot   hitBoss(boss, shotBox(shot), shot.damage) for each player shot; on a result, spend
//              the shot (a `blocked` hit, on the shielded core, spends it without damage and a
//              pierce does not carry on), emit bossPartHit, and if `destroyed` also
//              bossPartDestroyed with BOSS_POINTS[part.kind]. When bossDefeated(boss) holds, emit
//              bossKilled and BOSS_POINTS.core and end the wave.
//   laser      beamHitBoss(boss, x, bottomY) gives the part the beam stops at and the y it stops;
//              damage that part unless `blocked`.
//   Special    damageBossFixed(boss, amount) for a Pulse Bomb, and `boss.stun = seconds` to stun
//              it. Both leave the events to the caller, like hitBoss.
//   HUD        bossHealth(boss) for the health bar (plates and core only, 0 to 1).

/** Where the boss ends up, and where it starts so it can descend into view. */
export const BOSS_Y = 112;
export const BOSS_START_Y = 190;
/** Speed of the descent, art pixels per second. */
export const BOSS_DESCENT_SPEED = 45;
/** Half the width of the plates' span, the widest part of the hit boxes, art pixels. */
export const BOSS_HALF_WIDTH = 50;
/** Half the height of the box that holds every part (centred on the boss; the bays reach lowest), art pixels. */
export const BOSS_HALF_HEIGHT = 13;
/** How far the boss's centre can drift from the middle; the model's wing tips (x +-52.5) stay inside the field. */
export const BOSS_X_LIMIT = 30;
/** Sideways speed, art pixels per second. */
export const BOSS_SPEED = { 1: 16, 2: 28 } as const;

/** One part's place in the layout: where it sits and how big and tough it is. */
export interface PartSpec {
  kind: BossPartKind;
  dx: number;
  dy: number;
  halfWidth: number;
  halfHeight: number;
  hp: number;
}

export interface BossSpec {
  /** Parts in the order they are created: plates left to right, the core, then bays left to right. */
  parts: readonly PartSpec[];
}

const PLATE_XS = [-39, -13, 13, 39] as const;
const BAY_XS = [-28, 28] as const;

/**
 * The Brood Mother's layout, for the renderer as well as the sim. dx and dy are from the boss's
 * centre and match the part centres in art/blender/README.md (`plate_0..3`, `core`, `bay_L/R`);
 * the boxes are the model's sizes (plates 22 x 12, bays 14 x 5.6, core r 5.4), with the core and
 * bays made slightly more forgiving to hit.
 */
export const BROOD_PARTS: readonly PartSpec[] = [
  ...PLATE_XS.map((dx): PartSpec => ({ kind: 'plate', dx, dy: 0, halfWidth: 11, halfHeight: 6, hp: 14 })),
  { kind: 'core', dx: 0, dy: 0, halfWidth: 7, halfHeight: 6, hp: 140 },
  ...BAY_XS.map((dx): PartSpec => ({ kind: 'bay', dx, dy: -9.65, halfWidth: 7, halfHeight: 3, hp: 14 })),
];

export const BOSS_SPECS: Record<BossKind, BossSpec> = {
  broodMother: { parts: BROOD_PARTS },
};

/** Base points for destroying a part, before any combo multiplier. The core's is the boss kill. */
export const BOSS_POINTS: Record<BossPartKind, number> = { plate: 100, bay: 150, core: 2000 };

/** Seconds between Drone launches and between volleys, by phase. Each wait varies by +-15%. */
export const LAUNCH_INTERVAL = { 1: 5, 2: 3 } as const;
export const FIRE_INTERVAL = { 1: 2.4, 2: 1.7 } as const;
/** Seconds after landing until the first launch and the first volley. */
export const FIRST_LAUNCH_DELAY = 2.5;
export const FIRST_FIRE_DELAY = 2;
/** After the plates fall the next launch and volley come at most this soon, so phase 2 starts with a bang. */
export const PHASE_2_LAUNCH_DELAY = 1;
export const PHASE_2_FIRE_DELAY = 1.2;
const INTERVAL_JITTER = 0.15;

/** Enemy shot speeds from the boss, art pixels per second. */
export const BOSS_SHOT_SPEED = 100;
export const BOSS_SPREAD_SPEED = 80;
/** The most sideways speed an aimed shot can have. */
export const BOSS_SHOT_MAX_VX = 60;
/** An aimed pair lands this far either side of the ship, art pixels. */
export const PAIR_SPREAD = 8;
/** Shots in the phase 2 spread and the angle between neighbours, radians. */
export const SPREAD_SHOTS = 5;
export const SPREAD_ANGLE = 0.22;
/** In phase 2, the chance a volley is the aimed pair from the bays instead of the spread. */
export const PHASE_2_PAIR_CHANCE = 0.4;

// A launched Drone: it leaves the bay slowly, speeds up as it falls, and steers toward the
// ship's x until it is close to the ship's row, so a player who moves can still dodge it.
export const FREE_LAUNCH_SPEED = 45;
export const FREE_MAX_FALL_SPEED = 80;
export const FREE_FALL_ACCEL = 35;
export const FREE_MAX_VX = 38;
/** How quickly the Drone changes its sideways speed, art pixels per second squared. */
export const FREE_STEER = 90;
/** The Drone stops steering this far above the top of the ship. */
export const FREE_LOCK_HEIGHT = 60;
/** Sideways speed range a Drone leaves the bay with. */
const FREE_LAUNCH_VX = 15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Builds a boss above the field, ready to descend. `newId` hands out a fresh id per part. */
export function createBoss(kind: BossKind, newId: () => number): BossState {
  const parts: BossPart[] = BOSS_SPECS[kind].parts.map((spec) => ({
    id: newId(),
    kind: spec.kind,
    hp: spec.hp,
    maxHp: spec.hp,
    dx: spec.dx,
    dy: spec.dy,
    halfWidth: spec.halfWidth,
    halfHeight: spec.halfHeight,
    flash: 0,
  }));
  return {
    kind,
    x: 0,
    y: BOSS_START_Y,
    vx: BOSS_SPEED[1],
    phase: 1,
    phaseTime: 0,
    parts,
    launchTimer: FIRST_LAUNCH_DELAY,
    fireTimer: FIRST_FIRE_DELAY,
    stun: 0,
  };
}

/** True while the boss is still descending into view: it can't be hurt and doesn't attack. */
export function bossEntering(boss: BossState): boolean {
  return boss.y > BOSS_Y;
}

/** The parts of one kind that are still standing. */
export function standingParts(boss: BossState, kind?: BossPartKind): BossPart[] {
  return boss.parts.filter((p) => p.hp > 0 && (kind === undefined || p.kind === kind));
}

/** A part's hit box in field coordinates. */
export function partBox(boss: BossState, part: BossPart): Box {
  return { x: boss.x + part.dx, y: boss.y + part.dy, halfWidth: part.halfWidth, halfHeight: part.halfHeight };
}

/** Hit boxes of the parts still standing, in field coordinates. */
export function bossBoxes(boss: BossState): Box[] {
  return standingParts(boss).map((p) => partBox(boss, p));
}

/** True once the core is destroyed. */
export function bossDefeated(boss: BossState): boolean {
  for (const p of boss.parts) if (p.kind === 'core' && p.hp > 0) return false;
  return true;
}

/** True while at least one armour plate stands, so the core is shielded. */
export function platesStanding(boss: BossState): boolean {
  for (const p of boss.parts) if (p.kind === 'plate' && p.hp > 0) return true;
  return false;
}

/** What is left of the fight, 0 to 1: the plates' and core's hit points together. Bays don't count. */
export function bossHealth(boss: BossState): number {
  let hp = 0;
  let max = 0;
  for (const p of boss.parts) {
    if (p.kind === 'bay') continue;
    hp += Math.max(0, p.hp);
    max += p.maxHp;
  }
  return max > 0 ? hp / max : 0;
}

export interface BossHit {
  part: BossPart;
  /** True if this hit brought the part to 0 hit points. */
  destroyed: boolean;
  /** True if the shot was stopped by the shielded core: no damage was done. */
  blocked?: boolean;
}

function hurt(part: BossPart, amount: number): BossHit {
  part.hp = Math.max(0, part.hp - amount);
  part.flash = HIT_FLASH_SECONDS;
  return { part, destroyed: part.hp <= 0 };
}

/**
 * The part a box touches, or null: the first thing a shot fired from below would reach, which is
 * a bay, then a plate, then the core. Destroyed parts are ignored, so shots pass through their gaps.
 */
function partTouching(boss: BossState, x: number, y: number, halfWidth: number, halfHeight: number): BossPart | null {
  let plate: BossPart | null = null;
  let core: BossPart | null = null;
  for (const p of boss.parts) {
    if (p.hp <= 0) continue;
    if (Math.abs(x - (boss.x + p.dx)) >= halfWidth + p.halfWidth || Math.abs(y - (boss.y + p.dy)) >= halfHeight + p.halfHeight) continue;
    if (p.kind === 'bay') return p;
    if (p.kind === 'plate') plate ??= p;
    else core = p;
  }
  return plate ?? core;
}

/**
 * The part a shot's box hits, damaged by `damage`, or null if it hits nothing (or the boss is
 * still descending). Parts are tried from the bottom up: a bay, then a plate, then the core. The
 * plates shield the core: while any plate stands, a shot that reaches the core is stopped there
 * (`blocked: true`, no damage, the shot should be spent), so the plates have to come off first.
 * Destroyed parts are ignored, so shots pass through their gaps.
 */
export function hitBoss(boss: BossState, shotBox: Box, damage: number): BossHit | null {
  if (damage <= 0 || bossEntering(boss)) return null;
  // Most shots are nowhere near: skip the parts for those.
  if (Math.abs(shotBox.x - boss.x) >= BOSS_HALF_WIDTH + shotBox.halfWidth || Math.abs(shotBox.y - boss.y) >= BOSS_HALF_HEIGHT + shotBox.halfHeight) {
    return null;
  }
  const part = partTouching(boss, shotBox.x, shotBox.y, shotBox.halfWidth, shotBox.halfHeight);
  if (!part) return null;
  if (part.kind === 'core' && platesStanding(boss)) return { part, destroyed: false, blocked: true };
  return hurt(part, damage);
}

/**
 * Where a vertical beam at `x`, rising from `bottomY`, stops: the lowest standing part it meets
 * (a bay, then a plate, then the core), the part's bottom edge as `y`, and whether the shielded
 * core blocks it (then the beam does no damage; otherwise damage the part). Null if the beam
 * meets nothing, or the boss is still descending.
 */
export function beamHitBoss(boss: BossState, x: number, bottomY: number): { part: BossPart; blocked: boolean; y: number } | null {
  if (bossEntering(boss) || Math.abs(x - boss.x) >= BOSS_HALF_WIDTH) return null;
  let best: BossPart | null = null;
  let bestBottom = Infinity;
  for (const p of boss.parts) {
    if (p.hp <= 0 || Math.abs(x - (boss.x + p.dx)) >= p.halfWidth) continue;
    const bottom = boss.y + p.dy - p.halfHeight;
    if (boss.y + p.dy + p.halfHeight <= bottomY) continue;
    // Lowest wins; at the same height a plate stands in front of the core.
    if (best === null || bottom < bestBottom || (bottom === bestBottom && best.kind === 'core' && p.kind !== 'core')) {
      best = p;
      bestBottom = bottom;
    }
  }
  if (!best) return null;
  return { part: best, blocked: best.kind === 'core' && platesStanding(boss), y: Math.max(bottomY, bestBottom) };
}

/**
 * Damage that ignores aim, for the Pulse Bomb: whole points shared between the standing plates
 * (any left over go to the first ones, and what a plate can't take spills over to the rest), then
 * whatever is left goes to the core. Bays are untouched. Returns every part it hurt, once each,
 * so the caller can emit events for them.
 */
export function damageBossFixed(boss: BossState, amount: number): BossHit[] {
  let remaining = Math.floor(amount);
  if (bossEntering(boss) || remaining <= 0) return [];
  const dealt = new Map<BossPart, number>();
  const take = (part: BossPart, share: number) => {
    const d = Math.min(share, part.hp);
    part.hp -= d;
    remaining -= d;
    dealt.set(part, (dealt.get(part) ?? 0) + d);
  };

  for (let plates = standingParts(boss, 'plate'); plates.length > 0 && remaining >= 1; plates = standingParts(boss, 'plate')) {
    const base = Math.floor(remaining / plates.length);
    const extra = remaining % plates.length;
    plates.forEach((p, i) => take(p, base + (i < extra ? 1 : 0)));
  }
  const core = standingParts(boss, 'core')[0];
  if (core && remaining >= 1) take(core, remaining);

  const hits: BossHit[] = [];
  for (const [part, d] of dealt) {
    if (d <= 0) continue;
    part.flash = HIT_FLASH_SECONDS;
    hits.push({ part, destroyed: part.hp <= 0 });
  }
  return hits;
}

export interface BossStepContext {
  players: readonly PlayerState[];
  rng: Rng;
  dt: number;
  newId: () => number;
}

export interface BossStep {
  /** Drones launched this step (mode 'free'), to add to the run's aliens. */
  launched: Alien[];
  /** Enemy shots fired this step, to add to the run's shots. */
  shots: Shot[];
  /** bossLaunched, bossFired and bossPhase events only. */
  events: RunEvent[];
}

const nextInterval = (base: number, rng: Rng) => base * rng.range(1 - INTERVAL_JITTER, 1 + INTERVAL_JITTER);

/**
 * Advances the boss by one step: hit flashes, the descent, the phase change, sideways
 * movement, Drone launches from the standing bays and volleys at the nearest ship. A stunned boss
 * only counts its stun down. A destroyed core or an empty `players` list stops the attacks.
 */
export function stepBoss(boss: BossState, ctx: BossStepContext): BossStep {
  const { players, rng, dt, newId } = ctx;
  const out: BossStep = { launched: [], shots: [], events: [] };
  for (const p of boss.parts) p.flash = Math.max(0, p.flash - dt);
  if (dt <= 0) return out;
  const standing = standingParts(boss);
  const core = standing.find((p) => p.kind === 'core');
  if (!core) return out;

  // Phase 2 begins the step the last plate falls, whatever knocked it off.
  if (boss.phase === 1 && !standing.some((p) => p.kind === 'plate')) {
    boss.phase = 2;
    boss.phaseTime = 0;
    boss.launchTimer = Math.min(boss.launchTimer, PHASE_2_LAUNCH_DELAY);
    boss.fireTimer = Math.min(boss.fireTimer, PHASE_2_FIRE_DELAY);
    out.events.push({ type: 'bossPhase', phase: 2 });
  }
  boss.phaseTime += dt;

  if (boss.stun > 0) {
    boss.stun = Math.max(0, boss.stun - dt);
    return out;
  }

  if (bossEntering(boss)) {
    boss.y = Math.max(BOSS_Y, boss.y - BOSS_DESCENT_SPEED * dt);
    return out;
  }

  const phase = boss.phase >= 2 ? 2 : 1;
  const speed = BOSS_SPEED[phase];
  boss.vx = (boss.vx < 0 ? -1 : 1) * speed;
  boss.x += boss.vx * dt;
  if (Math.abs(boss.x) > BOSS_X_LIMIT) {
    boss.x = clamp(boss.x, -BOSS_X_LIMIT, BOSS_X_LIMIT);
    boss.vx = -boss.vx;
  }

  boss.launchTimer -= dt;
  if (boss.launchTimer <= 0) {
    launchDrones(boss, standing, rng, newId, out);
    boss.launchTimer = nextInterval(LAUNCH_INTERVAL[phase], rng);
  }

  boss.fireTimer -= dt;
  if (boss.fireTimer <= 0) {
    fireVolley(boss, standing, core, players, rng, newId, out);
    boss.fireTimer = nextInterval(FIRE_INTERVAL[phase], rng);
  }
  return out;
}

/** One Drone leaves each standing bay. */
function launchDrones(boss: BossState, standing: readonly BossPart[], rng: Rng, newId: () => number, out: BossStep): void {
  for (const bay of standing) {
    if (bay.kind !== 'bay') continue;
    const drone = createAlien('drone', newId(), -1, -1, boss.x + bay.dx, boss.y + bay.dy - bay.halfHeight - ALIEN_SPECS.drone.halfHeight);
    drone.mode = 'free';
    drone.vx = rng.range(-FREE_LAUNCH_VX, FREE_LAUNCH_VX);
    drone.vy = -FREE_LAUNCH_SPEED;
    out.launched.push(drone);
    out.events.push({ type: 'bossLaunched', alienId: drone.id });
  }
}

function enemyShot(id: number, x: number, y: number, vx: number, vy: number): Shot {
  return {
    id,
    owner: 'alien',
    kind: 'enemy',
    playerId: null,
    x,
    y,
    vx,
    vy,
    pierceLeft: 0,
    damage: 1,
    homing: 0,
    bouncesLeft: 0,
    hits: 0,
    volley: id,
  };
}

/** A volley at the nearest ship: phase 1 always an aimed pair; phase 2 mostly a spread from the core. */
function fireVolley(boss: BossState, standing: readonly BossPart[], core: BossPart, players: readonly PlayerState[], rng: Rng, newId: () => number, out: BossStep): void {
  const target = nearestPlayer(players, boss.x);
  if (!target) return;
  const bays = standing.filter((p) => p.kind === 'bay');
  const spread = boss.phase >= 2 && (bays.length === 0 || rng.next() >= PHASE_2_PAIR_CHANCE);

  if (spread) {
    const x = boss.x + core.dx;
    const y = boss.y + core.dy - core.halfHeight;
    // Fan out around the line from the core to the ship (angle measured from straight down).
    const aim = Math.atan2(target.x - x, Math.max(1, y - SHIP_Y));
    for (let k = 0; k < SPREAD_SHOTS; k++) {
      const a = aim + (k - (SPREAD_SHOTS - 1) / 2) * SPREAD_ANGLE;
      out.shots.push(enemyShot(newId(), x, y, Math.sin(a) * BOSS_SPREAD_SPEED, -Math.cos(a) * BOSS_SPREAD_SPEED));
    }
    out.events.push({ type: 'bossFired', x, y });
    return;
  }

  // An aimed pair, one shot from each standing bay (or both from the one that is left, or the
  // core's underside once the bays are gone), landing either side of the ship.
  const origins =
    bays.length >= 2
      ? bays.slice(0, 2).map((b) => ({ x: boss.x + b.dx, y: boss.y + b.dy - b.halfHeight }))
      : bays.length === 1
        ? [-4, 4].map((o) => ({ x: boss.x + bays[0].dx + o, y: boss.y + bays[0].dy - bays[0].halfHeight }))
        : [-5, 5].map((o) => ({ x: boss.x + core.dx + o, y: boss.y + core.dy - core.halfHeight }));
  origins.forEach((origin, i) => {
    const flightTime = Math.max(0.1, (origin.y - SHIP_Y) / BOSS_SHOT_SPEED);
    const aimX = target.x + (i === 0 ? -PAIR_SPREAD : PAIR_SPREAD);
    const vx = clamp((aimX - origin.x) / flightTime, -BOSS_SHOT_MAX_VX, BOSS_SHOT_MAX_VX);
    out.shots.push(enemyShot(newId(), origin.x, origin.y, vx, -BOSS_SHOT_SPEED));
  });
  out.events.push({ type: 'bossFired', x: origins[0].x, y: origins[0].y });
}

/**
 * Moves a launched Drone by one step: it speeds up as it falls and steers toward `targetX` (the
 * nearest ship's x, or null for none) until it is within FREE_LOCK_HEIGHT of the ship, then holds
 * its course so the player can slip past.
 */
export function stepFreeAlien(alien: Alien, targetX: number | null, dt: number): void {
  alien.flash = Math.max(0, alien.flash - dt);
  alien.modeTime += dt;
  let vx = alien.vx ?? 0;
  let vy = alien.vy ?? -FREE_LAUNCH_SPEED;
  vy = Math.max(-FREE_MAX_FALL_SPEED, vy - FREE_FALL_ACCEL * dt);
  if (targetX !== null && alien.y > SHIP_TOP + FREE_LOCK_HEIGHT) {
    const wanted = clamp((targetX - alien.x) * 1.2, -FREE_MAX_VX, FREE_MAX_VX);
    vx += clamp(wanted - vx, -FREE_STEER * dt, FREE_STEER * dt);
  }
  alien.vx = vx;
  alien.vy = vy;
  alien.x += vx * dt;
  alien.y += vy * dt;
}

/** True once a free alien has flown off the bottom or the side of the field, so it can be dropped. */
export function freeAlienGone(alien: Alien): boolean {
  return (
    alien.y + ALIEN_SPECS[alien.kind].halfHeight < -FIELD_HEIGHT / 2 ||
    Math.abs(alien.x) > FIELD_WIDTH / 2 + ALIEN_SPECS[alien.kind].halfWidth + 10
  );
}
