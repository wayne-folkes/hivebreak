import { ALIEN_SPECS, HIT_FLASH_SECONDS, createAlien } from './aliens';
import { bunkerSolidAt } from './bunkers';
import { SHIP_Y, nearestPlayer } from './player';
import type { Rng } from './rng';
import type { BossHit, BossStep, BossStepContext, PartSpec } from './boss';
import type { BossBeam, BossPart, BossState, Box, Bunker, Shot } from './types';

// The Hive Mind, the final boss of wave 10: a core inside a ring of eight shield segments that
// turns around it, with spikes outside the ring (decoration only). boss.ts dispatches to this
// module for the 'hiveMind' kind, so the fold-in uses the same API as for the Brood Mother
// (createBoss, stepBoss, hitBoss, beamHitBoss, damageBossFixed, bossBoxes, bossHealth,
// bossDefeated, stepFreeAlien) plus the pieces that are new here, listed below.
//
// A shot is stopped by the ring: one that lands on a standing segment's arc damages that segment;
// one that finds a gap, or the arc of a destroyed segment, flies on and reaches the core. Nothing
// else shields the core, so it takes damage only through gaps (until phase 3, when the ring is
// gone). There is no `blocked` result here; while the boss is still descending nothing is hit.
//
// Phases, by the core's health (a change per step, announced with a bossPhase event):
//   1 (100-66%)  The ring turns slowly. A single aimed shot leaves the core every ~1.6 s, held
//                until a gap lines up with the ship so it visibly passes through the ring.
//   2 (66-33%)   The ring turns faster and now and then reverses. One or two beams at a time
//                warn for ~1.2 s (a dashed line, `state: 'warn'`) along an angle aimed near the
//                ship, then fire for ~0.6 s while sweeping slowly (`state: 'fire'`). A pair of
//                Divers launches as free aliens every ~5 s.
//   3 (below 33%) The remaining segments shatter, the core drifts toward the ship's x and fires
//                a slowly turning spiral of shots; the beams carry on, faster.
//
// Beams are lethal only while firing: for the fold-in's step, after stepping the boss,
//   - ships: `beamHitsBox(boss, shipBox, run.bunkers)` is true while a firing beam touches the
//     box with no solid bunker pixel in the way (bunkers shelter ships; the beam's centre line is
//     what the bunker mask is tested against). Treat it as a hit (the ship's own invulnerability
//     stops it repeating). Skip it while `run.freeze > 0` (the boss isn't stepped then, and the
//     beam would sit frozen on the ship).
//   - bunkers: `beamBunkerContacts(boss, run.bunkers)` lists where each firing beam meets a
//     solid pixel; call `erodeColumn(run.bunkers, c.x, c.y, width)` for each, about every 0.1 s
//     (not every step) so a beam bores through a bunker over a second or so.
//   - `boss.beams` and `boss.ringAngle` are for the renderer; the segment parts' dx/dy already
//     follow the ring, and segment i sits at ringAngle + i * HIVE_SEGMENT_SPACING. A beam shown
//     to the renderer should be drawn to its first contact (or off the field).
//   - `stepBoss` returns the segments that shattered this step in `shattered`, for the caller to
//     turn into bossPartDestroyed events (and score, if it wants any: shattering is free).

// Layout --------------------------------------------------------------------------------------

/** Where the boss ends up, and where it starts so it can descend into view (the ring clears the top). */
export const HIVE_Y = 64;
export const HIVE_START_Y = 200;
/** Speed of the descent, art pixels per second. */
export const HIVE_DESCENT_SPEED = 45;

/** The core's radius, and the ring's radius (to the middle of the segments) and thickness, art pixels. */
export const HIVE_CORE_RADIUS = 11;
export const HIVE_RING_RADIUS = 26;
export const HIVE_RING_THICKNESS = 6;
/** The ring's inner and outer edges, art pixels from the boss's centre. */
export const HIVE_RING_INNER = HIVE_RING_RADIUS - HIVE_RING_THICKNESS / 2;
export const HIVE_RING_OUTER = HIVE_RING_RADIUS + HIVE_RING_THICKNESS / 2;
/** Where the decorative spikes end, for the renderer. They are never hit. */
export const HIVE_SPIKE_RADIUS = 42;

