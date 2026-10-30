import { DIVE_SECONDS, damageAlien, divePosition } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { enemyTimeScale } from './powerups';
import type { Alien, GravityWell, PlayerState, RunEvent, RunState } from './types';

// The Gravity Well Special: a vortex that hangs mid-field for a few seconds. Enemy shots near it
// curve in and are swallowed at its core; free aliens (Splitter minis, boss Drones) and divers
// mid-dive are dragged to the centre and ground down. Aliens in their formation slots, the boss
// and the Hive Mind's beams are unaffected. It runs on real time (a Time Stop does not hold it),
// but the things it pulls move on enemy time, so a frozen shot stays frozen. Pure functions over
// the run: `special.ts` creates the well, `run.ts` steps it each playing step (after the shots
// have flown) and finishes the kills, and clears it when a wave starts or the run ends.

/** Seconds the well lasts. */
export const WELL_SECONDS = 3;
/** The well's reach: enemy shots and free aliens inside it are pulled, art pixels. */
export const WELL_RADIUS = 60;
/** An enemy shot this close to the centre is swallowed, art pixels. */
export const WELL_CORE = 6;
/** Aliens inside this radius are ground down, art pixels. */
export const WELL_GRIND_RADIUS = 14;
/** Seconds between grind ticks; each tick does WELL_GRIND_DAMAGE to every alien in the grind radius. */
export const WELL_GRIND_SECONDS = 0.4;
export const WELL_GRIND_DAMAGE = 1;
/** Where the well sits: mid-field, and no nearer the side walls than this, art pixels. */
export const WELL_Y = 0;
export const WELL_WALL_MARGIN = 30;
/** Shots: per second, how fast the velocity turns toward the centre at the core (scaled by closeness, 0 at the rim). */
export const WELL_SHOT_PULL = 14;
/** A pulled shot flies at least this fast, so a slow one still falls in, art pixels per second. */
export const WELL_SHOT_MIN_SPEED = 90;
/** Aliens: the speed they are dragged in at the core; half of it at the rim, art pixels per second. */
export const WELL_ALIEN_PULL_SPEED = 130;
/** How far ahead a captured diver's heading is read from its dive path, seconds. */
const DIVE_LOOKAHEAD = 0.05;

/** A well for `player`'s Special: at the ship's x (kept inside the walls), mid-field, full time. */
export function createWell(player: PlayerState): GravityWell {
  const limit = FIELD_WIDTH / 2 - WELL_WALL_MARGIN;
  return { x: Math.max(-limit, Math.min(limit, player.x)), y: WELL_Y, timeLeft: WELL_SECONDS, playerId: player.id };
}

/** An alien the well ground down this step; `killed` ones are at 0 hp and wait for the run to score and remove them. */
export interface WellHit {
  alien: Alien;
  killed: boolean;
}

export interface WellResult {
  /** `wellConsumed` for each enemy shot swallowed. */
  events: RunEvent[];
  /** Aliens hurt by a grind tick, in the order of `run.aliens`. */
  hits: WellHit[];
}

/**
 * A diver mid-dive that falls into the well breaks off its dive and flies free from there, like a
 * launched Drone (a dive is a fixed curve, so it cannot be dragged off it). It keeps the heading
 * its dive had, and loses its slot.
 */
function releaseDiver(alien: Alien): void {
  if (alien.dive) {
    const now = alien.modeTime;
    const a = divePosition(alien.dive, Math.min(1, now / DIVE_SECONDS));
    const b = divePosition(alien.dive, Math.min(1, (now + DIVE_LOOKAHEAD) / DIVE_SECONDS));
    alien.vx = (b.x - a.x) / DIVE_LOOKAHEAD;
    alien.vy = (b.y - a.y) / DIVE_LOOKAHEAD;
  }
  alien.mode = 'free';
  alien.col = -1;
  alien.row = -1;
  alien.modeTime = 0;
  delete alien.dive;
}

