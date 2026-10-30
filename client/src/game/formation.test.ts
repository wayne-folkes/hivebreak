import { describe, expect, it } from 'vitest';
import {
  DROP_DISTANCE,
  FORMATION_TOP_Y,
  INVADE_MARGIN,
  SIDE_MARGIN,
  SPLIT_APART_SECONDS,
  SPLIT_DROP,
  SPLIT_JOINED_SECONDS,
  SLOT_SPACING_X,
  SLOT_SPACING_Y,
  hasInvaded,
  marchSpeed,
  pickDivePair,
  pickShooter,
  rollEvent,
  slotPosition,
  spawnFormation,
  stepFormation,
} from './formation';
import { ALIEN_SPECS, createAlien } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP, SHIP_Y } from './player';
import { createRng } from './rng';
import type { Alien, FormationState, WaveDef } from './types';

const DT = 1 / 120;
const def = (rows: string[], marchSpeed = 20): WaveDef => ({ rows, marchSpeed, fireRate: 0, diveRate: 0, sector: 1 });
const splitDef = (rows: string[], marchSpeed = 20): WaveDef => ({ ...def(rows, marchSpeed), sector: 2, behaviours: ['split'] });

function ids() {
  let n = 0;
  return () => ++n;
}

describe('spawnFormation', () => {
  it('lays aliens on a centred grid, top row first, skipping gaps', () => {
    const { aliens, formation } = spawnFormation(def(['.wd', 'dvd']), ids());
    expect(formation.startCount).toBe(5);
    expect(aliens.map((a) => a.kind)).toEqual(['warden', 'drone', 'drone', 'diver', 'drone']);
    const topWarden = aliens[0];
    expect(topWarden.y).toBe(FORMATION_TOP_Y);
    expect(topWarden.x).toBeCloseTo(0, 6); // middle column of three
    const bottomLeft = aliens[2];
    expect(bottomLeft.x).toBe(-SLOT_SPACING_X);
    expect(bottomLeft.y).toBe(FORMATION_TOP_Y - SLOT_SPACING_Y);
  });

  it('gives every alien its own id', () => {
    const { aliens } = spawnFormation(def(['ddd', 'ddd']), ids());
    expect(new Set(aliens.map((a) => a.id)).size).toBe(6);
  });

  it("builds a carrier from 'c' in its slot", () => {
    const { aliens } = spawnFormation(def(['dcd', 'ddd']), ids());
    const carrier = aliens.find((a) => a.kind === 'carrier');
    expect(carrier).toMatchObject({ hp: 4, mode: 'formation', col: 1, row: 0 });
    expect(carrier?.x).toBeCloseTo(0, 6);
  });

  it('rejects an unknown letter', () => {
    expect(() => spawnFormation(def(['dx']), ids())).toThrow();
  });
});

describe('slotPosition', () => {
  it('moves with the formation offset', () => {
    const f = { offsetX: 10, offsetY: -8, dir: 1 as const, startCount: 1 };
    expect(slotPosition(f, 0, 0, 1)).toEqual({ x: 10, y: FORMATION_TOP_Y - 8 });
  });
});

describe('marchSpeed', () => {
  it('speeds up as the formation thins, to three times at the end', () => {
    const d = def(['dddd']);
    const f = { offsetX: 0, offsetY: 0, dir: 1 as const, startCount: 10 };
    expect(marchSpeed(d, f, 10)).toBe(20);
    expect(marchSpeed(d, f, 5)).toBeCloseTo(40, 6);
    expect(marchSpeed(d, f, 0)).toBeCloseTo(60, 6);
  });
});

