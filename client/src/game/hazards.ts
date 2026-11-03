import { beamStopY, bunkerPixelSolid, erodeByRect, erodeColumn } from './bunkers';
import { SHOT_HALF_HEIGHT, SHOT_HALF_WIDTH } from './collision';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { SHIP_Y, isAlive } from './player';
import { WAVES } from './waves';
import type { Box, Bunker, Mine, RunEvent, RunState, Shot } from './types';

// Sector 3's hazards: mines that drift down the field, and acid rain.
//
// - A mine drifts down slowly. A player's shot bursts it (shootMine), damaging the aliens within
//   MINE_BURST_RADIUS (the run applies the damage, credited to the shooter). A mine that touches a
//   bunker goes off there and bites it; one that reaches the ship's row goes off, and its blast
//   hurts a ship close by.
// - Acid rain: a column is marked at the top for ACID_WARN_SECONDS, then rains for
//   ACID_RAIN_SECONDS; the rain hurts a ship standing in it and eats bunkers from above.
//
// Everything runs on enemy time (the run passes a dt that is 0 under Time Stop and halved by
// Slow), draws its randomness only from `run.rng` and its ids from `run.nextId`, and does
// nothing, and draws nothing, on a wave without mineRate / acidRate, so the earlier waves play out
// exactly as they did before sector 3 existed.

/** Radius of a shot mine's burst, art pixels, and the damage it does to each alien inside. */
export const MINE_BURST_RADIUS = 26;
export const MINE_BURST_DAMAGE = 2;
export const ACID_WARN_SECONDS = 1;
export const ACID_RAIN_SECONDS = 1.5;

/** Half size of a mine's square hit box, art pixels. */
export const MINE_HALF_SIZE = 4;
/** Mines on screen at once; a mine that would be the next waits its turn. */
export const MAX_MINES = 4;
/** Radius of the blast a mine makes at the ship's row: a ship whose box it touches is hurt. */
export const MINE_BLAST = 16;
/** Half size of the bite a mine takes out of the bunker it hits (a square, so 8 by 8 pixels). */
export const MINE_BITE_HALF = 4;
/** The radius reported in a 'bunker' burst, for the renderer's puff. */
export const MINE_BUNKER_BURST_RADIUS = 8;

/** A mine's fall speed is drawn from this range, art pixels per second. */
export const MINE_FALL_SPEED_MIN = 18;
export const MINE_FALL_SPEED_MAX = 24;
/** Peak sideways speed of a mine's sway, art pixels per second, and how fast the sway cycles along the fall. */
export const MINE_SWAY_SPEED = 10;
const MINE_SWAY_PER_PIXEL = 0.1;
/** Mines spawn and stay this far inside the walls (centre x), and spawn this far below the top edge. */
export const MINE_WALL_MARGIN = 10;
const MINE_SPAWN_Y = FIELD_HEIGHT / 2 - MINE_HALF_SIZE;
/** The y at which a mine counts as having reached the ship's row. */
export const MINE_GROUND_Y = SHIP_Y;
/** The first mine arrives this long after the wave starts playing (a range, seconds). */
const MINE_FIRST_DELAY_MIN = 0.8;
const MINE_FIRST_DELAY_MAX = 1.6;

/** Acid columns live at once. */
export const MAX_ACID = 2;
/** Half width of an acid column, art pixels. */
export const ACID_HALF_WIDTH = 7;
/** The first column starts this long after the wave starts playing (a range, seconds). */
const ACID_FIRST_DELAY_MIN = 1.5;
const ACID_FIRST_DELAY_MAX = 2.5;
/** Seconds between a raining column's bites out of the bunkers under it (one pixel row each). */
export const ACID_ERODE_INTERVAL = 0.3;
/** Half width of each acid bite; three bites side by side cover a column. */
const ACID_BITE_WIDTH = 5;
/** A column is placed this far inside the walls, and (some of the time) within this of a ship. */
const ACID_WALL_MARGIN = ACID_HALF_WIDTH + 4;
const ACID_AIM_SPREAD = 10;
/** The chance a new column is aimed at a living ship rather than put anywhere. */
const ACID_AIM_CHANCE = 0.6;
/** Tries at finding a spot clear of the other columns before the column is skipped. */
const ACID_PLACE_TRIES = 4;
/** After a column is skipped (no spot, or the cap), wait this long (seconds) before trying again. */
const ACID_RETRY_SECONDS = 0.5;

