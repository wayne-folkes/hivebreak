import { describe, expect, it } from 'vitest';
import {
  DROP_DISTANCE,
  FORMATION_TOP_Y,
  INVADE_MARGIN,
  SIDE_MARGIN,
  SLOT_SPACING_X,
  SLOT_SPACING_Y,
  hasInvaded,
  marchSpeed,
  pickShooter,
  rollEvent,
  slotPosition,
  spawnFormation,
  stepFormation,
} from './formation';
import { ALIEN_SPECS } from './aliens';
import { FIELD_WIDTH } from './playfield';
import { SHIP_TOP, SHIP_Y } from './player';
import { createRng } from './rng';
import type { WaveDef } from './types';

const DT = 1 / 120;
const def = (rows: string[], marchSpeed = 20): WaveDef => ({ rows, marchSpeed, fireRate: 0, diveRate: 0 });

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
