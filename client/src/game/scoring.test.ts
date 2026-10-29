import { describe, expect, it } from 'vitest';
import { createAlien, startDive } from './aliens';
import { createRun } from './run';
import { COMBO_MAX, awardKill, killPoints, registerMiss, registerShotHit } from './scoring';

describe('combo', () => {
  it('rises with each shot that hits, up to the cap, tracking the best', () => {
    const run = createRun(1);
    for (let i = 0; i < 12; i++) registerShotHit(run);
    expect(run.combo).toBe(COMBO_MAX);
    expect(run.bestCombo).toBe(COMBO_MAX);
  });

  it('breaks back to 1 on a miss, keeping the best', () => {
    const run = createRun(1);
    registerShotHit(run);
    registerShotHit(run);
    expect(registerMiss(run)).toEqual([{ type: 'comboBroken', combo: 3 }]);
    expect(run.combo).toBe(1);
    expect(run.bestCombo).toBe(3);
  });

  it('says nothing when a miss has no combo to break', () => {
    const run = createRun(1);
    expect(registerMiss(run)).toEqual([]);
    expect(run.combo).toBe(1);
  });
});

describe('points', () => {
  it('multiplies base points by the combo', () => {
    expect(killPoints(createAlien('drone', 1, 0, 0, 0, 0), 4)).toBe(40);
    expect(killPoints(createAlien('warden', 1, 0, 0, 0, 0), 8)).toBe(240);
  });

  it('pays double for a diver that is diving', () => {
    const d = createAlien('diver', 1, 0, 0, 0, 0);
    startDive(d, 0);
    expect(killPoints(d, 2)).toBe(160);
  });

  it('adds a kill to the score and returns the points', () => {
    const run = createRun(1);
    run.combo = 3;
    expect(awardKill(run, createAlien('drone', 1, 0, 0, 0, 0))).toBe(30);
    expect(run.score).toBe(30);
  });
});
