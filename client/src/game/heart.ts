import { ALIEN_SPECS, HIT_FLASH_SECONDS, createAlien } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { SHIP_Y, nearestPlayer } from './player';
import type { Rng } from './rng';
import type { BossHit, BossStep, BossStepContext, PartSpec } from './boss';
import type { BossPart, BossState, Box, Shot } from './types';

// The Hive Heart, the final boss (wave 15): a huge heart in the hive's core fed by four veins.
// boss.ts dispatches to this module for the 'hiveHeart' kind, as it does to hivemind.ts for the
// Hive Mind, so the run uses the same API for every boss.
//
// The heart sits still at the boss's centre. Four veins reach out from it (two up, two down) and
// shield it: a shot that reaches the heart while any vein stands is stopped there (`blocked`, no
// damage, like the Brood Mother's core under its plates), so the veins have to be cut first. While
// the boss is still descending nothing is hit.
//
// Phases (a change announced with a bossPhase event):
//   1 (veins stand)   Every beat (HEART_BEAT_SECONDS, matched to the music) the heart fires a ring
//                     of shots that radiates from it, with a gap aimed near the ship.
//   2 (last vein cut) The heart is exposed. Beats come 25% faster (HEART_FAST_BEAT_FACTOR) and the rings a little quicker;
//                     a pair of free aliens (Drones, now and then a Warper) launches every ~4.5 s.
//   3 (heart below    Each beat sends a second ring (the echo) HEART_ECHO_DELAY later, its gap
//      1/3 health)    shifted a little from the first, and the heart sinks HEART_SINK art pixels.
//
// For the renderer: `boss.beatTimer` counts down to the next beat (the heart pulses on a
// `heartBeat` event), `boss.beats` counts the beats made (the first beat is the step after it lands), and the shots of a ring are ordinary
// enemy shots leaving the heart's edge. The echo ring has a `bossFired` event but no `heartBeat`.

// Layout --------------------------------------------------------------------------------------

/** Where the heart ends up, and where it starts so the whole boss is above the field. */
export const HEART_Y = 100;
export const HEART_START_Y = 195;
/** Speed of the descent, art pixels per second. */
export const HEART_DESCENT_SPEED = 45;

/** The heart's hit box (half sizes) and the radius the rings leave from, art pixels. */
export const HEART_HALF_WIDTH = 14;
export const HEART_HALF_HEIGHT = 12;
export const HEART_RADIUS = 14;

/** Hit points: the heart's is the knob for how long the fight lasts; each vein is a short job. */
export const HEART_HP = 380;
export const HEART_VEIN_HP = 30;
export const HEART_VEIN_COUNT = 4;
/** The heart's health fraction where phase 3 begins. */
export const HEART_PHASE_3_AT = 1 / 3;

/**
 * The Hive Heart's layout, for the renderer as well as the sim: vein_0 (upper left), vein_1
 * (upper right), vein_2 (lower left), vein_3 (lower right), then the heart, which is the last part.
 * dx and dy are from the boss's centre and match art/blender/hive_heart.py (`vein_0..3`, `heart`);
 * the vein boxes are slimmer than the tubes' bounding boxes so shots between a vein and the heart
 * are not eaten. The whole boss spans x +-54 and y -31 to +21 around its centre.
 */
export const HEART_PARTS: readonly PartSpec[] = [
  { kind: 'vein', dx: -30, dy: 12, halfWidth: 21, halfHeight: 7, hp: HEART_VEIN_HP },
  { kind: 'vein', dx: 30, dy: 12, halfWidth: 21, halfHeight: 7, hp: HEART_VEIN_HP },
  { kind: 'vein', dx: -31, dy: -15, halfWidth: 21, halfHeight: 9, hp: HEART_VEIN_HP },
  { kind: 'vein', dx: 31, dy: -15, halfWidth: 21, halfHeight: 9, hp: HEART_VEIN_HP },
  { kind: 'core', dx: 0, dy: 0, halfWidth: HEART_HALF_WIDTH, halfHeight: HEART_HALF_HEIGHT, hp: HEART_HP },
];

/** The box that holds every part, relative to the boss's centre, for a quick reject. */
const REACH_X = 54;
const REACH_Y_LOW = -31;
const REACH_Y_HIGH = 21;

// Tuning --------------------------------------------------------------------------------------

/** Seconds between beats in phase 1, matched to the heart track's tempo (the composer uses it). */
export const HEART_BEAT_SECONDS = 1;
/** Phases 2 and 3 beat at this fraction of the phase 1 interval (the music is locked to it). */
export const HEART_FAST_BEAT_FACTOR = 0.75;
/** Seconds between beats by phase. Beats keep their rhythm (no jitter). */
export const HEART_BEAT_INTERVAL = {
  1: HEART_BEAT_SECONDS,
  2: HEART_BEAT_SECONDS * HEART_FAST_BEAT_FACTOR,
  3: HEART_BEAT_SECONDS * HEART_FAST_BEAT_FACTOR,
} as const;

