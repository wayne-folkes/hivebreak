import { describe, expect, it } from 'vitest';
import { createAlien, startDive } from './aliens';
import { createBoss, stepFreeAlien } from './boss';
import { createPlayer } from './player';
import { createRun } from './run';
import {
  WELL_ALIEN_PULL_SPEED,
  WELL_CORE,
  WELL_GRIND_RADIUS,
  WELL_GRIND_SECONDS,
  WELL_RADIUS,
  WELL_SECONDS,
  WELL_WALL_MARGIN,
  WELL_Y,
  createWell,
  stepWell,
} from './well';
import { FIELD_WIDTH } from './playfield';
import type { Alien, RunState, Shot } from './types';

const DT = 1 / 120;

/** A playing run with an empty field and a well at (0, 0). */
function wellRun(): RunState {
  const run = createRun(1);
  run.phase = 'playing';
  run.bunkers = [];
  run.aliens = [];
  run.shots = [];
  run.well = { x: 0, y: 0, timeLeft: WELL_SECONDS, playerId: 0 };
  return run;
}

const enemyShot = (id: number, x: number, y: number, vx = 0, vy = -90): Shot => ({
  id, owner: 'alien', kind: 'enemy', playerId: null, x, y, vx, vy, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: id,
});

const freeAlien = (run: RunState, x: number, y: number, hp = 1): Alien => {
  const a: Alien = { id: run.nextId++, kind: 'drone', hp, col: -1, row: -1, x, y, mode: 'free', modeTime: 0, flash: 0, vx: 0, vy: -45 };
  run.aliens.push(a);
  return a;
};

/** Flies the shots and free aliens as the run would, then steps the well. */
function tick(run: RunState, n = 1) {
  const events: ReturnType<typeof stepWell>['events'] = [];
  const hits: ReturnType<typeof stepWell>['hits'] = [];
  for (let i = 0; i < n; i++) {
    for (const s of run.shots) {
      s.x += s.vx * DT;
      s.y += s.vy * DT;
    }
    if (run.freeze <= 0) for (const a of run.aliens) if (a.mode === 'free') stepFreeAlien(a, null, DT);
    const r = stepWell(run, DT);
    events.push(...r.events);
    hits.push(...r.hits);
  }
  return { events, hits };
}

describe('createWell', () => {
  it('sits at the ship\'s x, mid-field, for three seconds, owned by the ship', () => {
    const p = createPlayer(1, 12);
    expect(createWell(p)).toEqual({ x: 12, y: WELL_Y, timeLeft: WELL_SECONDS, playerId: 1 });
    expect(WELL_Y).toBe(0);
  });

  it('is kept inside the field', () => {
    const limit = FIELD_WIDTH / 2 - WELL_WALL_MARGIN;
    expect(createWell(createPlayer(0, 500)).x).toBe(limit);
    expect(createWell(createPlayer(0, -500)).x).toBe(-limit);
  });
});

describe('stepWell with no well', () => {
  it('does nothing', () => {
    const run = wellRun();
    run.well = null;
    run.shots.push(enemyShot(1, 0, 0));
    expect(stepWell(run, DT)).toEqual({ events: [], hits: [] });
    expect(run.shots).toHaveLength(1);
  });
});