/** Eight segments, 30 degrees of arc each, centred every 45 degrees (15-degree gaps between). */
export const HIVE_SEGMENT_COUNT = 8;
export const HIVE_SEGMENT_SPACING = (Math.PI * 2) / HIVE_SEGMENT_COUNT;
export const HIVE_SEGMENT_ARC = Math.PI / 6;
const HALF_ARC = HIVE_SEGMENT_ARC / 2;
/** Half size of a segment's (axis-aligned) box, which only the homing and box queries use. */
const SEGMENT_HALF_SIZE = 6;

/**
 * Hit points. The core's is the tuning knob for how long the fight lasts: with these, a scripted
 * ship with rapid fire and a second shot (boss.test's benchmark) wins in about 33 s, the ring
 * going first. (A bot that never dodges or misses; a person takes longer.)
 */
export const HIVE_CORE_HP = 200;
export const HIVE_SEGMENT_HP = 14;
/** The core's health fractions where phases 2 and 3 begin. */
export const HIVE_PHASE_2_AT = 2 / 3;
export const HIVE_PHASE_3_AT = 1 / 3;

const segmentDx = (i: number) => Math.cos(i * HIVE_SEGMENT_SPACING) * HIVE_RING_RADIUS;
const segmentDy = (i: number) => Math.sin(i * HIVE_SEGMENT_SPACING) * HIVE_RING_RADIUS;

/**
 * The Hive Mind's layout at ring angle 0: segments 0 to 7 (segment i at i * 45 degrees,
 * counter-clockwise from screen right), then the core, which is the last part. Matches
 * art/blender/hive_mind.py (`seg_0..7`, `core`).
 */
export const HIVE_PARTS: readonly PartSpec[] = [
  ...Array.from(
    { length: HIVE_SEGMENT_COUNT },
    (_, i): PartSpec => ({ kind: 'segment', dx: segmentDx(i), dy: segmentDy(i), halfWidth: SEGMENT_HALF_SIZE, halfHeight: SEGMENT_HALF_SIZE, hp: HIVE_SEGMENT_HP }),
  ),
  { kind: 'core', dx: 0, dy: 0, halfWidth: HIVE_CORE_RADIUS, halfHeight: HIVE_CORE_RADIUS, hp: HIVE_CORE_HP },
];

// Tuning --------------------------------------------------------------------------------------

/** The ring's turning speed by phase, radians per second, and how fast it can change speed. */
export const HIVE_RING_SPEED = { 1: 0.45, 2: 0.95 } as const;
export const HIVE_RING_ACCEL = 2.2;
/** Seconds between ring reversals in phase 2 (a random wait in this range). */
export const HIVE_REVERSE_INTERVAL = { min: 3.5, max: 6.5 } as const;

/** Phase 1: seconds between aimed shots (+-15%), and the first one after landing. */
export const HIVE_FIRE_INTERVAL = 1.6;
export const HIVE_FIRST_FIRE_DELAY = 2;
export const HIVE_SHOT_SPEED = 95;
/** An aimed shot waits until the line to the ship clears the ring by this angle (radians). */
export const HIVE_GAP_MARGIN = 0.08;

/** Phase 2: seconds between pairs of Divers (+-15%), and how fast they leave. */
export const HIVE_LAUNCH_INTERVAL = 5;
export const HIVE_LAUNCH_SPEED = 45;
export const HIVE_LAUNCH_DELAYS = { first: 3, phase2: 1.5 } as const;

/** Beams, by phase (2 or 3): seconds to warn and to fire, sweep speed (radians per second), the pause between waves, and the chance a wave is two beams. */
export const HIVE_BEAM = {
  warn: { 2: 1.2, 3: 0.9 },
  fire: { 2: 0.6, 3: 0.6 },
  sweep: { 2: 0.35, 3: 0.6 },
  gap: { 2: 2.2, 3: 1.3 },
  twoChance: { 2: 0.45, 3: 0.65 },
} as const;
/** How far (radians) off the ship a beam is aimed, and the first wave's delay when a phase begins. */
export const HIVE_BEAM_AIM_OFFSET = { min: 0.1, max: 0.2 } as const;
export const HIVE_BEAM_FIRST_DELAY = { first: 3, phase2: 1, phase3: 0.8 } as const;
/** Half the thickness of a firing beam, art pixels. */
export const HIVE_BEAM_HALF_WIDTH = 2;

