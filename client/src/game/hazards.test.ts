import { describe, expect, it } from 'vitest';
import { bunkerSolidCount, createBunkers } from './bunkers';
import {
  ACID_HALF_WIDTH,
  ACID_RAIN_SECONDS,
  ACID_WARN_SECONDS,
  MAX_ACID,
  MAX_MINES,
  MINE_BLAST,
  MINE_BURST_RADIUS,
  MINE_FALL_SPEED_MAX,
  MINE_FALL_SPEED_MIN,
  MINE_GROUND_Y,
  MINE_HALF_SIZE,
  mineBox,
  resetHazards,
  shootMine,
  stepHazards,
} from './hazards';
import { overlaps } from './collision';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { SHIP_Y, shipBox } from './player';
import { WAVE_INTRO_SECONDS, chooseSpecial, createRun, stepRun } from './run';
import { NO_INPUT } from './types';
import type { AcidColumn, Mine, RunEvent, RunState, Shot } from './types';

const DT = 1 / 120;
/** Wave indices: 12 is wave 13 (mines), 13 is wave 14 (mines and acid rain), 0 has no hazards. */
const MINE_WAVE = 12;
const ACID_WAVE = 13;

/** A playing run on `wave`, hazards reset, with no bunkers unless asked. */
function hazardRun(wave: number, bunkers = false, seed = 7): RunState {
  const run = createRun(seed, 1, wave);
  chooseSpecial(run, 'pulseBomb');
  run.phase = 'playing';
  run.bunkers = bunkers ? createBunkers(() => run.nextId++) : [];
  run.aliens = [];
  run.shots = [];
  resetHazards(run);
  return run;
}

/** Steps the hazards `seconds` of enemy time and collects events and hurt boxes. */
function advance(run: RunState, seconds: number, dt = DT) {
  const events: RunEvent[] = [];
  const hurt: ReturnType<typeof stepHazards> = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) hurt.push(...stepHazards(run, dt, events));
  return { events, hurt };
}

const mineAt = (run: RunState, x: number, y: number, vy = -20): Mine => {
  const m: Mine = { id: run.nextId++, x, y, vx: 0, vy };
  run.mines.push(m);
  return m;
};

const columnAt = (run: RunState, x: number, state: AcidColumn['state'], timeLeft: number): AcidColumn => {
  const c: AcidColumn = { id: run.nextId++, x, halfWidth: ACID_HALF_WIDTH, state, timeLeft };
  run.acid.push(c);
  return c;
};

const playerShot = (x: number, y: number): Shot => ({
  id: 999, owner: 'player', kind: 'normal', playerId: 0, x, y, vx: 0, vy: 300, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: 1,
});

describe('resetHazards', () => {
  it('clears the mines and columns and sets timers on a wave with the rates', () => {
    const run = hazardRun(ACID_WAVE);
    mineAt(run, 0, 0);
    columnAt(run, 0, 'rain', 1);
    resetHazards(run);
    expect(run.mines).toEqual([]);
    expect(run.acid).toEqual([]);
    // The first of each comes a little after the wave starts, not at once.
    expect(run.mineTimer).toBeGreaterThan(1);
    expect(run.acidTimer).toBeGreaterThan(1);
  });

  it('only times what the wave has, and draws nothing from the rng on a wave without hazards', () => {
    const mines = hazardRun(MINE_WAVE);
    expect(mines.mineTimer).toBeGreaterThan(0);
    expect(mines.acidTimer).toBe(0);

    const plain = hazardRun(0);
    expect(plain.mineTimer).toBe(0);
    expect(plain.acidTimer).toBe(0);
    const twin = hazardRun(0);
    resetHazards(twin);
    expect(twin.rng.next()).toBe(plain.rng.next());
  });
});