describe('stepFormation', () => {
  it('marches sideways at the wave speed', () => {
    const d = def(['dd']);
    const { aliens, formation } = spawnFormation(d, ids());
    stepFormation(formation, aliens, d, 0.5);
    expect(formation.offsetX).toBeCloseTo(10, 6);
    expect(formation.offsetY).toBe(0);
  });

  it('drops and turns round when an alien reaches the side margin, without crossing it', () => {
    const d = def(['dddd']);
    const { aliens, formation } = spawnFormation(d, ids());
    let drops = 0;
    let lastDir = formation.dir;
    const limit = FIELD_WIDTH / 2 - SIDE_MARGIN;
    for (let i = 0; i < 120 * 20; i++) {
      stepFormation(formation, aliens, d, DT);
      const half = ALIEN_SPECS.drone.halfWidth;
      const right = 1.5 * SLOT_SPACING_X + formation.offsetX + half;
      const left = -1.5 * SLOT_SPACING_X + formation.offsetX - half;
      expect(right).toBeLessThanOrEqual(limit + 1e-9);
      expect(left).toBeGreaterThanOrEqual(-limit - 1e-9);
      if (formation.dir !== lastDir) {
        drops++;
        lastDir = formation.dir;
      }
    }
    expect(drops).toBeGreaterThan(2);
    expect(formation.offsetY).toBe(-drops * DROP_DISTANCE);
  });

  it('turns at the first drop exactly when touching the margin', () => {
    const d = def(['dd'], 100);
    const { aliens, formation } = spawnFormation(d, ids());
    for (let i = 0; i < 120 * 3 && formation.dir === 1; i++) stepFormation(formation, aliens, d, DT);
    expect(formation.dir).toBe(-1);
    expect(formation.offsetY).toBe(-DROP_DISTANCE);
    const right = 0.5 * SLOT_SPACING_X + formation.offsetX + ALIEN_SPECS.drone.halfWidth;
    expect(right).toBeCloseTo(FIELD_WIDTH / 2 - SIDE_MARGIN, 6);
  });

  it('keeps the slot of a diver that has left the formation', () => {
    const d = def(['dd'], 100);
    const { aliens, formation } = spawnFormation(d, ids());
    aliens[1].mode = 'diving';
    for (let i = 0; i < 120 * 3 && formation.dir === 1; i++) stepFormation(formation, aliens, d, DT);
    expect(formation.dir).toBe(-1);
  });

  it('does nothing with no aliens', () => {
    const d = def(['dd']);
    const { formation } = spawnFormation(d, ids());
    stepFormation(formation, [], d, 1);
    expect(formation.offsetX).toBe(0);
  });
});

describe('pickShooter', () => {
  it('picks the lowest alien in a column', () => {
    const { aliens } = spawnFormation(def(['dd', 'dd', 'dd']), ids());
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) expect(pickShooter(aliens, rng)?.row).toBe(2);
  });

  it('skips empty columns and aliens that have left the formation', () => {
    const { aliens } = spawnFormation(def(['dd', 'dd']), ids());
    const left = aliens.filter((a) => a.col === 0);
    left.forEach((a) => aliens.splice(aliens.indexOf(a), 1));
    aliens.find((a) => a.row === 1)!.mode = 'diving';
    const shooter = pickShooter(aliens, createRng(1));
    expect(shooter).toMatchObject({ col: 1, row: 0 });
  });

  it('returns null when nothing is in formation', () => {
    expect(pickShooter([], createRng(1))).toBeNull();
  });

  it('picks every column over time', () => {
    const { aliens } = spawnFormation(def(['ddd']), ids());
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(pickShooter(aliens, rng)!.col);
    expect(seen.size).toBe(3);
  });
});

describe('rollEvent', () => {
  it('never happens at rate 0', () => {
    const rng = createRng(1);
    for (let i = 0; i < 100; i++) expect(rollEvent(0, DT, rng)).toBe(false);
  });

  it('happens about rate times per second', () => {
    const rng = createRng(11);
    let count = 0;
    for (let i = 0; i < 120 * 200; i++) if (rollEvent(0.5, DT, rng)) count++;
    expect(count / 200).toBeGreaterThan(0.4);
    expect(count / 200).toBeLessThan(0.6);
  });
});

describe('hasInvaded', () => {
  it('is true once a formation alien comes down to the ship', () => {
    const { aliens } = spawnFormation(def(['d']), ids());
    expect(hasInvaded(aliens)).toBe(false);
    aliens[0].y = SHIP_TOP + INVADE_MARGIN + ALIEN_SPECS.drone.halfHeight;
    expect(hasInvaded(aliens)).toBe(true);
  });

  it('is not true just above the line', () => {
    const { aliens } = spawnFormation(def(['d']), ids());
    aliens[0].y = SHIP_TOP + INVADE_MARGIN + ALIEN_SPECS.drone.halfHeight + 0.01;
    expect(hasInvaded(aliens)).toBe(false);
  });

  it('ignores divers that are swooping past', () => {
    const { aliens } = spawnFormation(def(['d']), ids());
    aliens[0].y = SHIP_Y;
    aliens[0].mode = 'diving';
    expect(hasInvaded(aliens)).toBe(false);
  });
});

describe('splitters', () => {
  it("builds a splitter from 's' in its slot", () => {
    const { aliens } = spawnFormation(def(['ds', 'dd']), ids());
    expect(aliens.find((a) => a.kind === 'splitter')).toMatchObject({ hp: 2, mode: 'formation', col: 1, row: 0 });
  });
});