/** Phase 3: the core's drift speed and furthest x, and the spiral (arms, seconds per tick, turn per tick, shot speed). */
export const HIVE_DRIFT_SPEED = 16;
export const HIVE_X_LIMIT = 70;
export const HIVE_SPIRAL = { arms: 3, interval: 0.3, turn: 0.26, speed: 58, firstDelay: 1 } as const;

const INTERVAL_JITTER = 0.15;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nextInterval = (base: number, rng: Rng) => base * rng.range(1 - INTERVAL_JITTER, 1 + INTERVAL_JITTER);

// State ---------------------------------------------------------------------------------------

/** Fills in the Hive Mind's own state on a boss `createBoss` has built from `HIVE_PARTS`. */
export function initHive(boss: BossState): void {
  boss.y = HIVE_START_Y;
  boss.vx = 0;
  boss.launchTimer = HIVE_LAUNCH_DELAYS.first;
  boss.fireTimer = HIVE_FIRST_FIRE_DELAY;
  boss.ringAngle = 0;
  boss.ringSpeed = HIVE_RING_SPEED[1];
  boss.ringDir = 1;
  boss.ringTimer = HIVE_REVERSE_INTERVAL.max;
  boss.beamTimer = HIVE_BEAM_FIRST_DELAY.first;
  boss.beams = [];
  boss.spiralAngle = 0;
}

/** True while the boss is still descending into view: it can't be hurt and doesn't attack. */
export function hiveEntering(boss: BossState): boolean {
  return boss.y > HIVE_Y;
}

/** The core, which is the last part. */
function coreOf(boss: BossState): BossPart {
  return boss.parts[HIVE_SEGMENT_COUNT];
}

/** The angle of segment `i` right now, radians counter-clockwise from screen right. */
export function segmentAngle(boss: BossState, i: number): number {
  return (boss.ringAngle ?? 0) + i * HIVE_SEGMENT_SPACING;
}

/** What is left of the fight, 0 to 1: the core's hit points. (The ring is the way in, not the goal.) */
export function hiveHealth(boss: BossState): number {
  const core = coreOf(boss);
  return core.maxHp > 0 ? Math.max(0, core.hp) / core.maxHp : 0;
}

/** Moves the segment parts to where the ring has turned them. */
function placeSegments(boss: BossState): void {
  const angle = boss.ringAngle ?? 0;
  for (let i = 0; i < HIVE_SEGMENT_COUNT; i++) {
    const part = boss.parts[i];
    const a = angle + i * HIVE_SEGMENT_SPACING;
    part.dx = Math.cos(a) * HIVE_RING_RADIUS;
    part.dy = Math.sin(a) * HIVE_RING_RADIUS;
  }
}

// Hits ----------------------------------------------------------------------------------------

/**
 * The standing segment whose arc covers the direction `angle` (radians), widened by `margin`, or
 * null: a gap, or a destroyed segment. Angle maths only: the nearest segment centre is found by
 * rounding.
 */
export function segmentAt(boss: BossState, angle: number, margin: number): BossPart | null {
  const d = angle - (boss.ringAngle ?? 0);
  const k = Math.round(d / HIVE_SEGMENT_SPACING);
  if (Math.abs(d - k * HIVE_SEGMENT_SPACING) > HALF_ARC + margin) return null;
  const part = boss.parts[((k % HIVE_SEGMENT_COUNT) + HIVE_SEGMENT_COUNT) % HIVE_SEGMENT_COUNT];
  return part.hp > 0 ? part : null;
}

/**
 * What a thing at (rx, ry) from the boss's centre touches, if it reaches `reach` art pixels
 * around that point (`width` sideways, which widens a segment's arc): a standing segment where it
 * is inside the ring's band, otherwise the core where it is inside the core's circle.
 */
function partAt(boss: BossState, rx: number, ry: number, reach: number, width: number): BossPart | null {
  const r2 = rx * rx + ry * ry;
  const outer = HIVE_RING_OUTER + reach;
  if (r2 >= outer * outer) return null;
  const inner = HIVE_RING_INNER - reach;
  if (r2 >= inner * inner) {
    // Inside the band: a segment's arc stops it, a gap lets it through to the core.
    const seg = segmentAt(boss, Math.atan2(ry, rx), width / Math.sqrt(r2));
    if (seg) return seg;
  }
  const coreR = HIVE_CORE_RADIUS + reach;
  return r2 < coreR * coreR ? coreOf(boss) : null;
}