describe('enemy shots', () => {
  it('swallows a shot at the core, with a wellConsumed event, and no other', () => {
    const run = wellRun();
    run.shots = [enemyShot(1, WELL_CORE - 1, 0), enemyShot(2, WELL_CORE + 8, 0), enemyShot(3, 200, 0)];
    const { events } = tick(run, 0);
    const r = stepWell(run, DT);
    expect(r.events).toEqual([{ type: 'wellConsumed', x: WELL_CORE - 1, y: 0 }]);
    expect(run.shots.map((s) => s.id)).toEqual([2, 3]);
    expect(events).toEqual([]);
  });

  it('leaves the ship\'s shots alone', () => {
    const run = wellRun();
    const own: Shot = { ...enemyShot(5, 0, 0), owner: 'player', kind: 'normal', playerId: 0 };
    run.shots = [own];
    stepWell(run, DT);
    expect(run.shots).toEqual([own]);
    expect(own.vy).toBe(-90);
  });

  it('does not touch a shot outside the radius', () => {
    const run = wellRun();
    const s = enemyShot(1, WELL_RADIUS + 5, 0, 3, -90);
    run.shots = [s];
    stepWell(run, DT);
    expect([s.vx, s.vy]).toEqual([3, -90]);
  });

  it('bends a passing shot toward the centre, more the closer it is', () => {
    const turn = (offset: number) => {
      const run = wellRun();
      const s = enemyShot(1, offset, 30);
      run.shots = [s];
      stepWell(run, DT);
      return Math.atan2(s.vx, -s.vy) * Math.sign(-offset);
    };
    expect(turn(50)).toBeGreaterThan(0);
    expect(turn(20)).toBeGreaterThan(turn(50));
    const run = wellRun();
    const s = enemyShot(1, 30, 30);
    run.shots = [s];
    stepWell(run, DT);
    expect(s.vx).toBeLessThan(0); // toward the centre on the left
    expect(s.vy).toBeLessThan(0);
    expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(90, 6);
  });

  it('draws in shots that would pass the centre, and swallows them', () => {
    for (const offset of [-35, -20, 0, 15, 30, 40]) {
      const run = wellRun();
      run.shots = [enemyShot(1, offset, 70)];
      const { events } = tick(run, 240);
      expect(events.map((e) => e.type), `offset ${offset}`).toEqual(['wellConsumed']);
      expect(run.shots).toEqual([]);
    }
  });

  it('holds a frozen shot still (Time Stop) but still swallows one at the core', () => {
    const run = wellRun();
    run.freeze = 2;
    const frozen = enemyShot(1, 30, 20, 0, -90);
    run.shots = [frozen, enemyShot(2, 2, 2)];
    const r = stepWell(run, DT);
    expect(r.events).toHaveLength(1);
    expect([frozen.vx, frozen.vy]).toEqual([0, -90]);
  });
});