const NO_HURT: Box[] = [];

/** A mine's hit box. */
export function mineBox(mine: Mine): Box {
  return { x: mine.x, y: mine.y, halfWidth: MINE_HALF_SIZE, halfHeight: MINE_HALF_SIZE };
}

/** Seconds to the next mine or column at `rate` per second: the average gap, scaled by 0.6 to 1.4. */
function nextGap(run: RunState, rate: number): number {
  return run.rng.range(0.6, 1.4) / rate;
}

/** Clears the hazards and sets the spawn timers for the wave now starting (run.wave). */
export function resetHazards(run: RunState): void {
  run.mines = [];
  run.acid = [];
  run.mineTimer = 0;
  run.acidTimer = 0;
  const def = WAVES[run.wave];
  // Draw from the rng only on the waves that use it, so the other waves' random streams don't move.
  if (def?.mineRate) run.mineTimer = run.rng.range(MINE_FIRST_DELAY_MIN, MINE_FIRST_DELAY_MAX);
  if (def?.acidRate) run.acidTimer = run.rng.range(ACID_FIRST_DELAY_MIN, ACID_FIRST_DELAY_MAX);
}

/**
 * Spawns, moves and ends mines and acid columns on enemy time `dt`, bites bunkers, and returns
 * the areas that hurt a ship this step (a mine's blast at the ship's row, a raining column). The
 * run damages a vulnerable ship touching any of them.
 */
export function stepHazards(run: RunState, dt: number, events: RunEvent[]): Box[] {
  // Frozen (Time Stop): nothing spawns, moves or hurts.
  if (dt <= 0) return NO_HURT;
  const def = WAVES[run.wave];
  if (!def) return NO_HURT;
  // Most steps hurt nobody, so the list is only made when there is something to put in it.
  let hurt: Box[] | null = null;

  if (def.mineRate) {
    run.mineTimer -= dt;
    if (run.mineTimer <= 0) {
      run.mineTimer = nextGap(run, def.mineRate);
      if (run.mines.length < MAX_MINES) spawnMine(run, events);
    }
  }
  if (run.mines.length > 0) hurt = stepMines(run, dt, events, hurt);

  if (def.acidRate) {
    run.acidTimer -= dt;
    if (run.acidTimer <= 0) {
      run.acidTimer = nextGap(run, def.acidRate);
      if (run.acid.length < MAX_ACID && !startAcid(run, events)) run.acidTimer = ACID_RETRY_SECONDS;
    }
  }
  if (run.acid.length > 0) hurt = stepAcid(run, dt, events, hurt);

  return hurt ?? NO_HURT;
}

// Mines ------------------------------------------------------------------------------------------

function spawnMine(run: RunState, events: RunEvent[]): void {
  const limit = FIELD_WIDTH / 2 - MINE_WALL_MARGIN;
  const mine: Mine = {
    id: run.nextId++,
    x: run.rng.range(-limit, limit),
    y: MINE_SPAWN_Y,
    vx: 0,
    vy: -run.rng.range(MINE_FALL_SPEED_MIN, MINE_FALL_SPEED_MAX),
  };
  mine.vx = swayOf(mine);
  run.mines.push(mine);
  events.push({ type: 'mineSpawned', mineId: mine.id, x: mine.x, y: mine.y });
}

/**
 * The sideways speed of a mine's sway. It is a function of how far the mine has fallen (and its
 * id, so neighbours aren't in step) rather than of a clock, so a mine needs no extra state and a
 * slowed mine sways slowly with its fall.
 */