function hurt(part: BossPart, amount: number): BossHit {
  part.hp = Math.max(0, part.hp - amount);
  part.flash = HIT_FLASH_SECONDS;
  return { part, destroyed: part.hp <= 0 };
}

/** The part a shot's box hits, damaged by `damage`, or null (see the module comment). */
export function hitHive(boss: BossState, shotBox: Box, damage: number): BossHit | null {
  if (damage <= 0 || hiveEntering(boss)) return null;
  const part = partAt(boss, shotBox.x - boss.x, shotBox.y - boss.y, Math.max(shotBox.halfWidth, shotBox.halfHeight), shotBox.halfWidth);
  return part ? hurt(part, damage) : null;
}

/** The laser is sampled this coarsely going up, then the first hit is bisected. */
const BEAM_STEP = 3;
const BEAM_REFINE_STEPS = 6;

/**
 * Where a vertical beam at `x`, rising from `bottomY`, stops: the first standing segment on its
 * way up, or the core if it slips through a gap, and the y where it stopped. Never `blocked`.
 * It only looks along the chord where the beam is inside the boss's outer circle, in coarse
 * steps, and bisects the step where it first touches something.
 */
export function beamHitHive(boss: BossState, x: number, bottomY: number): { part: BossPart; blocked: boolean; y: number } | null {
  const rx = x - boss.x;
  const reach = 1;
  const outer = HIVE_RING_OUTER + reach;
  if (hiveEntering(boss) || Math.abs(rx) >= outer) return null;
  const half = Math.sqrt(outer * outer - rx * rx);
  const end = boss.y + half;
  let lo = Math.max(bottomY, boss.y - half);
  let part = lo <= end ? partAt(boss, rx, lo - boss.y, reach, reach) : null;
  if (part) return { part, blocked: false, y: lo };
  for (let y = lo + BEAM_STEP; ; y += BEAM_STEP) {
    const at = Math.min(y, end);
    if (lo > end) return null;
    part = partAt(boss, rx, at - boss.y, reach, reach);
    if (part) {
      let hi = at;
      let found = part;
      for (let i = 0; i < BEAM_REFINE_STEPS; i++) {
        const mid = (lo + hi) / 2;
        const m = partAt(boss, rx, mid - boss.y, reach, reach);
        if (m) {
          hi = mid;
          found = m;
        } else {
          lo = mid;
        }
      }
      return { part: found, blocked: false, y: hi };
    }
    if (at >= end) return null;
    lo = at;
  }
}

// Beams ---------------------------------------------------------------------------------------

/** Whether the first `tLimit` of a ray from (ox, oy) along (dx, dy), `halfWidth` thick, touches the box. */
function rayHitsBox(ox: number, oy: number, dx: number, dy: number, box: Box, halfWidth: number, tLimit: number): boolean {
  const hw = box.halfWidth + halfWidth;
  const hh = box.halfHeight + halfWidth;
  let tMin = 0;
  let tMax = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (Math.abs(ox - box.x) > hw) return false;
  } else {
    const t1 = (box.x - hw - ox) / dx;
    const t2 = (box.x + hw - ox) / dx;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  if (Math.abs(dy) < 1e-9) {
    if (Math.abs(oy - box.y) > hh) return false;
  } else {
    const t1 = (box.y - hh - oy) / dy;
    const t2 = (box.y + hh - oy) / dy;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }
  return tMax >= tMin && tMin <= tLimit;
}

/** How finely a beam's centre line is checked against a bunker's pixels, art pixels. */
const BUNKER_STEP = 0.5;

/**
 * How far along `beam` (from the core) it travels before it meets a solid bunker pixel, or
 * Infinity. Marches the line through each bunker's bounding box it crosses.
 */
