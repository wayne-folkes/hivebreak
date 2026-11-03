import { describe, expect, it } from 'vitest';
import { ALIEN_SPECS, createAlien, damageAlien } from './aliens';
import { firstAlienHit } from './collision';
import {
  PINCER_SECONDS,
  SIDE_MARGIN,
  WEAVE_AMPLITUDE,
  WEAVE_SPEED,
  formationReady,
  slotPosition,
  spawnFormation,
  stepFormation,
  stepFormationEntry,
} from './formation';
import { FIELD_WIDTH } from './playfield';
import { computeBeam } from './powerups';
import { MEND_INTERVAL, WARP_SECONDS, alienHitSurvived, canBeHit, stepSector3Aliens } from './sector3';
import { WAVE_INTRO_SECONDS, chooseSpecial, createRun, stepRun } from './run';
import { WAVES, waveColumns } from './waves';
import { NO_INPUT } from './types';
import type { Alien, RunEvent, RunState, Shot, WaveDef } from './types';

const DT = 1 / 120;
const WAVE_11 = 10;
const WAVE_12 = 11;
const WAVE_14 = 13;

/** A run on `wave` with its formation spawned and docked (a pincer's entry already finished), ready to poke. */
function runOn(wave: number, seed = 5): RunState {
  const run = createRun(seed, 1, wave);
  const spawned = spawnFormation(WAVES[wave], () => run.nextId++);
  run.aliens = spawned.aliens;
  run.formation = spawned.formation;
  run.formation.entry = 0;
  for (const a of run.aliens) {
    const pos = slotPosition(run.formation, a.col, a.row, waveColumns(WAVES[wave]));
    a.x = pos.x;
    a.y = pos.y;
  }
  run.bunkers = [];
  return run;
}

const at = (run: RunState, col: number, row: number): Alien => {
  const alien = run.aliens.find((a) => a.col === col && a.row === row);
  if (!alien) throw new Error(`no alien at ${col},${row}`);
  return alien;
};

/** What a shot does to an alien that survives it: the damage, then the run's hook. */
function hurt(run: RunState, alien: Alien): RunEvent[] {
  const events: RunEvent[] = [];
  expect(damageAlien(alien)).toBe(false);
  alienHitSurvived(run, alien, events);
  return events;
}

const shotAt = (x: number, y: number): Shot => ({ id: 1, owner: 'player', kind: 'normal', damage: 1, homing: 0, bouncesLeft: 0, playerId: 0, x, y, vx: 0, vy: 260, pierceLeft: 0, hits: 0, volley: 0 });