/** A ring: shots evenly spaced round the heart, with HEART_GAP_SHOTS of them left out where the gap is. */
export const HEART_RING_SHOTS = 40;
export const HEART_GAP_SHOTS = 2;
/** The angle between neighbouring shots of a ring, and the gap's width: (HEART_GAP_SHOTS + 1) spacings. */
export const HEART_RING_SPACING = (Math.PI * 2) / HEART_RING_SHOTS;
export const HEART_GAP_WIDTH = (HEART_GAP_SHOTS + 1) * HEART_RING_SPACING;
/** Ring shot speed by phase, art pixels per second. */
export const HEART_RING_SPEED = { 1: 68, 2: 76, 3: 84 } as const;
/**
 * Where the gap goes: the ring is turned so that one shot flies straight at the ship, the first
 * shot beside the gap (HEART_AIM_SHOT spacings from the gap's centre, on a random side), so a
 * ship that stands still is hit and a short step to that side reaches the gap. Without it a ring
 * at the ship's row is porous enough (shots ~36 px apart) that standing still was always safe.
 * HEART_AIM_JITTER (radians) keeps the aim from being pixel perfect.
 */
export const HEART_AIM_SHOT = (HEART_GAP_SHOTS + 1) / 2;
export const HEART_AIM_JITTER = 0.02;
/** The gap's middle must reach the ship's row at least this far inside the walls, art px; otherwise it goes on the other side of the ship. */
export const HEART_AIM_MARGIN = 12;

/** Phase 3: the echo ring follows this many seconds after the beat, with its gap shifted by this much (radians, either way). */
export const HEART_ECHO_DELAY = 0.25;
export const HEART_ECHO_SHIFT = { min: 0.08, max: 0.18 } as const;
/** Phase 3: how far the heart sinks, and how fast, art pixels (per second). */
export const HEART_SINK = 26;
export const HEART_SINK_SPEED = 9;

/** Phase 2 and 3: seconds between launched pairs (+-15%), the first after the veins fall, speed, and the chance a launched alien is a Warper. */
export const HEART_LAUNCH_INTERVAL = { 2: 4.5, 3: 6 } as const;
export const HEART_LAUNCH_FIRST_DELAY = 1.5;
export const HEART_LAUNCH_SPEED = 45;
export const HEART_WARPER_CHANCE = 0.3;

const INTERVAL_JITTER = 0.15;
const nextInterval = (base: number, rng: Rng) => base * rng.range(1 - INTERVAL_JITTER, 1 + INTERVAL_JITTER);

// State ---------------------------------------------------------------------------------------

/** Sets the heart's own state up when it is created: above the field, the first beat the moment it has landed. */
export function initHeart(boss: BossState): void {
  boss.y = HEART_START_Y;
  boss.vx = 0;
  boss.beatTimer = 0;
  boss.beats = 0;
  boss.heartEcho = 0;
  boss.heartEchoGap = 0;
  boss.launchTimer = 99;
}

/** True while it is still descending into view: it can't be hurt and doesn't attack. */
export function heartEntering(boss: BossState): boolean {
  return boss.y > HEART_Y;
}

/** The heart, which is the last part. */
function heartOf(boss: BossState): BossPart {
  return boss.parts[boss.parts.length - 1];
}

function veinsStanding(boss: BossState): boolean {
  for (const p of boss.parts) if (p.kind === 'vein' && p.hp > 0) return true;
  return false;
}

/** The veins' share of the boss bar: cutting them shows on it, though the heart takes no damage meanwhile. */
export const HEART_VEIN_BAR_SHARE = 0.25;

/**
 * What is left of the fight, 0 to 1, for the boss bar and the music: the veins' hit points as a
 * quarter of it and the heart's as the rest. (Phase 3 follows the heart's own hit points.)
 */
export function heartHealth(boss: BossState): number {
  const core = heartOf(boss);
  let veinHp = 0;
  let veinMax = 0;
  for (const p of boss.parts) {
    if (p.kind !== 'vein') continue;
    veinHp += Math.max(0, p.hp);
    veinMax += p.maxHp;
  }
  const veins = veinMax > 0 ? veinHp / veinMax : 0;
  const heart = core.maxHp > 0 ? Math.max(0, core.hp) / core.maxHp : 0;
  return HEART_VEIN_BAR_SHARE * veins + (1 - HEART_VEIN_BAR_SHARE) * heart;
}

// Hits ----------------------------------------------------------------------------------------