function beamStopDistance(boss: BossState, beam: BossBeam, bunkers: readonly Bunker[]): number {
  const dx = Math.cos(beam.angle);
  const dy = Math.sin(beam.angle);
  let best = Infinity;
  for (let i = 0; i < bunkers.length; i++) {
    const bunker = bunkers[i];
    // Where the line is inside the bunker's bounding box (slab test).
    let t0 = 0;
    let t1 = best;
    if (Math.abs(dx) < 1e-9) {
      if (boss.x < bunker.x || boss.x >= bunker.x + bunker.width) continue;
    } else {
      const a = (bunker.x - boss.x) / dx;
      const b = (bunker.x + bunker.width - boss.x) / dx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (Math.abs(dy) < 1e-9) {
      if (boss.y < bunker.y || boss.y >= bunker.y + bunker.height) continue;
    } else {
      const a = (bunker.y - boss.y) / dy;
      const b = (bunker.y + bunker.height - boss.y) / dy;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    for (let t = t0; t <= t1; t += BUNKER_STEP) {
      if (bunkerSolidAt(bunker, boss.x + dx * t, boss.y + dy * t)) {
        best = t;
        break;
      }
    }
  }
  return best;
}

/**
 * True if any firing beam touches `box`: a line from the core along the beam's angle,
 * HIVE_BEAM_HALF_WIDTH * 2 thick, reaching off the field, stopped by the first solid bunker pixel
 * on its centre line (pass `[]` for none). Warning beams are harmless, and a stunned boss's
 * beams are held, so they don't count either.
 */
export function beamHitsBox(boss: BossState, box: Box, bunkers: readonly Bunker[]): boolean {
  const beams = boss.beams;
  if (!beams || beams.length === 0 || boss.stun > 0 || coreOf(boss).hp <= 0) return false;
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    if (b.state !== 'fire') continue;
    const stop = bunkers.length > 0 ? beamStopDistance(boss, b, bunkers) : Infinity;
    if (rayHitsBox(boss.x, boss.y, Math.cos(b.angle), Math.sin(b.angle), box, HIVE_BEAM_HALF_WIDTH, stop)) return true;
  }
  return false;
}

/** Where a firing beam meets a solid bunker pixel, and which beam (an index into `boss.beams`). */
export interface BeamContact {
  x: number;
  y: number;
  beam: number;
}

/**
 * The points where each firing beam is stopped by a bunker (at most one per beam), for the
 * fold-in to burn with bunkers.ts's `erodeColumn(bunkers, c.x, c.y, width)` every ~0.1 s. Fills
 * and returns `out` (cleared first) so the caller can reuse one array. Empty while stunned.
 */
export function beamBunkerContacts(boss: BossState, bunkers: readonly Bunker[], out: BeamContact[] = []): BeamContact[] {
  out.length = 0;
  const beams = boss.beams;
  if (!beams || boss.stun > 0 || bunkers.length === 0 || coreOf(boss).hp <= 0) return out;
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    if (b.state !== 'fire') continue;
    const t = beamStopDistance(boss, b, bunkers);
    if (t !== Infinity) out.push({ x: boss.x + Math.cos(b.angle) * t, y: boss.y + Math.sin(b.angle) * t, beam: i });
  }
  return out;
}

/** The x where `beam` crosses height `y`, or null if it never gets there (it points away or sideways). */
export function beamCrossX(boss: BossState, beam: BossBeam, y: number): number | null {
  const s = Math.sin(beam.angle);
  const dy = y - boss.y;
  if (Math.abs(s) < 1e-3 || dy / s < 0) return null;
  return boss.x + dy * (Math.cos(beam.angle) / s);
}

// Stepping ------------------------------------------------------------------------------------

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

/** Begins `phase`: resets the timers it uses, and in phase 3 shatters what is left of the ring. */
function enterPhase(boss: BossState, phase: number, rng: Rng, out: BossStep): void {
  boss.phase = phase;
  boss.phaseTime = 0;
  out.events.push({ type: 'bossPhase', phase });
  if (phase === 2) {
    boss.launchTimer = Math.min(boss.launchTimer, HIVE_LAUNCH_DELAYS.phase2);
    boss.beamTimer = Math.min(boss.beamTimer ?? 0, HIVE_BEAM_FIRST_DELAY.phase2);
    boss.ringTimer = rng.range(HIVE_REVERSE_INTERVAL.min, HIVE_REVERSE_INTERVAL.max);
  } else {
    for (let i = 0; i < HIVE_SEGMENT_COUNT; i++) {
      const seg = boss.parts[i];
      if (seg.hp <= 0) continue;
      seg.hp = 0;
      out.shattered.push(seg);
    }
    boss.fireTimer = Math.min(boss.fireTimer, HIVE_SPIRAL.firstDelay);
    boss.beamTimer = Math.min(boss.beamTimer ?? 0, HIVE_BEAM_FIRST_DELAY.phase3);
  }
}

