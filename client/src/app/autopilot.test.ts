import { describe, expect, it } from 'vitest';
import { SHIP_X_LIMIT } from '../game/player';
import { createRun } from '../game/run';
import { autopilot } from './autopilot';

describe('autopilot', () => {
  it('always holds fire and never drags', () => {
    const input = autopilot(createRun(1));
    expect(input.fire).toBe(true);
    expect(input.drag).toBe(0);
    expect(Math.abs(input.move)).toBeLessThanOrEqual(1);
  });

  it('steers towards the lowest alien', () => {
    const run = createRun(1);
    run.players[0].x = 0;
    run.aliens = run.aliens.slice(0, 2);
    run.aliens[0].x = -50;
    run.aliens[0].y = 100;
    run.aliens[1].x = 40;
    run.aliens[1].y = 20;
    expect(autopilot(run).move).toBe(1);
    run.aliens[1].y = 120;
    expect(autopilot(run).move).toBe(-1);
  });

  it('ignores aliens flying back, and stays put with nothing to chase', () => {
    const run = createRun(1);
    run.players[0].x = 10;
    run.aliens = run.aliens.slice(0, 1);
    run.aliens[0].mode = 'returning';
    run.aliens[0].x = -80;
    expect(autopilot(run).move).toBe(0);
    run.aliens = [];
    expect(autopilot(run).move).toBe(0);
  });

  it('steps out of an acid column, towards the side its target is on', () => {
    const run = createRun(1);
    run.players[0].x = 0;
    run.aliens = run.aliens.slice(0, 1);
    run.aliens[0].x = 4;
    run.acid = [{ id: 1, x: 0, halfWidth: 7, state: 'rain', timeLeft: 1 }];
    expect(autopilot(run).move).toBe(1);
    run.aliens[0].x = -4;
    expect(autopilot(run).move).toBe(-1);
    // A column elsewhere changes nothing.
    run.acid[0].x = 60;
    run.aliens[0].x = 0;
    expect(autopilot(run).move).toBe(0);
  });

  it('leaves a column against a wall by its open side', () => {
    const run = createRun(1);
    run.players[0].x = SHIP_X_LIMIT;
    run.aliens = run.aliens.slice(0, 1);
    run.aliens[0].x = SHIP_X_LIMIT + 5;
    run.acid = [{ id: 1, x: SHIP_X_LIMIT - 4, halfWidth: 7, state: 'warn', timeLeft: 1 }];
    expect(autopilot(run).move).toBe(-1);
    run.players[0].x = -SHIP_X_LIMIT;
    run.aliens[0].x = -SHIP_X_LIMIT - 5;
    run.acid[0].x = -SHIP_X_LIMIT + 4;
    expect(autopilot(run).move).toBe(1);
  });

  it('leaves two columns side by side by the far side of both', () => {
    const run = createRun(1);
    run.players[0].x = 0;
    run.aliens = run.aliens.slice(0, 1);
    run.aliens[0].x = 2;
    run.acid = [
      { id: 1, x: 0, halfWidth: 7, state: 'rain', timeLeft: 1 },
      { id: 2, x: 20, halfWidth: 7, state: 'warn', timeLeft: 1 },
    ];
    // Right of the first column is inside the second, so it goes left.
    expect(autopilot(run).move).toBe(-1);
  });
});