function swayOf(mine: Mine): number {
  return MINE_SWAY_SPEED * Math.cos(mine.y * MINE_SWAY_PER_PIXEL + mine.id);
}

/** Does the mine's box touch a solid pixel of the bunker? */
function mineTouchesBunker(bunker: Bunker, mine: Mine): boolean {
  const left = mine.x - MINE_HALF_SIZE;
  const right = mine.x + MINE_HALF_SIZE;
  const bottom = mine.y - MINE_HALF_SIZE;
  const top = mine.y + MINE_HALF_SIZE;
  if (right <= bunker.x || left >= bunker.x + bunker.width) return false;
  if (top <= bunker.y || bottom >= bunker.y + bunker.height) return false;
  const colMin = Math.max(0, Math.floor(left - bunker.x));
  const colMax = Math.min(bunker.width - 1, Math.ceil(right - bunker.x) - 1);
  const rowMin = Math.max(0, Math.floor(bottom - bunker.y));
  const rowMax = Math.min(bunker.height - 1, Math.ceil(top - bunker.y) - 1);
  for (let row = rowMin; row <= rowMax; row++) {
    for (let col = colMin; col <= colMax; col++) {
      if (bunkerPixelSolid(bunker, col, row)) return true;
    }
  }
  return false;
}

/** Moves the mines; one that meets a bunker or the ship's row goes off. Returns the (maybe new) hurt list. */
function stepMines(run: RunState, dt: number, events: RunEvent[], hurt: Box[] | null): Box[] | null {
  const limit = FIELD_WIDTH / 2 - MINE_WALL_MARGIN;
  let kept = 0;
  for (let i = 0; i < run.mines.length; i++) {
    const mine = run.mines[i];
    mine.vx = swayOf(mine);
    mine.x = Math.max(-limit, Math.min(limit, mine.x + mine.vx * dt));
    mine.y += mine.vy * dt;

    let burst: 'bunker' | 'ground' | null = null;
    if (mine.y <= MINE_GROUND_Y) {
      burst = 'ground';
    } else {
      for (let b = 0; b < run.bunkers.length; b++) {
        if (mineTouchesBunker(run.bunkers[b], mine)) {
          burst = 'bunker';
          break;
        }
      }
    }
    if (burst === null) {
      run.mines[kept++] = mine;
      continue;
    }
    if (burst === 'bunker') {
      erodeByRect(run.bunkers, mine.x, mine.y, MINE_BITE_HALF, MINE_BITE_HALF);
      events.push({ type: 'mineBurst', mineId: mine.id, x: mine.x, y: mine.y, radius: MINE_BUNKER_BURST_RADIUS, cause: 'bunker' });
    } else {
      events.push({ type: 'mineBurst', mineId: mine.id, x: mine.x, y: mine.y, radius: MINE_BLAST, cause: 'ground' });
      (hurt ??= []).push({ x: mine.x, y: mine.y, halfWidth: MINE_BLAST, halfHeight: MINE_BLAST });
    }
  }
  run.mines.length = kept;
  return hurt;
}

/**
 * A player's shot against the mines: bursts the first mine it touches (removing it, with a
 * mineBurst event) and returns the burst's centre, or null if it touched none. The run spends the
 * shot and applies the burst's damage to aliens.
 */
export function shootMine(run: RunState, shot: Shot, events: RunEvent[]): { x: number; y: number } | null {
  // The same test as overlaps(shotBox(shot), mineBox(mine)), without building the boxes: the run
  // asks this for every player shot on every step while a mine is out.
  for (let i = 0; i < run.mines.length; i++) {
    const mine = run.mines[i];
    if (Math.abs(shot.x - mine.x) >= SHOT_HALF_WIDTH + MINE_HALF_SIZE) continue;
    if (Math.abs(shot.y - mine.y) >= SHOT_HALF_HEIGHT + MINE_HALF_SIZE) continue;
    run.mines.splice(i, 1);
    events.push({ type: 'mineBurst', mineId: mine.id, x: mine.x, y: mine.y, radius: MINE_BURST_RADIUS, cause: 'shot' });
    return { x: mine.x, y: mine.y };
  }
  return null;
}