describe('mines', () => {
  it('do not spawn on a wave without a mine rate', () => {
    const run = hazardRun(0);
    const { events } = advance(run, 60);
    expect(run.mines).toEqual([]);
    expect(run.acid).toEqual([]);
    expect(events).toEqual([]);
  });

  it('spawn on wave 13 over time, at the top inside the walls, announced by an event', () => {
    const run = hazardRun(MINE_WAVE);
    const { events } = advance(run, 12);
    const spawned = events.filter((e) => e.type === 'mineSpawned');
    expect(spawned.length).toBeGreaterThanOrEqual(2);
    for (const e of spawned) {
      if (e.type !== 'mineSpawned') continue;
      expect(Math.abs(e.x)).toBeLessThan(FIELD_WIDTH / 2 - MINE_HALF_SIZE);
      expect(e.y).toBeGreaterThan(FIELD_HEIGHT / 2 - 10);
    }
    expect(events.some((e) => e.type === 'acidColumn')).toBe(false);
  });

  it('wave 13 does not start a mine at once (the first comes 0.8-1.6 s in)', () => {
    const run = hazardRun(MINE_WAVE);
    advance(run, 0.5);
    expect(run.mines).toEqual([]);
  });

  it('drift down slowly with a sideways sway', () => {
    const run = hazardRun(MINE_WAVE);
    const mine = mineAt(run, 0, 100, -MINE_FALL_SPEED_MIN);
    run.mineTimer = 1000;
    const y0 = mine.y;
    let minX = 0;
    let maxX = 0;
    for (let i = 0; i < 240; i++) {
      stepHazards(run, DT, []);
      minX = Math.min(minX, mine.x);
      maxX = Math.max(maxX, mine.x);
    }
    expect(y0 - mine.y).toBeCloseTo(MINE_FALL_SPEED_MIN * 2, 5);
    expect(maxX - minX).toBeGreaterThan(0.5);
    expect(Math.abs(mine.vx)).toBeGreaterThan(0);
    expect(MINE_FALL_SPEED_MAX).toBeLessThanOrEqual(24);
  });

  it('spawned mines fall at 18 to 24 px/s', () => {
    const run = hazardRun(MINE_WAVE);
    advance(run, 12);
    expect(run.mines.length).toBeGreaterThan(0);
    for (const m of run.mines) expect(-m.vy).toBeGreaterThanOrEqual(MINE_FALL_SPEED_MIN);
    for (const m of run.mines) expect(-m.vy).toBeLessThanOrEqual(MINE_FALL_SPEED_MAX);
  });

  it('are capped on screen', () => {
    const run = hazardRun(MINE_WAVE);
    for (let i = 0; i < 20; i++) mineAt(run, -60 + i, 100 + i);
    run.mines.length = MAX_MINES;
    run.mineTimer = 0;
    const events: RunEvent[] = [];
    stepHazards(run, DT, events);
    expect(run.mines.length).toBe(MAX_MINES);
    expect(events.some((e) => e.type === 'mineSpawned')).toBe(false);
    // A mine that goes off makes room again.
    run.mines.pop();
    run.mineTimer = 0;
    stepHazards(run, DT, events);
    expect(run.mines.length).toBe(MAX_MINES);
  });

  it('keep the cap over a long wave', () => {
    const run = hazardRun(MINE_WAVE);
    let most = 0;
    for (let i = 0; i < 120 * 40; i++) {
      stepHazards(run, DT, []);
      most = Math.max(most, run.mines.length);
      // Park the ground-bound mines so they stay and pile up against the cap.
      for (const m of run.mines) m.y = Math.max(m.y, 100);
    }
    expect(most).toBe(MAX_MINES);
  });

  it('burst when a shot touches them: removed, an event, the centre returned', () => {
    const run = hazardRun(MINE_WAVE);
    const mine = mineAt(run, 10, 50);
    const other = mineAt(run, -40, 50);
    const events: RunEvent[] = [];
    expect(shootMine(run, playerShot(30, 50), events)).toBeNull();
    expect(run.mines).toHaveLength(2);
    const centre = shootMine(run, playerShot(12, 53), events);
    expect(centre).toEqual({ x: 10, y: 50 });
    expect(run.mines).toEqual([other]);
    expect(events).toEqual([{ type: 'mineBurst', mineId: mine.id, x: 10, y: 50, radius: MINE_BURST_RADIUS, cause: 'shot' }]);
  });

  it('are touched by a shot exactly where the boxes overlap', () => {
    const run = hazardRun(MINE_WAVE);
    const mine = mineAt(run, 0, 0);
    const box = mineBox(mine);
    expect(box).toEqual({ x: 0, y: 0, halfWidth: MINE_HALF_SIZE, halfHeight: MINE_HALF_SIZE });
    // Just inside and just outside on each axis.
    expect(shootMine(run, playerShot(MINE_HALF_SIZE + 0.9, 0), [])).not.toBeNull();
    mineAt(run, 0, 0);
    expect(shootMine(run, playerShot(MINE_HALF_SIZE + 1.1, 0), [])).toBeNull();
    expect(shootMine(run, playerShot(0, MINE_HALF_SIZE + 2.9), [])).not.toBeNull();
    mineAt(run, 0, 0);
    expect(shootMine(run, playerShot(0, MINE_HALF_SIZE + 3.1), [])).toBeNull();
  });

  it('bite a bunker they touch and go off there', () => {
    const run = hazardRun(MINE_WAVE, true);
    run.mineTimer = 1000;
    const bunker = run.bunkers[1];
    const before = bunkerSolidCount(bunker);
    const version = bunker.version;
    // Just above the top of the bunker's solid middle, falling in.
    const mine = mineAt(run, bunker.x + bunker.width / 2, bunker.y + bunker.height + MINE_HALF_SIZE + 0.5, -24);
    const { events, hurt } = advance(run, 0.5);
    expect(run.mines).not.toContain(mine);
    expect(bunkerSolidCount(bunker)).toBeLessThan(before);
    expect(bunker.version).toBeGreaterThan(version);
    const burst = events.find((e) => e.type === 'mineBurst');
    expect(burst).toMatchObject({ type: 'mineBurst', mineId: mine.id, cause: 'bunker' });
    // Far from the ship's row, a bunker burst hurts nobody.
    expect(hurt).toEqual([]);
  });

  it('that start in the arch\'s opening go off at the bunker or the ship\'s row', () => {
    const run = hazardRun(MINE_WAVE, true);
    run.mineTimer = 1000;
    const bunker = run.bunkers[0];
    // Through the arch: the opening is 8 wide in the middle and the sway is small over a short fall.
    mineAt(run, bunker.x + bunker.width / 2, bunker.y + 1, -24);
    const { events, hurt } = advance(run, 3);
    expect(run.mines).toEqual([]);
    const bursts = events.filter((e) => e.type === 'mineBurst');
    expect(bursts).toHaveLength(1);
    // Whether it slipped through the opening or caught the arch's edge, a ground burst hurts and a bunker burst does not.
    expect(hurt).toHaveLength(bursts[0].type === 'mineBurst' && bursts[0].cause === 'ground' ? 1 : 0);
  });

  it('go off at the ship\'s row and hurt a ship close by', () => {
    const run = hazardRun(MINE_WAVE);
    run.mineTimer = 1000;
    run.players[0].x = 6;
    const mine = mineAt(run, 0, MINE_GROUND_Y + 0.1, -24);
    const events: RunEvent[] = [];
    const hurt = stepHazards(run, DT, events);
    expect(run.mines).not.toContain(mine);
    expect(events).toEqual([{ type: 'mineBurst', mineId: mine.id, x: mine.x, y: mine.y, radius: MINE_BLAST, cause: 'ground' }]);
    expect(hurt).toHaveLength(1);
    expect(hurt[0].halfWidth).toBe(MINE_BLAST);
    expect(overlaps(hurt[0], shipBox(run.players[0]))).toBe(true);
    // A ship across the field is out of the blast.
    run.players[0].x = 70;
    expect(overlaps(hurt[0], shipBox(run.players[0]))).toBe(false);
  });

  it('do nothing under Time Stop', () => {
    const run = hazardRun(MINE_WAVE, true);
    const mine = mineAt(run, 0, 80);
    columnAt(run, 20, 'warn', 0.5);
    run.mineTimer = 0;
    run.acidTimer = 0;
    const snapshot = JSON.stringify({ m: run.mines, a: run.acid, mt: run.mineTimer, at: run.acidTimer, id: run.nextId });
    const events: RunEvent[] = [];
    expect(stepHazards(run, 0, events)).toEqual([]);
    expect(events).toEqual([]);
    expect(JSON.stringify({ m: run.mines, a: run.acid, mt: run.mineTimer, at: run.acidTimer, id: run.nextId })).toBe(snapshot);
    expect(mine.y).toBe(80);
  });

  it('are deterministic from the run\'s seed', () => {
    const a = hazardRun(ACID_WAVE, true, 42);
    const b = hazardRun(ACID_WAVE, true, 42);
    advance(a, 20);
    advance(b, 20);
    expect(JSON.stringify([a.mines, a.acid])).toBe(JSON.stringify([b.mines, b.acid]));
  });
});