describe('Warper', () => {
  it('blinks once, on its first surviving hit, to an empty slot with an event', () => {
    const run = runOn(WAVE_11);
    const warper = at(run, 2, 0);
    const from = { x: warper.x, y: warper.y };
    const events = hurt(run, warper);
    // Wave 11's only empty slots are the top row's two corners.
    expect([warper.col, warper.row]).toSatisfy(([c, r]: number[]) => r === 0 && (c === 0 || c === 5));
    const pos = slotPosition(run.formation, warper.col, warper.row, 6);
    expect(warper).toMatchObject({ x: pos.x, y: pos.y, warped: true, warp: WARP_SECONDS });
    expect(events).toEqual([{ type: 'alienWarped', alienId: warper.id, fromX: from.x, fromY: from.y, toX: pos.x, toY: pos.y }]);

    // Its next hit (it has 2 hp, so give it more) doesn't blink it again.
    warper.hp = 2;
    expect(hurt(run, warper)).toEqual([]);
  });

  it('leaves a slot of its own behind, free for the next blinker', () => {
    const run = runOn(WAVE_11);
    const first = at(run, 2, 0);
    hurt(run, first);
    const second = at(run, 3, 0);
    hurt(run, second);
    const slots = run.aliens.filter((a) => a.hp > 0).map((a) => `${a.col},${a.row}`);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it('prefers slots away from where it is', () => {
    // Free the slot next door at (3,0) as well as the corners: it still picks a far corner every time.
    for (let seed = 1; seed < 30; seed++) {
      const r = runOn(WAVE_11, seed);
      r.aliens = r.aliens.filter((a) => !(a.col === 3 && a.row === 0));
      const w = at(r, 2, 0);
      hurt(r, w);
      expect(w.col === 0 || w.col === 5).toBe(true);
    }
  });

  it('is untouchable while it warps, then solid again', () => {
    const run = runOn(WAVE_11);
    const warper = at(run, 2, 0);
    hurt(run, warper);
    expect(canBeHit(warper)).toBe(false);
    expect(firstAlienHit(shotAt(warper.x, warper.y), run.aliens)).not.toBe(warper);
    run.players[0].x = warper.x;
    expect(computeBeam(run.players[0], run.aliens, null, []).target?.alienId).not.toBe(warper.id);

    const events: RunEvent[] = [];
    stepSector3Aliens(run, WARP_SECONDS / 2, events);
    expect(canBeHit(warper)).toBe(false);
    stepSector3Aliens(run, WARP_SECONDS, events);
    expect(warper.warp).toBe(0);
    expect(canBeHit(warper)).toBe(true);
    expect(firstAlienHit(shotAt(warper.x, warper.y), run.aliens)).toBe(warper);
  });

  it("doesn't blink when the hit kills it", () => {
    const run = runOn(WAVE_11);
    const warper = at(run, 2, 0);
    warper.hp = 1;
    const events: RunEvent[] = [];
    expect(damageAlien(warper)).toBe(true);
    alienHitSurvived(run, warper, events);
    expect(events).toEqual([]);
    expect(warper.warped).toBeUndefined();
  });

  it("doesn't blink when no slot is free, and may later", () => {
    const run = runOn(WAVE_11);
    run.aliens.push(createAlien('drone', 99, 0, 0, 0, 0), createAlien('drone', 100, 5, 0, 0, 0));
    const warper = at(run, 2, 0);
    expect(hurt(run, warper)).toEqual([]);
    expect(warper).toMatchObject({ col: 2, row: 0 });
    expect(warper.warped).toBeUndefined();
    // A slot opens up: the next hit blinks it.
    run.aliens = run.aliens.filter((a) => a.id !== 99);
    warper.hp = 2;
    expect(hurt(run, warper)).toHaveLength(1);
  });

  it('counts slots held by diving aliens as taken, and free aliens as nothing', () => {
    const run = runOn(WAVE_11);
    const diver = createAlien('diver', 99, 0, 0, 0, 0);
    diver.mode = 'diving';
    const mini = createAlien('mini', 100, -1, -1, 0, 0);
    mini.mode = 'free';
    run.aliens.push(diver, mini);
    const warper = at(run, 2, 0);
    hurt(run, warper);
    expect(warper.col).toBe(5);
  });

  it("doesn't blink while diving, and keeps its blink", () => {
    const run = runOn(WAVE_11);
    const warper = at(run, 2, 0);
    warper.mode = 'diving';
    expect(hurt(run, warper)).toEqual([]);
    expect(warper).toMatchObject({ col: 2, row: 0 });
    expect(warper.warped).toBeUndefined();
  });

  it('ignores other kinds', () => {
    const run = runOn(WAVE_11);
    expect(hurt(run, at(run, 1, 0))).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const where = (seed: number) => {
      const run = runOn(WAVE_14, seed);
      const warper = run.aliens.find((a) => a.kind === 'warper') as Alien;
      hurt(run, warper);
      return [warper.col, warper.row];
    };
    expect(where(7)).toEqual(where(7));
  });
});

describe('Mender', () => {
  /** Wave 12: a Mender at (2,0), wardens either side, a splitter below it. */
  function mendRun() {
    const run = runOn(WAVE_12);
    const mender = at(run, 2, 0);
    expect(mender.kind).toBe('mender');
    return { run, mender };
  }

  it('starts with a full interval on its timer', () => {
    const { mender } = mendRun();
    expect(mender.mendTimer).toBe(MEND_INTERVAL);
  });

  it('heals adjacent damaged aliens by 1 on its interval, and only then', () => {
    const { run, mender } = mendRun();
    const neighbour = at(run, 1, 0);
    const diagonal = at(run, 3, 1);
    const far = at(run, 0, 3);
    for (const a of [neighbour, diagonal, far]) a.hp = 1;
    const events: RunEvent[] = [];

    stepSector3Aliens(run, MEND_INTERVAL - 0.1, events);
    expect(events).toEqual([]);
    expect(neighbour.hp).toBe(1);

    stepSector3Aliens(run, 0.2, events);
    expect(neighbour.hp).toBe(2);
    expect(diagonal.hp).toBe(2);
    expect(far.hp).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'mendPulse', alienId: mender.id, x: mender.x, y: mender.y });
    const healed = (events[0] as Extract<RunEvent, { type: 'mendPulse' }>).healed;
    expect(healed).toHaveLength(2);
    expect(healed).toContainEqual({ x: neighbour.x, y: neighbour.y });
    expect(healed).toContainEqual({ x: diagonal.x, y: diagonal.y });
  });

  it('never heals past full hp, and says nothing when nobody needs it', () => {
    const { run } = mendRun();
    const damaged = at(run, 1, 0); // a warden, 2 hp
    damaged.hp = 1;
    const events: RunEvent[] = [];
    stepSector3Aliens(run, MEND_INTERVAL, events);
    expect(damaged.hp).toBe(ALIEN_SPECS.warden.hp);
    expect(events).toHaveLength(1);
    events.length = 0;
    stepSector3Aliens(run, MEND_INTERVAL, events);
    expect(damaged.hp).toBe(ALIEN_SPECS.warden.hp);
    expect(events).toEqual([]);
  });

  it('pulses again every interval', () => {
    const { run } = mendRun();
    const damaged = at(run, 1, 0);
    damaged.hp = 1;
    const events: RunEvent[] = [];
    stepSector3Aliens(run, MEND_INTERVAL, events);
    damaged.hp = 1;
    stepSector3Aliens(run, MEND_INTERVAL, events);
    expect(events.filter((e) => e.type === 'mendPulse')).toHaveLength(2);
  });

  it('does not heal a diver or itself, and does not count down while diving', () => {
    const { run, mender } = mendRun();
    mender.hp = 1;
    const neighbour = at(run, 1, 0);
    neighbour.hp = 1;
    neighbour.mode = 'diving';
    const events: RunEvent[] = [];
    stepSector3Aliens(run, MEND_INTERVAL, events);
    expect(mender.hp).toBe(1);
    expect(neighbour.hp).toBe(1);

    mender.mode = 'diving';
    const before = mender.mendTimer;
    stepSector3Aliens(run, 1, events);
    expect(mender.mendTimer).toBe(before);
  });

  it('pauses while time is frozen', () => {
    const run = createRun(3, 1, WAVE_12);
    chooseSpecial(run, 'pulseBomb');
    const mender = run.aliens.find((a) => a.kind === 'mender') as Alien;
    for (let i = 0; i < Math.ceil(WAVE_INTRO_SECONDS / DT) + 1; i++) stepRun(run, [NO_INPUT], DT);
    expect(run.phase).toBe('playing');
    const before = mender.mendTimer as number;
    run.freeze = 1;
    for (let i = 0; i < 60; i++) stepRun(run, [NO_INPUT], DT);
    expect(mender.mendTimer).toBe(before);
    expect(run.freeze).toBeGreaterThan(0);
  });
});