// Acid rain --------------------------------------------------------------------------------------

/** Is there room for a column at x beside the live ones? */
function acidClear(run: RunState, x: number): boolean {
  for (const other of run.acid) {
    if (Math.abs(other.x - x) < other.halfWidth + ACID_HALF_WIDTH + 2) return false;
  }
  return true;
}

/** Starts a column in its warning; false if no clear spot was found. */
function startAcid(run: RunState, events: RunEvent[]): boolean {
  const limit = FIELD_WIDTH / 2 - ACID_WALL_MARGIN;
  for (let attempt = 0; attempt < ACID_PLACE_TRIES; attempt++) {
    let x: number;
    // Often under a living ship, so the rain threatens rather than only decorates; else anywhere.
    const target = run.players.length > 0 && run.rng.next() < ACID_AIM_CHANCE ? run.players[run.rng.int(run.players.length)] : null;
    if (target && isAlive(target)) {
      x = Math.max(-limit, Math.min(limit, target.x + run.rng.range(-ACID_AIM_SPREAD, ACID_AIM_SPREAD)));
    } else {
      x = run.rng.range(-limit, limit);
    }
    if (!acidClear(run, x)) continue;
    const column = { id: run.nextId++, x, halfWidth: ACID_HALF_WIDTH, state: 'warn' as const, timeLeft: ACID_WARN_SECONDS };
    run.acid.push(column);
    events.push({ type: 'acidColumn', columnId: column.id, state: 'warn', x, halfWidth: column.halfWidth });
    return true;
  }
  return false;
}

/** Counts the columns down through warn and rain, hurts and bites while raining, and removes the finished. */
function stepAcid(run: RunState, dt: number, events: RunEvent[], hurt: Box[] | null): Box[] | null {
  const top = FIELD_HEIGHT / 2;
  let kept = 0;
  for (let i = 0; i < run.acid.length; i++) {
    const column = run.acid[i];
    const before = column.timeLeft;
    column.timeLeft -= dt;
    if (column.state === 'warn' && column.timeLeft <= 0) {
      column.state = 'rain';
      // Carry the overshoot over, so the two phases add up to exactly their lengths.
      column.timeLeft += ACID_RAIN_SECONDS;
      events.push({ type: 'acidColumn', columnId: column.id, state: 'rain', x: column.x, halfWidth: column.halfWidth });
    } else if (column.state === 'rain') {
      if (column.timeLeft <= 0) {
        events.push({ type: 'acidColumn', columnId: column.id, state: 'end', x: column.x, halfWidth: column.halfWidth });
        continue;
      }
      // From the top of the field to the ship's row; the run only hurts a ship that is vulnerable.
      (hurt ??= []).push({ x: column.x, y: (top + SHIP_Y) / 2, halfWidth: column.halfWidth, halfHeight: (top - SHIP_Y) / 2 });
      // A bite out of the top of each bunker under the column every ACID_ERODE_INTERVAL: about one
      // pixel row each, so it takes the whole rain to dig a few rows in, not an instant.
      if (run.bunkers.length > 0 && Math.floor(before / ACID_ERODE_INTERVAL) !== Math.floor(column.timeLeft / ACID_ERODE_INTERVAL)) {
        for (let k = -1; k <= 1; k++) {
          const x = column.x + k * (column.halfWidth / 2);
          const stop = beamStopY(run.bunkers, x, top, 'down');
          if (stop !== null) erodeColumn(run.bunkers, x, stop, ACID_BITE_WIDTH);
        }
      }
    }
    run.acid[kept++] = column;
  }
  run.acid.length = kept;
  return hurt;
}