describe('acid rain', () => {
  it('does not start on a wave without an acid rate', () => {
    const run = hazardRun(MINE_WAVE);
    advance(run, 60);
    expect(run.acid).toEqual([]);
  });

  it('goes warn, rain, end with events and timings', () => {
    const run = hazardRun(ACID_WAVE);
    run.mineTimer = 1000;
    run.acidTimer = 0.01;
    const log: { t: number; e: RunEvent }[] = [];
    let t = 0;
    for (let i = 0; i < 120 * 6; i++) {
      const events: RunEvent[] = [];
      stepHazards(run, DT, events);
      t += DT;
      for (const e of events) if (e.type === 'acidColumn' && log.length < 3) log.push({ t, e });
      // Only the first column.
      if (log.length === 3) break;
    }
    expect(log.map((l) => l.e.type === 'acidColumn' && l.e.state)).toEqual(['warn', 'rain', 'end']);
    const [warn, rain, end] = log;
    expect(rain.t - warn.t).toBeCloseTo(ACID_WARN_SECONDS, 1);
    expect(end.t - rain.t).toBeCloseTo(ACID_RAIN_SECONDS, 1);
    if (warn.e.type === 'acidColumn') {
      expect(warn.e.halfWidth).toBe(ACID_HALF_WIDTH);
      expect(Math.abs(warn.e.x)).toBeLessThanOrEqual(FIELD_WIDTH / 2 - ACID_HALF_WIDTH);
    }
  });

  it('warns without hurting, then rain hurts from the top of the field down to the ship\'s row', () => {
    const run = hazardRun(ACID_WAVE);
    run.mineTimer = 1000;
    run.acidTimer = 1000;
    const column = columnAt(run, 20, 'warn', ACID_WARN_SECONDS);
    expect(advance(run, 0.5).hurt).toEqual([]);
    expect(column.state).toBe('warn');
    const { hurt } = advance(run, 0.6);
    expect(column.state).toBe('rain');
    expect(hurt.length).toBeGreaterThan(0);
    const box = hurt[hurt.length - 1];
    expect(box.x).toBe(20);
    expect(box.halfWidth).toBe(ACID_HALF_WIDTH);
    expect(box.y + box.halfHeight).toBeCloseTo(FIELD_HEIGHT / 2);
    expect(box.y - box.halfHeight).toBeLessThanOrEqual(SHIP_Y);
    run.players[0].x = 20;
    expect(overlaps(box, shipBox(run.players[0]))).toBe(true);
    run.players[0].x = -40;
    expect(overlaps(box, shipBox(run.players[0]))).toBe(false);
  });

  it('eats a bunker from above, gradually', () => {
    const run = hazardRun(ACID_WAVE, true);
    run.mineTimer = 1000;
    run.acidTimer = 1000;
    const bunker = run.bunkers[2];
    const x = bunker.x + bunker.width / 2;
    columnAt(run, x, 'rain', ACID_RAIN_SECONDS);
    const full = bunkerSolidCount(bunker);
    advance(run, 0.4);
    const early = bunkerSolidCount(bunker);
    expect(early).toBeLessThan(full);
    advance(run, 0.5);
    const mid = bunkerSolidCount(bunker);
    expect(mid).toBeLessThan(early);
    advance(run, 0.7);
    const end = bunkerSolidCount(bunker);
    expect(run.acid).toEqual([]);
    expect(end).toBeLessThan(mid);
    // A few rows, not the whole bunker.
    expect(end).toBeGreaterThan(full / 2);
    // Eaten from the top: the bottom rows are untouched.
    for (let col = 0; col < bunker.width; col++) {
      for (let row = 0; row < 3; row++) {
        const wasSolid = createBunkers(() => 0)[2].mask[row * bunker.width + col] === 1;
        expect(bunker.mask[row * bunker.width + col] === 1).toBe(wasSolid);
      }
    }
  });

  it('is capped, and never overlaps another live column', () => {
    const run = hazardRun(ACID_WAVE);
    run.mineTimer = 1000;
    let most = 0;
    for (let i = 0; i < 120 * 90; i++) {
      stepHazards(run, DT, []);
      most = Math.max(most, run.acid.length);
      for (let a = 0; a < run.acid.length; a++) {
        for (let b = a + 1; b < run.acid.length; b++) {
          expect(Math.abs(run.acid[a].x - run.acid[b].x)).toBeGreaterThanOrEqual(2 * ACID_HALF_WIDTH);
        }
      }
    }
    expect(most).toBeLessThanOrEqual(MAX_ACID);
    expect(most).toBeGreaterThanOrEqual(1);
  });

  it('is not started past the cap', () => {
    const run = hazardRun(ACID_WAVE);
    run.mineTimer = 1000;
    columnAt(run, -50, 'warn', 1);
    columnAt(run, 50, 'warn', 1);
    run.acidTimer = 0;
    const events: RunEvent[] = [];
    stepHazards(run, DT, events);
    expect(run.acid).toHaveLength(MAX_ACID);
    expect(events.filter((e) => e.type === 'acidColumn')).toEqual([]);
  });

  it('is often aimed near a living ship', () => {
    let near = 0;
    const trials = 40;
    for (let seed = 1; seed <= trials; seed++) {
      const run = hazardRun(ACID_WAVE, false, seed);
      run.mineTimer = 1000;
      run.players[0].x = -60;
      run.acidTimer = 0;
      stepHazards(run, DT, []);
      if (run.acid.length === 1 && Math.abs(run.acid[0].x + 60) <= 12) near++;
    }
    expect(near).toBeGreaterThan(trials * 0.3);
    expect(near).toBeLessThan(trials);
  });

  it('does nothing under Time Stop', () => {
    const run = hazardRun(ACID_WAVE, true);
    const column = columnAt(run, 0, 'rain', 1);
    const before = run.bunkers.map(bunkerSolidCount);
    for (let i = 0; i < 240; i++) expect(stepHazards(run, 0, [])).toEqual([]);
    expect(column.timeLeft).toBe(1);
    expect(run.bunkers.map(bunkerSolidCount)).toEqual(before);
  });
});