/** Turns the ring: up to speed in phase 1, faster in phase 2 with a reversal now and then, still in phase 3. */
function turnRing(boss: BossState, rng: Rng, dt: number): void {
  if (boss.phase >= 3) return;
  let dir = boss.ringDir ?? 1;
  if (boss.phase >= 2) {
    const timer = (boss.ringTimer ?? 0) - dt;
    if (timer <= 0) {
      dir = dir === 1 ? -1 : 1;
      boss.ringDir = dir;
      boss.ringTimer = rng.range(HIVE_REVERSE_INTERVAL.min, HIVE_REVERSE_INTERVAL.max);
    } else {
      boss.ringTimer = timer;
    }
  }
  const target = dir * HIVE_RING_SPEED[boss.phase >= 2 ? 2 : 1];
  const speed = boss.ringSpeed ?? target;
  boss.ringSpeed = speed + clamp(target - speed, -HIVE_RING_ACCEL * dt, HIVE_RING_ACCEL * dt);
  let angle = (boss.ringAngle ?? 0) + boss.ringSpeed * dt;
  if (angle > Math.PI * 2) angle -= Math.PI * 2;
  else if (angle < -Math.PI * 2) angle += Math.PI * 2;
  boss.ringAngle = angle;
  placeSegments(boss);
}

/**
 * Advances the Hive Mind by one step: the phase change, the descent, the ring, and the phase's
 * attacks. A stunned boss only counts its stun down (no ring turn, drift, shots or beams).
 */
export function stepHive(boss: BossState, ctx: BossStepContext, out: BossStep): void {
  const { players, rng, dt, newId } = ctx;
  const core = coreOf(boss);
  if (core.hp <= 0) return;

  // One phase per step, from the core's health (integer maths, so exactly 60 of 90 is phase 2).
  const want = core.hp * 3 <= core.maxHp ? 3 : core.hp * 3 <= core.maxHp * 2 ? 2 : 1;
  if (want > boss.phase) enterPhase(boss, boss.phase + 1, rng, out);
  boss.phaseTime += dt;

  if (boss.stun > 0) {
    boss.stun = Math.max(0, boss.stun - dt);
    return;
  }

  if (hiveEntering(boss)) {
    boss.y = Math.max(HIVE_Y, boss.y - HIVE_DESCENT_SPEED * dt);
    turnRing(boss, rng, dt);
    return;
  }
  turnRing(boss, rng, dt);

  if (boss.phase === 1) {
    boss.fireTimer -= dt;
    if (boss.fireTimer <= 0 && fireAimed(boss, players, newId, out)) boss.fireTimer = nextInterval(HIVE_FIRE_INTERVAL, rng);
    return;
  }

  const ph = boss.phase >= 3 ? 3 : 2;
  stepBeams(boss, ph, players, rng, dt, out);

  if (ph === 2) {
    boss.launchTimer -= dt;
    if (boss.launchTimer <= 0) {
      launchDivers(boss, rng, newId, out);
      boss.launchTimer = nextInterval(HIVE_LAUNCH_INTERVAL, rng);
    }
    return;
  }

  // Phase 3: chase the ship's x, and fire the spiral.
  const target = nearestPlayer(players, boss.x);
  boss.vx = target ? clamp((target.x - boss.x) * 2, -HIVE_DRIFT_SPEED, HIVE_DRIFT_SPEED) : 0;
  boss.x = clamp(boss.x + boss.vx * dt, -HIVE_X_LIMIT, HIVE_X_LIMIT);
  boss.fireTimer -= dt;
  if (boss.fireTimer <= 0) {
    fireSpiral(boss, newId, out);
    boss.fireTimer = HIVE_SPIRAL.interval;
  }
}

/**
 * One aimed shot from the core at the nearest ship. Returns false if the ring is in the way (no
 * gap lines up with the ship yet), so the caller tries again next step; true if it fired, or
 * there was no ship to aim at.
 */