function hurt(part: BossPart, amount: number): BossHit {
  part.hp = Math.max(0, part.hp - amount);
  part.flash = HIT_FLASH_SECONDS;
  return { part, destroyed: part.hp <= 0 };
}

/**
 * A shot against the heart: like hitBoss. Parts are tried from the bottom up, a vein before the
 * heart. A shot reaching the heart while any vein stands is blocked: no damage, the shot is spent.
 * Destroyed parts are ignored, so shots pass through their gaps. Null if nothing is touched or
 * the heart is still descending.
 */
export function hitHeart(boss: BossState, shotBox: Box, damage: number): BossHit | null {
  if (damage <= 0 || heartEntering(boss)) return null;
  const rx = shotBox.x - boss.x;
  const ry = shotBox.y - boss.y;
  if (Math.abs(rx) >= REACH_X + shotBox.halfWidth || ry + shotBox.halfHeight <= REACH_Y_LOW || ry - shotBox.halfHeight >= REACH_Y_HIGH) return null;
  let vein: BossPart | null = null;
  let core: BossPart | null = null;
  for (const p of boss.parts) {
    if (p.hp <= 0) continue;
    if (Math.abs(rx - p.dx) >= shotBox.halfWidth + p.halfWidth || Math.abs(ry - p.dy) >= shotBox.halfHeight + p.halfHeight) continue;
    if (p.kind === 'vein') {
      if (vein === null || p.dy - p.halfHeight < vein.dy - vein.halfHeight) vein = p;
    } else {
      core = p;
    }
  }
  if (vein) return hurt(vein, damage);
  if (!core) return null;
  if (veinsStanding(boss)) return { part: core, destroyed: false, blocked: true };
  return hurt(core, damage);
}

/**
 * A vertical beam against the heart: like beamHitBoss. Where a beam at `x`, rising from `bottomY`,
 * stops: the lowest standing part in its column (a vein stands in front of the heart at the same
 * height), the part's bottom edge as `y`, and whether the shielded heart blocks it.
 */