describe('hazards in a run', () => {
  /** Wave 14, playing, bunkers gone, the hazard timers parked. */
  function playingRun() {
    const run = createRun(3, 1, ACID_WAVE);
    chooseSpecial(run, 'pulseBomb');
    run.bunkers = [];
    for (let i = 0; i < Math.ceil(WAVE_INTRO_SECONDS / DT) + 1; i++) stepRun(run, [NO_INPUT], DT);
    expect(run.phase).toBe('playing');
    run.shots = [];
    run.mineTimer = 1000;
    run.acidTimer = 1000;
    return run;
  }

  it('a raining column over a still ship costs a life, once while it is invulnerable', () => {
    const run = playingRun();
    const lives = run.players[0].lives;
    columnAt(run, run.players[0].x, 'rain', ACID_RAIN_SECONDS);
    const events: RunEvent[] = [];
    for (let i = 0; i < 120 * 1.2; i++) {
      run.shots = [];
      events.push(...stepRun(run, [NO_INPUT], DT));
    }
    expect(events.filter((e) => e.type === 'playerHit')).toHaveLength(1);
    expect(run.players[0].lives).toBe(lives - 1);
  });

  it('in co-op, a mine going off at the ships\' row hurts both ships in its blast', () => {
    const run = createRun(3, 2, MINE_WAVE);
    chooseSpecial(run, 'pulseBomb', 0);
    chooseSpecial(run, 'pulseBomb', 1);
    run.bunkers = [];
    for (let i = 0; i < Math.ceil(WAVE_INTRO_SECONDS / DT) + 1; i++) stepRun(run, [NO_INPUT, NO_INPUT], DT);
    expect(run.phase).toBe('playing');
    run.mineTimer = 1000;
    run.acidTimer = 1000;
    run.aliens = [];
    run.shots = [];
    const [a, b] = run.players;
    const lives = [a.lives, b.lives];
    // Both ships side by side, inside one mine's blast; the blast lasts a single step.
    a.x = -MINE_BLAST / 2;
    b.x = MINE_BLAST / 2;
    mineAt(run, 0, MINE_GROUND_Y + 0.01);
    const events = stepRun(run, [NO_INPUT, NO_INPUT], DT);
    expect(events.filter((e) => e.type === 'mineBurst')).toHaveLength(1);
    expect([a.lives, b.lives]).toEqual([lives[0] - 1, lives[1] - 1]);
  });

  it('a bunker shelters the ship under it while the rain eats into it', () => {
    const run = playingRun();
    run.bunkers = createBunkers(() => run.nextId++);
    const bunker = run.bunkers[1];
    const x = bunker.x + bunker.width / 2;
    run.players[0].x = x;
    const lives = run.players[0].lives;
    const solid = bunkerSolidCount(bunker);
    columnAt(run, x, 'rain', 1);
    for (let i = 0; i < 120 * 1.1; i++) {
      run.shots = [];
      stepRun(run, [NO_INPUT], DT);
    }
    expect(run.players[0].lives).toBe(lives);
    expect(bunkerSolidCount(bunker)).toBeLessThan(solid);
  });

  it('a column beside the ship costs nothing', () => {
    const run = playingRun();
    const lives = run.players[0].lives;
    columnAt(run, run.players[0].x + 60, 'rain', ACID_RAIN_SECONDS);
    for (let i = 0; i < 120 * 1.2; i++) {
      run.shots = [];
      stepRun(run, [NO_INPUT], DT);
    }
    expect(run.players[0].lives).toBe(lives);
  });

  it('a mine landing on the ship costs a life', () => {
    const run = playingRun();
    const lives = run.players[0].lives;
    mineAt(run, run.players[0].x, MINE_GROUND_Y + 0.05, -20);
    const events: RunEvent[] = [];
    for (let i = 0; i < 4; i++) {
      run.shots = [];
      events.push(...stepRun(run, [NO_INPUT], DT));
    }
    expect(events.some((e) => e.type === 'mineBurst' && e.cause === 'ground')).toBe(true);
    expect(run.players[0].lives).toBe(lives - 1);
  });

  it('a shot mine goes off and leaves the ship alone', () => {
    const run = playingRun();
    const lives = run.players[0].lives;
    mineAt(run, run.players[0].x, SHIP_Y + 30, -20);
    const events: RunEvent[] = [];
    for (let i = 0; i < 60; i++) events.push(...stepRun(run, [{ move: 0, drag: 0, fire: true, special: false }], DT));
    expect(events.some((e) => e.type === 'mineBurst' && e.cause === 'shot')).toBe(true);
    expect(run.players[0].lives).toBe(lives);
  });
});
