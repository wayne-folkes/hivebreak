import { describe, expect, it } from 'vitest';
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
});