describe('free aliens in a formation wave', () => {
  it('are ignored by the march: no slot, no edge, no speed-up', () => {
    const d = def(['dd']);
    const a = spawnFormation(d, ids());
    const b = spawnFormation(d, ids());
    const mini = createAlien('mini', 99, -1, -1, 0, 0);
    mini.mode = 'free';
    stepFormation(a.formation, [...a.aliens, mini], d, 0.5);
    stepFormation(b.formation, b.aliens, d, 0.5);
    expect(a.formation.offsetX).toBeCloseTo(b.formation.offsetX, 9);
    expect(stepFormation(a.formation, [mini], d, 1)).toBeNull();
  });
});

describe('split formation', () => {
  const wide = ['dddd', 'dddd', 'dddd'];
  const limit = FIELD_WIDTH / 2 - SIDE_MARGIN;

  function setup(rows = wide, speed = 20) {
    const d = splitDef(rows, speed);
    const { aliens, formation } = spawnFormation(d, ids());
    return { d, aliens, formation, cols: rows[0].length };
  }

  /** Outer edges of the aliens on one side of the split column, at their slots. */
  function edges(f: FormationState, aliens: Alien[], cols: number, right: boolean) {
    const side = aliens.filter((a) => (a.col >= f.split!.splitColumn) === right);
    const xs = side.map((a) => slotPosition(f, a.col, a.row, cols).x);
    const half = ALIEN_SPECS.drone.halfWidth;
    return { min: Math.min(...xs) - half, max: Math.max(...xs) + half };
  }

  it('starts joined on a split wave, split at the middle column; other waves have no split state', () => {
    const { formation } = setup();
    expect(formation.split).toMatchObject({ mode: 'joined', modeTime: 0, leftOffsetX: 0, rightOffsetX: 0, splitColumn: 2 });
    expect(spawnFormation(def(wide), ids()).formation.split).toBeUndefined();
    expect(spawnFormation(splitDef(['ddddd']), ids()).formation.split?.splitColumn).toBe(3);
  });

  it('marches as one while joined, then splits after SPLIT_JOINED_SECONDS', () => {
    const { d, aliens, formation } = setup();
    const changes: string[] = [];
    let t = 0;
    while (formation.split!.mode === 'joined' && t < SPLIT_JOINED_SECONDS + 1) {
      const c = stepFormation(formation, aliens, d, DT);
      if (c) changes.push(c);
      t += DT;
    }
    expect(changes).toEqual(['split']);
    expect(t).toBeGreaterThan(SPLIT_JOINED_SECONDS - 0.05);
    expect(t).toBeLessThan(SPLIT_JOINED_SECONDS + 0.05);
    expect(formation.split).toMatchObject({ mode: 'apart', modeTime: 0, leftDir: -1, rightDir: 1 });
  });

  it('cycles joined, apart, regrouping, joined, announcing each split and regroup once', () => {
    const { d, aliens, formation } = setup(wide, 12);
    const seen: string[] = [];
    const changes: string[] = [];
    for (let i = 0; i < 120 * 40; i++) {
      const c = stepFormation(formation, aliens, d, DT);
      if (c) changes.push(c);
      const mode = formation.split!.mode;
      if (seen[seen.length - 1] !== mode) seen.push(mode);
    }
    expect(seen.slice(0, 7)).toEqual(['joined', 'apart', 'regrouping', 'joined', 'apart', 'regrouping', 'joined']);
    expect(changes.slice(0, 4)).toEqual(['split', 'regroup', 'split', 'regroup']);
  });

  it('moves the halves apart, keeps both inside the field, and never lets them cross', () => {
    const { d, aliens, formation, cols } = setup(['ddddd', 'ddddd'], 25);
    let maxSeparation = 0;
    let apartSteps = 0;
    for (let i = 0; i < 120 * 60; i++) {
      stepFormation(formation, aliens, d, DT);
      const l = edges(formation, aliens, cols, false);
      const r = edges(formation, aliens, cols, true);
      expect(l.min).toBeGreaterThanOrEqual(-limit - 1e-6);
      expect(r.max).toBeLessThanOrEqual(limit + 1e-6);
      // Never closer than when joined (one slot apart less the two boxes), give or take a step.
      expect(r.min - l.max).toBeGreaterThan(SLOT_SPACING_X - 2 * ALIEN_SPECS.drone.halfWidth - 1);
      if (formation.split!.mode === 'apart') {
        apartSteps++;
        maxSeparation = Math.max(maxSeparation, formation.split!.rightOffsetX - formation.split!.leftOffsetX);
      }
    }
    expect(apartSteps).toBeGreaterThan(0);
    expect(maxSeparation).toBeGreaterThan(20);
  });

  it('bounces each half off the side walls on its own, stepping down by SPLIT_DROP', () => {
    const { d, aliens, formation } = setup(['dddd', 'dddd'], 30);
    formation.split!.modeTime = SPLIT_JOINED_SECONDS;
    expect(stepFormation(formation, aliens, d, DT)).toBe('split');
    const dirs = new Set<string>();
    let drops = 0;
    let lastY = formation.offsetY;
    for (let i = 0; i < 120 * SPLIT_APART_SECONDS - 2 && formation.split!.mode === 'apart'; i++) {
      stepFormation(formation, aliens, d, DT);
      dirs.add(`${formation.split!.leftDir},${formation.split!.rightDir}`);
      if (formation.offsetY < lastY) {
        expect(lastY - formation.offsetY).toBeCloseTo(SPLIT_DROP, 6);
        drops++;
        lastY = formation.offsetY;
      }
    }
    expect(drops).toBeGreaterThanOrEqual(1);
    // The halves turned on their own; the formation's own direction is untouched while apart.
    expect(dirs.size).toBeGreaterThan(1);
    expect(formation.dir).toBe(1);
  });

  it('regroups cleanly: offsets close to exactly zero and the formation marches as one again', () => {
    const { d, aliens, formation, cols } = setup(wide, 25);
    let regrouped = false;
    for (let i = 0; i < 120 * 30; i++) {
      stepFormation(formation, aliens, d, DT);
      if (formation.split!.mode === 'regrouping') regrouped = true;
      if (regrouped && formation.split!.mode === 'joined') break;
    }
    expect(regrouped).toBe(true);
    expect(formation.split).toMatchObject({ mode: 'joined', leftOffsetX: 0, rightOffsetX: 0 });
    const x0 = formation.offsetX;
    stepFormation(formation, aliens, d, DT);
    expect(formation.offsetX).not.toBe(x0);
    expect(edges(formation, aliens, cols, false).min).toBeGreaterThanOrEqual(-limit - 1e-6);
    expect(edges(formation, aliens, cols, true).max).toBeLessThanOrEqual(limit + 1e-6);
  });

  it("slotPosition adds each alien's own half offset", () => {
    const f: FormationState = {
      offsetX: 3,
      offsetY: -8,
      dir: 1,
      startCount: 4,
      split: { mode: 'apart', modeTime: 1, leftOffsetX: -10, rightOffsetX: 7, leftDir: -1, rightDir: 1, splitColumn: 2 },
    };
    expect(slotPosition(f, 0, 0, 4).x).toBe(-1.5 * SLOT_SPACING_X + 3 - 10);
    expect(slotPosition(f, 1, 0, 4).x).toBe(-0.5 * SLOT_SPACING_X + 3 - 10);
    expect(slotPosition(f, 2, 1, 4).x).toBe(0.5 * SLOT_SPACING_X + 3 + 7);
    expect(slotPosition(f, 3, 1, 4)).toEqual({ x: 1.5 * SLOT_SPACING_X + 3 + 7, y: FORMATION_TOP_Y - SLOT_SPACING_Y - 8 });
  });

  it('opens a gap down the middle while apart: left slots go left, right slots go right', () => {
    const { d, aliens, formation } = setup(wide, 25);
    formation.split!.modeTime = SPLIT_JOINED_SECONDS;
    for (let i = 0; i < 120; i++) stepFormation(formation, aliens, d, DT);
    expect(formation.split!.mode).toBe('apart');
    expect(formation.split!.rightOffsetX).toBeGreaterThan(0);
    expect(formation.split!.leftOffsetX).toBeLessThan(0);
  });

  it('shares the step-down between the halves, so the invaded line sees either one', () => {
    const { d, aliens, formation } = setup(['dddd'], 30);
    formation.split!.modeTime = SPLIT_JOINED_SECONDS;
    for (let i = 0; i < 120 * 3; i++) stepFormation(formation, aliens, d, DT);
    expect(formation.offsetY).toBeLessThan(0);
    const left = aliens.find((a) => a.col === 0)!;
    const right = aliens.find((a) => a.col === 3)!;
    expect(left.y).toBeCloseTo(right.y, 9);
    left.y = SHIP_TOP + INVADE_MARGIN + ALIEN_SPECS.drone.halfHeight;
    expect(hasInvaded([left])).toBe(true);
    expect(hasInvaded([right])).toBe(false);
    right.y = left.y;
    left.y += 5;
    expect(hasInvaded([left, right])).toBe(true);
  });

  it('does not split with one half wiped out; it keeps marching as one', () => {
    const { d, aliens, formation } = setup(wide, 20);
    const survivors = aliens.filter((a) => a.col >= 2);
    for (let i = 0; i < 120 * (SPLIT_JOINED_SECONDS + 2); i++) {
      expect(stepFormation(formation, survivors, d, DT)).toBeNull();
    }
    expect(formation.split!.mode).toBe('joined');
  });

  it('is deterministic: the same wave steps the same way twice', () => {
    const play = () => {
      const { d, aliens, formation } = setup(wide, 27);
      const log: number[] = [];
      for (let i = 0; i < 120 * 30; i++) {
        stepFormation(formation, aliens, d, DT);
        if (i % 120 === 0) log.push(formation.offsetX, formation.offsetY, formation.split!.leftOffsetX, formation.split!.rightOffsetX);
      }
      return log;
    };
    expect(play()).toEqual(play());
  });

  it('leaves non-split waves unchanged: no change reported, no split state', () => {
    const d = def(wide);
    const { aliens, formation } = spawnFormation(d, ids());
    for (let i = 0; i < 120 * 20; i++) expect(stepFormation(formation, aliens, d, DT)).toBeNull();
    expect(formation.split).toBeUndefined();
  });
});