describe('weave', () => {
  const weaveDef = (rows: string[], marchSpeed = 20): WaveDef => ({ rows, marchSpeed, fireRate: 0, diveRate: 0, sector: 3, behaviours: ['weave'] });

  it('only a weave wave has weave state', () => {
    expect(spawnFormation(WAVES[WAVE_12], () => 1).formation.weave).toEqual({ offset: 0, dir: 1 });
    expect(spawnFormation(WAVES[WAVE_11], () => 1).formation.weave).toBeUndefined();
    expect(spawnFormation(WAVES[0], () => 1).formation.weave).toBeUndefined();
  });

  it('shifts even rows one way and odd rows the other', () => {
    const { formation } = spawnFormation(weaveDef(['ddd', 'ddd', 'ddd']), () => 1);
    const rest = [0, 1, 2].map((row) => slotPosition(formation, 1, row, 3).x);
    formation.weave = { offset: 10, dir: 1 };
    const woven = [0, 1, 2].map((row) => slotPosition(formation, 1, row, 3).x);
    expect(woven[0] - rest[0]).toBe(10);
    expect(woven[1] - rest[1]).toBe(-10);
    expect(woven[2] - rest[2]).toBe(10);
  });

  it('moves between the two extremes at WEAVE_SPEED and bounces', () => {
    const def = weaveDef(['ddd', 'ddd'], 0);
    const { aliens, formation } = spawnFormation(def, () => 1);
    stepFormation(formation, aliens, def, 0.5);
    expect(formation.weave?.offset).toBeCloseTo(0.5 * WEAVE_SPEED, 6);
    let sawTop = false;
    let sawBottom = false;
    for (let i = 0; i < 10 * 120; i++) {
      stepFormation(formation, aliens, def, DT);
      const offset = formation.weave?.offset as number;
      expect(Math.abs(offset)).toBeLessThanOrEqual(WEAVE_AMPLITUDE + 1e-9);
      if (offset > WEAVE_AMPLITUDE - 0.5) sawTop = true;
      if (offset < -WEAVE_AMPLITUDE + 0.5) sawBottom = true;
    }
    expect(sawTop && sawBottom).toBe(true);
  });

  it('keeps every alien inside the side margin over a long march, even on the widest wave', () => {
    for (const wave of [WAVE_12, WAVE_14]) {
      const def = WAVES[wave];
      const { aliens, formation } = spawnFormation(def, () => 1);
      const cols = waveColumns(def);
      const limit = FIELD_WIDTH / 2 - SIDE_MARGIN;
      let turns = 0;
      let last = formation.dir;
      for (let i = 0; i < 60 * 120; i++) {
        stepFormation(formation, aliens, def, DT);
        if (formation.dir !== last) {
          turns++;
          last = formation.dir;
        }
        // Keep the formation from descending out of the way of the test: only x is checked.
        for (const a of aliens) {
          const x = slotPosition(formation, a.col, a.row, cols).x;
          const half = ALIEN_SPECS[a.kind].halfWidth;
          expect(x - half).toBeGreaterThanOrEqual(-limit - 1e-6);
          expect(x + half).toBeLessThanOrEqual(limit + 1e-6);
        }
      }
      // The weave must not make it turn constantly (and drop a row each time).
      expect(turns).toBeLessThan(60 * 3);
    }
  });

  it("shrinks the weave on a formation too wide for the full swing", () => {
    const def = WAVES[WAVE_14]; // six columns
    const { aliens, formation } = spawnFormation(def, () => 1);
    let peak = 0;
    for (let i = 0; i < 20 * 120; i++) {
      stepFormation(formation, aliens, def, DT);
      peak = Math.max(peak, Math.abs(formation.weave?.offset ?? 0));
    }
    expect(peak).toBeLessThan(WEAVE_AMPLITUDE);
    expect(peak).toBeGreaterThan(4);
  });

  it('no wave has both weave and split', () => {
    for (const def of WAVES) {
      expect(def.behaviours?.includes('weave') && def.behaviours?.includes('split')).toBeFalsy();
    }
  });
});

