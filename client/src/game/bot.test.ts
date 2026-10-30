import { describe, expect, it } from 'vitest';
import { botInput, botPick, botWins, playBotRun } from './bot';
import { chooseSpecial, createRun } from './run';

describe('bot', () => {
  it('prefers rapid fire to unlisted upgrades', () => {
    expect(botPick(['magnet', 'rapidFire', 'homing'])).toBe(1);
    expect(botPick(['magnet', 'homing', 'ricochet'])).toBe(0);
  });

  it('wins a run with spare lives and counts wins over seeds', () => {
    expect(playBotRun(1, 99).phase).toBe('won');
    expect(botWins(2, 99)).toBe(2);
  });

  it('steers under the nearest boss plate when no aliens are left, then the core', () => {
    const run = createRun(1);
    chooseSpecial(run, 'pulseBomb');
    run.wave = 4;
    run.aliens = [];
    run.boss = {
      kind: 'broodMother', x: 0, y: 112, vx: 0, phase: 1, phaseTime: 0, launchTimer: 5, fireTimer: 5, stun: 0,
      parts: [
        { id: 1, kind: 'plate', hp: 14, maxHp: 14, dx: -39, dy: 0, halfWidth: 11, halfHeight: 6, flash: 0 },
        { id: 2, kind: 'plate', hp: 14, maxHp: 14, dx: 39, dy: 0, halfWidth: 11, halfHeight: 6, flash: 0 },
        { id: 3, kind: 'core', hp: 140, maxHp: 140, dx: 0, dy: 0, halfWidth: 7, halfHeight: 6, flash: 0 },
      ],
    };
    run.players[0].x = 30;
    expect(botInput(run).move).toBe(1);
    run.boss.parts[1].hp = 0;
    run.players[0].x = -10;
    expect(botInput(run).move).toBe(-1);
    run.boss.parts[0].hp = 0;
    run.players[0].x = -10;
    expect(botInput(run).move).toBe(1); // the core, at x 0
  });

  it('presses the Special once the meter is full', () => {
    const run = createRun(1);
    chooseSpecial(run, 'pulseBomb');
    expect(botInput(run).special).toBe(false);
    run.players[0].specialCharge = 1;
    expect(botInput(run).special).toBe(true);
  });
});