describe('pickDivePair', () => {
  const rows = ['dddd', 'dvvd', 'vdvv'];

  it('picks two divers in the same row, in adjacent columns, left first', () => {
    const { aliens } = spawnFormation(def(rows), ids());
    const rng = createRng(4);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const pair = pickDivePair(aliens, rng);
      expect(pair).not.toBeNull();
      const [a, b] = pair!;
      expect(a.kind).toBe('diver');
      expect(b.kind).toBe('diver');
      expect(b.row).toBe(a.row);
      expect(b.col).toBe(a.col + 1);
      seen.add(`${a.row}:${a.col}`);
    }
    // Row 1 has one pair (cols 1-2) and row 2 has one (cols 2-3); the lone diver at row 2 col 0 never pairs.
    expect([...seen].sort()).toEqual(['1:1', '2:2']);
  });

  it('returns null with no neighbouring divers, and leaves the rng alone', () => {
    const { aliens } = spawnFormation(def(['vdvd', 'dvdv']), ids());
    const rng = createRng(9);
    const probe = createRng(9);
    expect(pickDivePair(aliens, rng)).toBeNull();
    expect(rng.next()).toBe(probe.next());
    expect(pickDivePair([], rng)).toBeNull();
  });

  it('skips divers that are not in formation', () => {
    const { aliens } = spawnFormation(def(['vv']), ids());
    aliens[1].mode = 'diving';
    expect(pickDivePair(aliens, createRng(1))).toBeNull();
    aliens[1].mode = 'returning';
    expect(pickDivePair(aliens, createRng(1))).toBeNull();
    aliens[1].mode = 'formation';
    expect(pickDivePair(aliens, createRng(1))).not.toBeNull();
  });

  it('does not pair divers that a split has pulled far apart', () => {
    const { aliens } = spawnFormation(def(['vv']), ids());
    aliens[0].x -= 40;
    aliens[1].x += 40;
    expect(pickDivePair(aliens, createRng(1))).toBeNull();
  });

  it('only pairs divers on the same half when the formation is split', () => {
    const d = splitDef(['vvvv']);
    const { aliens, formation } = spawnFormation(d, ids());
    const rng = createRng(2);
    for (let i = 0; i < 30; i++) {
      const [a, b] = pickDivePair(aliens, rng, formation.split)!;
      expect(a.col < 2).toBe(b.col < 2);
    }
    // Only the pair that straddles the gap is left: no pair when split, one when not.
    const straddle = aliens.filter((a) => a.col === 1 || a.col === 2);
    expect(pickDivePair(straddle, createRng(1), formation.split)).toBeNull();
    expect(pickDivePair(straddle, createRng(1))).not.toBeNull();
  });

  it('ignores other kinds next to a diver', () => {
    const { aliens } = spawnFormation(def(['vdv', 'dvd']), ids());
    expect(pickDivePair(aliens, createRng(1))).toBeNull();
  });

  it('is deterministic with a seeded rng', () => {
    const { aliens } = spawnFormation(def(rows), ids());
    const picks = (seed: number) => {
      const rng = createRng(seed);
      return Array.from({ length: 20 }, () => {
        const [a, b] = pickDivePair(aliens, rng)!;
        return `${a.id}-${b.id}`;
      });
    };
    expect(picks(7)).toEqual(picks(7));
  });
});