export function beamHitHeart(boss: BossState, x: number, bottomY: number): { part: BossPart; blocked: boolean; y: number } | null {
  if (heartEntering(boss) || Math.abs(x - boss.x) >= REACH_X) return null;
  let best: BossPart | null = null;
  let bestBottom = Infinity;
  for (const p of boss.parts) {
    if (p.hp <= 0 || Math.abs(x - (boss.x + p.dx)) >= p.halfWidth) continue;
    const bottom = boss.y + p.dy - p.halfHeight;
    if (boss.y + p.dy + p.halfHeight <= bottomY) continue;
    if (best === null || bottom < bestBottom || (bottom === bestBottom && best.kind === 'core' && p.kind !== 'core')) {
      best = p;
      bestBottom = bottom;
    }
  }
  if (!best) return null;
  return { part: best, blocked: best.kind === 'core' && veinsStanding(boss), y: Math.max(bottomY, bestBottom) };
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

/** Begins `phase`: resets the timers it uses. */
function enterPhase(boss: BossState, phase: number, out: BossStep): void {
  boss.phase = phase;
  boss.phaseTime = 0;
  out.events.push({ type: 'bossPhase', phase });
  if (phase === 2) {
    boss.launchTimer = HEART_LAUNCH_FIRST_DELAY;
    boss.beatTimer = Math.min(boss.beatTimer ?? 0, HEART_BEAT_INTERVAL[2]);
  } else {
    boss.launchTimer = Math.max(boss.launchTimer, HEART_LAUNCH_FIRST_DELAY);
  }
}

/**
 * Advances the Hive Heart by one step: the phase change, the descent (and the sink in phase 3),
 * the beats with their rings, the echo, and the launches. A stunned heart only counts its stun down.
 */
export function stepHeart(boss: BossState, ctx: BossStepContext, out: BossStep): void {
  const { players, rng, dt, newId } = ctx;
  const heart = heartOf(boss);
  if (heart.hp <= 0) return;

  // One phase per step: 3 from the heart's health (integer maths), 2 once the veins are gone.
  const want = heart.hp * 3 <= heart.maxHp ? 3 : veinsStanding(boss) ? 1 : 2;
  if (want > boss.phase) enterPhase(boss, boss.phase + 1, out);
  boss.phaseTime += dt;

  if (boss.stun > 0) {
    boss.stun = Math.max(0, boss.stun - dt);
    return;
  }

  if (heartEntering(boss)) {
    boss.y = Math.max(HEART_Y, boss.y - HEART_DESCENT_SPEED * dt);
    return;
  }
  const phase = boss.phase >= 3 ? 3 : boss.phase >= 2 ? 2 : 1;
  if (phase === 3) boss.y = Math.max(HEART_Y - HEART_SINK, boss.y - HEART_SINK_SPEED * dt);

  // Phase 3: the echo ring follows the beat's.
  if ((boss.heartEcho ?? 0) > 0) {
    boss.heartEcho = (boss.heartEcho ?? 0) - dt;
    if (boss.heartEcho <= 0) {
      boss.heartEcho = 0;
      fireRing(boss, boss.heartEchoGap ?? -Math.PI / 2, phase, newId, out);
    }
  }

  boss.beatTimer = (boss.beatTimer ?? 0) - dt;
  if (boss.beatTimer <= 0) {
    // Keeping the remainder keeps the rhythm exact.
    boss.beatTimer += HEART_BEAT_INTERVAL[phase];
    if (boss.beatTimer <= 0) boss.beatTimer = HEART_BEAT_INTERVAL[phase];
    beat(boss, phase, players, rng, newId, out);
  }

  if (phase !== 1) {
    boss.launchTimer -= dt;
    if (boss.launchTimer <= 0) {
      launchPair(boss, rng, newId, out);
      boss.launchTimer = nextInterval(HEART_LAUNCH_INTERVAL[phase], rng);
    }
  }
}

/** A beat: counted always; with a ship to aim at, a ring goes out with its gap near the ship (and in phase 3 an echo is set up). */
function beat(boss: BossState, phase: 1 | 2 | 3, players: BossStepContext['players'], rng: Rng, newId: () => number, out: BossStep): void {
  boss.beats = (boss.beats ?? 0) + 1;
  const target = nearestPlayer(players, boss.x);
  if (!target) return;
  const aim = Math.atan2(SHIP_Y - boss.y, target.x - boss.x);
  // Either side of the ship, at random, unless that side's gap would reach the ship's row off the
  // field (a ship near a wall): then the other side.
  const step = HEART_AIM_SHOT * HEART_RING_SPACING;
  const onField = (angle: number) => Math.abs(rowXAt(boss, angle)) < FIELD_WIDTH / 2 - HEART_AIM_MARGIN;
  let side = rng.next() < 0.5 ? -1 : 1;
  if (!onField(aim + side * step)) side = -side;
  const gap = aim + side * step + rng.range(-HEART_AIM_JITTER, HEART_AIM_JITTER);
  out.events.push({ type: 'heartBeat', x: boss.x, y: boss.y, phase, gapAngle: gap });
  fireRing(boss, gap, phase, newId, out);
  if (phase === 3) {
    const shift = rng.range(HEART_ECHO_SHIFT.min, HEART_ECHO_SHIFT.max);
    boss.heartEcho = HEART_ECHO_DELAY;
    boss.heartEchoGap = gap + (rng.next() < 0.5 ? -shift : shift);
  }
}

/** Where a shot fired from the heart at `angle` crosses the ship's row (far off for a shot that never comes down). */
function rowXAt(boss: BossState, angle: number): number {
  const s = Math.sin(angle);
  if (s >= -1e-6) return Infinity;
  return boss.x + (Math.cos(angle) / s) * (SHIP_Y - boss.y);
}

/** One ring from the heart's edge: HEART_RING_SHOTS evenly spaced shots, none within the gap round `gap`. */
function fireRing(boss: BossState, gap: number, phase: 1 | 2 | 3, newId: () => number, out: BossStep): void {
  const speed = HEART_RING_SPEED[phase];
  const half = HEART_RING_SHOTS / 2;
  for (let k = -half; k < half; k++) {
    const offset = k + 0.5;
    if (Math.abs(offset) < HEART_GAP_SHOTS / 2) continue;
    const a = gap + offset * HEART_RING_SPACING;
    const c = Math.cos(a);
    const s = Math.sin(a);
    out.shots.push(enemyShot(newId(), boss.x + c * HEART_RADIUS, boss.y + s * HEART_RADIUS, c * speed, s * speed));
  }
  out.events.push({ type: 'bossFired', x: boss.x, y: boss.y - HEART_RADIUS });
}

/** A pair of free aliens leaves the heart, one each side: Drones, now and then a Warper. */
function launchPair(boss: BossState, rng: Rng, newId: () => number, out: BossStep): void {
  for (let side = -1; side <= 1; side += 2) {
    const kind = rng.next() < HEART_WARPER_CHANCE ? 'warper' : 'drone';
    const alien = createAlien(kind, newId(), -1, -1, boss.x + side * 16, boss.y - HEART_RADIUS - ALIEN_SPECS[kind].halfHeight);
    alien.mode = 'free';
    alien.vx = side * rng.range(8, 20);
    alien.vy = -HEART_LAUNCH_SPEED;
    out.launched.push(alien);
    out.events.push({ type: 'bossLaunched', alienId: alien.id });
  }
}