/**
 * Steps the run's well by `dt` real seconds (nothing if there is none): swallows and bends enemy
 * shots, drags free aliens and divers in, grinds the ones at the centre on its tick, and removes
 * itself when its time is up. Returns the events and the aliens it hurt; the caller scores the
 * kills (`killAlien` with no meter charge and no burst, as for a Pulse Bomb), drops the dead
 * and flushes spawned minis.
 */
export function stepWell(run: RunState, dt: number): WellResult {
  const result: WellResult = { events: [], hits: [] };
  const well = run.well;
  if (!well || dt <= 0) return result;
  const edt = dt * enemyTimeScale(run);
  const moveDt = run.stun > 0 ? 0 : edt;

  pullShots(run, well, edt, result);
  pullAliens(run, well, moveDt);

  // Grind ticks fall on a fixed beat measured from when the well opened.
  const before = Math.floor((WELL_SECONDS - well.timeLeft) / WELL_GRIND_SECONDS + 1e-9);
  well.timeLeft = Math.max(0, well.timeLeft - dt);
  const after = Math.floor((WELL_SECONDS - well.timeLeft) / WELL_GRIND_SECONDS + 1e-9);
  if (after > before) grind(run, well, result);

  if (well.timeLeft <= 0) run.well = null;
  return result;
}

function pullShots(run: RunState, well: GravityWell, edt: number, result: WellResult): void {
  let swallowed: Set<number> | null = null;
  for (const shot of run.shots) {
    if (shot.owner !== 'alien') continue;
    const dx = well.x - shot.x;
    const dy = well.y - shot.y;
    const dist = Math.hypot(dx, dy);
    if (dist > WELL_RADIUS) continue;
    if (dist <= WELL_CORE) {
      (swallowed ??= new Set()).add(shot.id);
      result.events.push({ type: 'wellConsumed', x: shot.x, y: shot.y });
      continue;
    }
    if (edt <= 0) continue;
    // Steer the velocity toward the centre, harder the closer in it is.
    const speed = Math.max(Math.hypot(shot.vx, shot.vy), WELL_SHOT_MIN_SPEED);
    const k = Math.min(1, WELL_SHOT_PULL * (1 - dist / WELL_RADIUS) * edt);
    const vx = shot.vx + ((dx / dist) * speed - shot.vx) * k;
    const vy = shot.vy + ((dy / dist) * speed - shot.vy) * k;
    // Turning, not slowing: keep the speed through the blend.
    const scale = speed / (Math.hypot(vx, vy) || 1);
    shot.vx = vx * scale;
    shot.vy = vy * scale;
  }
  if (swallowed) run.shots = run.shots.filter((s) => !swallowed.has(s.id));
}

function pullAliens(run: RunState, well: GravityWell, moveDt: number): void {
  if (moveDt <= 0) return;
  for (const alien of run.aliens) {
    if (alien.hp <= 0 || (alien.mode !== 'free' && alien.mode !== 'diving')) continue;
    const dx = well.x - alien.x;
    const dy = well.y - alien.y;
    const dist = Math.hypot(dx, dy);
    if (dist > WELL_RADIUS) continue;
    if (alien.mode === 'diving') releaseDiver(alien);
    if (dist === 0) {
      alien.vx = 0;
      alien.vy = 0;
      continue;
    }
    // Drag it in: faster closer to the centre, but never faster than reaches the centre in a step.
    const speed = Math.min(WELL_ALIEN_PULL_SPEED * (0.5 + 0.5 * (1 - dist / WELL_RADIUS)), dist / moveDt);
    alien.vx = (dx / dist) * speed;
    alien.vy = (dy / dist) * speed;
  }
}

function grind(run: RunState, well: GravityWell, result: WellResult): void {
  for (const alien of run.aliens) {
    if (alien.hp <= 0 || alien.mode !== 'free') continue;
    if (Math.hypot(well.x - alien.x, well.y - alien.y) > WELL_GRIND_RADIUS) continue;
    let killed = false;
    for (let i = 0; i < WELL_GRIND_DAMAGE && !killed; i++) killed = damageAlien(alien);
    result.hits.push({ alien, killed });
  }
}
