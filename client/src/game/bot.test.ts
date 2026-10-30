import { describe, expect, it } from 'vitest';
import { botPick, botWins, playBotRun } from './bot';

describe('bot', () => {
  it('prefers rapid fire to unlisted upgrades', () => {
    expect(botPick(['magnet', 'rapidFire', 'homing'])).toBe(1);
    expect(botPick(['magnet', 'homing', 'ricochet'])).toBe(0);
  });

  it('wins a run with spare lives and counts wins over seeds', () => {
    expect(playBotRun(1, 99).phase).toBe('won');
    expect(botWins(2, 99)).toBe(2);
  });
});