describe('free aliens and divers', () => {
  it('drags a free alien in and grinds it on the first tick after it arrives', () => {
    const run = wellRun();
    const a = freeAlien(run, 40, 30);
    // The first tick comes at 0.4 s, when it is nearly at the centre.
    const first = tick(run, Math.round(WELL_GRIND_SECONDS / DT) + 1);
    expect(Math.hypot(a.x, a.y)).toBeLessThan(WELL_GRIND_RADIUS);
    expect(first.hits).toEqual([{ alien: a, killed: true }]);
    expect(a.hp).toBe(0);
  });

  it('only grinds an alien that has arrived: one still outside the grind radius at the tick is spared', () => {
    const run = wellRun();
    const a = freeAlien(run, 0, 0, 5);
    a.x = WELL_RADIUS - 2;
    a.vx = 0;
    a.vy = 0;
    // Hold it out at the rim for the first tick by stepping the well alone, without the helper's fall.
    const r = stepWell(run, WELL_GRIND_SECONDS + 0.01);
    expect(r.hits).toEqual([]);
    expect(a.hp).toBe(5);
  });

  it('does not reach a free alien outside the radius', () => {
    const run = wellRun();
    const a = freeAlien(run, WELL_RADIUS + 20, 0);
    const vx = a.vx;
    stepWell(run, DT);
    expect(a.vx).toBe(vx);
  });

  it('grinds one hit point every 0.4 s and keeps the alien in the grind radius', () => {
    const run = wellRun();
    const a = freeAlien(run, 0, 0, 100);
    let ticks = 0;
    for (let i = 0; i < Math.round(WELL_SECONDS / DT) + 5 && run.well; i++) {
      const before = a.hp;
      tick(run);
      if (a.hp < before) {
        ticks++;
        expect(before - a.hp).toBe(1);
      }
      expect(Math.hypot(a.x, a.y)).toBeLessThan(WELL_GRIND_RADIUS);
    }
    expect(ticks).toBe(Math.floor(WELL_SECONDS / WELL_GRIND_SECONDS));
    expect(run.well).toBeNull();
  });

  it('does not pull a free alien while the enemies are frozen, but grinds one already inside', () => {
    const run = wellRun();
    run.freeze = 5;
    const far = freeAlien(run, 40, 0);
    const near = freeAlien(run, 3, 3, 10);
    const r = tick(run, Math.ceil(WELL_GRIND_SECONDS / DT) + 2);
    expect(far.vx).toBe(0);
    expect(r.hits.map((h) => h.alien.id)).toEqual([near.id]);
    expect(near.hp).toBe(9);
  });

  it('turns a diver mid-dive into a free alien that falls into the well', () => {
    const run = wellRun();
    const diver = createAlien('diver', 77, 2, 1, 30, 60);
    startDive(diver, 0);
    diver.modeTime = 0.8;
    diver.x = 20;
    diver.y = 20;
    run.aliens = [diver];
    stepWell(run, DT);
    expect(diver.mode).toBe('free');
    expect(diver.dive).toBeUndefined();
    expect([diver.col, diver.row]).toEqual([-1, -1]);
    tick(run, 120);
    expect(Math.hypot(diver.x, diver.y)).toBeLessThan(WELL_GRIND_RADIUS);
    expect(diver.hp).toBe(0);
  });

  it('leaves formation aliens, returning divers and the boss alone', () => {
    const run = wellRun();
    const slotted = createAlien('drone', 1, 0, 0, 5, 5);
    const returning = createAlien('diver', 2, 1, 0, -5, -5);
    returning.mode = 'returning';
    const diverFar = createAlien('diver', 3, 2, 0, 100, 100);
    startDive(diverFar, 0);
    run.aliens = [slotted, returning, diverFar];
    const boss = createBoss('broodMother', () => run.nextId++);
    boss.x = 0;
    boss.y = 0;
    run.boss = boss;
    const hp = boss.parts.map((p) => p.hp);
    const r = tick(run, 200);
    expect(r.hits).toEqual([]);
    expect(slotted).toMatchObject({ mode: 'formation', x: 5, y: 5, hp: 1 });
    expect(returning).toMatchObject({ mode: 'returning', x: -5, y: -5, hp: 1 });
    expect(diverFar.mode).toBe('diving');
    expect(boss.parts.map((p) => p.hp)).toEqual(hp);
    expect(boss.x).toBe(0);
  });

  it('pulls at the agreed speed at the core and slower at the rim', () => {
    const rim = wellRun();
    const a = freeAlien(rim, WELL_RADIUS - 1, 0);
    stepWell(rim, DT);
    const core = wellRun();
    const b = freeAlien(core, 14.5, 0);
    stepWell(core, DT);
    expect(Math.abs(a.vx!)).toBeLessThan(WELL_ALIEN_PULL_SPEED * 0.6);
    expect(Math.abs(b.vx!)).toBeGreaterThan(Math.abs(a.vx!));
    expect(a.vx).toBeLessThan(0);
  });
});

describe('the well\'s clock', () => {
  it('runs on real time, even while the enemies are frozen or slowed, and removes the well at zero', () => {
    for (const setup of [(r: RunState) => (r.freeze = 9), (r: RunState) => (r.slow = 9), (r: RunState) => (r.stun = 9)]) {
      const run = wellRun();
      setup(run);
      stepWell(run, 1);
      expect(run.well!.timeLeft).toBeCloseTo(2, 9);
      stepWell(run, 2);
      expect(run.well).toBeNull();
    }
  });

  it('an expired well stops pulling', () => {
    const run = wellRun();
    stepWell(run, WELL_SECONDS + 1);
    expect(run.well).toBeNull();
    const s = enemyShot(1, 30, 0, 0, -90);
    run.shots = [s];
    expect(stepWell(run, DT).events).toEqual([]);
    expect(s.vx).toBe(0);
  });
});