describe('pincer', () => {
  const dockedX = (def: WaveDef, col: number, row: number) => {
    const { formation } = spawnFormation({ ...def, behaviours: undefined }, () => 1);
    return slotPosition(formation, col, row, waveColumns(def)).x;
  };

  it('starts with its halves off screen, left half left and right half right', () => {
    const def = WAVES[WAVE_11];
    const { aliens, formation } = spawnFormation(def, () => 1);
    expect(formation.entry).toBe(PINCER_SECONDS);
    expect(formationReady(formation)).toBe(false);
    for (const a of aliens) {
      const half = ALIEN_SPECS[a.kind].halfWidth;
      if (a.col < 3) expect(a.x + half).toBeLessThan(-FIELD_WIDTH / 2);
      else expect(a.x - half).toBeGreaterThan(FIELD_WIDTH / 2);
    }
  });

  it('docks by the end of the entry, on exactly the slots a plain formation has', () => {
    const def = WAVES[WAVE_11];
    const { aliens, formation } = spawnFormation(def, () => 1);
    for (let t = 0; t < PINCER_SECONDS - 0.001; t += DT) stepFormationEntry(formation, aliens, def, DT);
    expect(formation.entry).toBeGreaterThan(0);
    stepFormationEntry(formation, aliens, def, 0.01);
    expect(formation.entry).toBe(0);
    expect(formationReady(formation)).toBe(true);
    for (const a of aliens) expect(a.x).toBeCloseTo(dockedX(def, a.col, a.row), 6);
  });

  it('flies in, getting closer every step', () => {
    const def = WAVES[WAVE_11];
    const { aliens, formation } = spawnFormation(def, () => 1);
    const left = aliens.find((a) => a.col === 0 && a.row === 1) as Alien;
    let previous = left.x;
    for (let i = 0; i < 100; i++) {
      stepFormationEntry(formation, aliens, def, DT);
      expect(left.x).toBeGreaterThan(previous);
      previous = left.x;
    }
  });

  it('does nothing on other waves', () => {
    const def = WAVES[0];
    const { aliens, formation } = spawnFormation(def, () => 1);
    const before = aliens.map((a) => a.x);
    stepFormationEntry(formation, aliens, def, 1);
    expect(aliens.map((a) => a.x)).toEqual(before);
    expect(formationReady(formation)).toBe(true);
  });

  it('holds the march until docked, then marches', () => {
    const def = WAVES[WAVE_11];
    const { aliens, formation } = spawnFormation(def, () => 1);
    stepFormation(formation, aliens, def, 0.5);
    expect(formation.offsetX).toBe(0);
    expect(formation.entry).toBeCloseTo(PINCER_SECONDS - 0.5, 9);
    stepFormation(formation, aliens, def, PINCER_SECONDS);
    expect(formation.entry).toBe(0);
    expect(formation.offsetX).toBe(0); // the step that docked didn't march
    stepFormation(formation, aliens, def, 0.1);
    expect(formation.offsetX).toBeGreaterThan(0);
  });

  it('in a run: halves on screen at wave start, no firing or diving before docking, then play', () => {
    const run = createRun(11, 1, WAVE_11);
    chooseSpecial(run, 'pulseBomb');
    run.bunkers = [];
    const events: RunEvent[] = [];
    let dockedAt = -1;
    for (let i = 0; i < Math.ceil(6 / DT); i++) {
      const wasReady = formationReady(run.formation);
      events.push(...stepRun(run, [NO_INPUT], DT));
      if (!wasReady && formationReady(run.formation)) dockedAt = run.time;
      if (dockedAt < 0) {
        expect(events.some((e) => e.type === 'alienFired' || e.type === 'diveStart')).toBe(false);
        expect(run.aliens.every((a) => a.mode === 'formation')).toBe(true);
      }
      if (run.phase === 'lost') break;
    }
    expect(dockedAt).toBeGreaterThan(WAVE_INTRO_SECONDS);
    expect(dockedAt).toBeCloseTo(PINCER_SECONDS, 1);
    expect(events.some((e) => e.type === 'alienFired')).toBe(true);
    // Docked aliens sit on their slots.
    const cols = waveColumns(WAVES[WAVE_11]);
    for (const a of run.aliens.filter((x) => x.mode === 'formation')) {
      const pos = slotPosition(run.formation, a.col, a.row, cols);
      expect(a.x).toBeCloseTo(pos.x, 6);
    }
  });
});