function fireAimed(boss: BossState, players: BossStepContext['players'], newId: () => number, out: BossStep): boolean {
  const target = nearestPlayer(players, boss.x);
  if (!target) return true;
  const angle = Math.atan2(SHIP_Y - boss.y, target.x - boss.x);
  if (segmentAt(boss, angle, HIVE_GAP_MARGIN)) return false;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = boss.x + c * HIVE_CORE_RADIUS;
  const y = boss.y + s * HIVE_CORE_RADIUS;
  out.shots.push(enemyShot(newId(), x, y, c * HIVE_SHOT_SPEED, s * HIVE_SHOT_SPEED));
  out.events.push({ type: 'bossFired', x, y });
  return true;
}

/** Phase 3: arms of shots from the core, turning a little each tick. Arms that point up are skipped. */
function fireSpiral(boss: BossState, newId: () => number, out: BossStep): void {
  const base = boss.spiralAngle ?? 0;
  let fired = false;
  for (let k = 0; k < HIVE_SPIRAL.arms; k++) {
    const a = base + (k * Math.PI * 2) / HIVE_SPIRAL.arms;
    const vy = Math.sin(a) * HIVE_SPIRAL.speed;
    if (vy > 0) continue;
    const c = Math.cos(a);
    out.shots.push(enemyShot(newId(), boss.x + c * HIVE_CORE_RADIUS, boss.y + Math.sin(a) * HIVE_CORE_RADIUS, c * HIVE_SPIRAL.speed, vy));
    fired = true;
  }
  boss.spiralAngle = base + HIVE_SPIRAL.turn;
  if (fired) out.events.push({ type: 'bossFired', x: boss.x, y: boss.y - HIVE_CORE_RADIUS });
}

/** A pair of Divers leaves the ring, one each side, and flies free toward the ship. */
function launchDivers(boss: BossState, rng: Rng, newId: () => number, out: BossStep): void {
  for (let side = -1; side <= 1; side += 2) {
    const diver = createAlien('diver', newId(), -1, -1, boss.x + side * 12, boss.y - HIVE_RING_OUTER - ALIEN_SPECS.diver.halfHeight);
    diver.mode = 'free';
    diver.vx = side * rng.range(8, 20);
    diver.vy = -HIVE_LAUNCH_SPEED;
    out.launched.push(diver);
    out.events.push({ type: 'bossLaunched', alienId: diver.id });
  }
}

/**
 * Runs the beams (warn, then fire while sweeping, then gone) and, once none is out and the pause
 * is over, starts the next wave: one or two beams aimed a little to either side of the ship and
 * sweeping toward where it was, so standing still gets hit.
 */
function stepBeams(boss: BossState, ph: 2 | 3, players: BossStepContext['players'], rng: Rng, dt: number, out: BossStep): void {
  const beams = (boss.beams ??= []);
  const hadBeams = beams.length > 0;
  let kept = 0;
  for (let i = 0; i < beams.length; i++) {
    const b = beams[i];
    b.timeLeft -= dt;
    if (b.state === 'warn') {
      if (b.timeLeft <= 0) {
        b.state = 'fire';
        b.timeLeft += HIVE_BEAM.fire[ph];
        out.events.push({ type: 'bossBeam', state: 'fire', angle: b.angle });
      }
    } else {
      b.angle += b.sweep * dt;
      if (b.timeLeft <= 0) continue;
    }
    beams[kept++] = b;
  }
  beams.length = kept;
  if (kept > 0) return;

  if (hadBeams) {
    boss.beamTimer = nextInterval(HIVE_BEAM.gap[ph], rng);
    return;
  }
  boss.beamTimer = (boss.beamTimer ?? 0) - dt;
  if (boss.beamTimer > 0) return;
  const target = nearestPlayer(players, boss.x);
  if (!target) {
    boss.beamTimer = HIVE_BEAM.gap[ph];
    return;
  }
  const aim = Math.atan2(SHIP_Y - boss.y, target.x - boss.x);
  const count = rng.next() < HIVE_BEAM.twoChance[ph] ? 2 : 1;
  const first = rng.next() < 0.5 ? -1 : 1;
  for (let k = 0; k < count; k++) {
    const side = k === 0 ? first : -first;
    const beam: BossBeam = {
      angle: aim + side * rng.range(HIVE_BEAM_AIM_OFFSET.min, HIVE_BEAM_AIM_OFFSET.max),
      sweep: -side * HIVE_BEAM.sweep[ph],
      state: 'warn',
      timeLeft: HIVE_BEAM.warn[ph],
    };
    beams.push(beam);
    out.events.push({ type: 'bossBeam', state: 'warn', angle: beam.angle });
  }
}
