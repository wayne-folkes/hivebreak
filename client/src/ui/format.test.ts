import { describe, expect, it } from 'vitest';
import type { Fit } from '../game/playfield';
import { fitPlayfield } from '../game/playfield';
import type { RunRecord } from '../game/records';
import {
  bossBarLabel,
  bossBarPercent,
  bossPhaseLabel,
  bossDownHeading,
  comboLabel,
  endTitle,
  formatDate,
  formatScore,
  hudLayout,
  meterCells,
  pickReady,
  pickTags,
  powerUpChips,
  PAUSE_RESERVE,
  PICK_GUARD_SECONDS,
  rankBadge,
  sectorBanner,
  recordRowText,
  specialHint,
  stackLabel,
  summarizeUpgrades,
  synergyToast,
  waveClearHeading,
  waveSector,
  waveLabel,
} from './format';

describe('formatScore', () => {
  it('pads to six digits', () => {
    expect(formatScore(0)).toBe('000000');
    expect(formatScore(4250)).toBe('004250');
    expect(formatScore(123456)).toBe('123456');
  });

  it('lets a bigger score grow and ignores bad numbers', () => {
    expect(formatScore(1234567)).toBe('1234567');
    expect(formatScore(42.9)).toBe('000042');
    expect(formatScore(-5)).toBe('000000');
    expect(formatScore(Number.NaN)).toBe('000000');
  });
});

describe('labels', () => {
  it('writes the combo and wave', () => {
    expect(comboLabel(3)).toBe('x3');
    expect(comboLabel(0)).toBe('x1');
    expect(waveLabel(2, 5)).toBe('2/5');
  });

  it('writes stacks as taken over max', () => {
    expect(stackLabel(0, 2)).toBe('0/2');
    expect(stackLabel(2, 3)).toBe('2/3');
  });

  it('names the ways a run ends', () => {
    expect(endTitle(true)).toBe('HIVE BROKEN');
    expect(endTitle(false, 'lives')).toBe('SHIP LOST');
    expect(endTitle(false, 'invaded')).toBe('THE HIVE LANDED');
    expect(endTitle(false)).toBe('SHIP LOST');
  });

  it('badges only runs that made the top 10', () => {
    expect(rankBadge(-1)).toBeNull();
    expect(rankBadge(0)).toBe('New best!');
    expect(rankBadge(2)).toBe('Rank #3');
    expect(rankBadge(9)).toBe('Rank #10');
  });
});

describe('pickReady', () => {
  it('ignores presses inside the guard time', () => {
    expect(PICK_GUARD_SECONDS).toBe(0.4);
    expect(pickReady(1000, 1000)).toBe(false);
    expect(pickReady(1000, 1399)).toBe(false);
  });

  it('takes presses from 0.4 s on', () => {
    expect(pickReady(1000, 1400)).toBe(true);
    expect(pickReady(1000, 5000)).toBe(true);
  });

  it('handles a clock that has not reached the open time', () => {
    expect(pickReady(-Infinity, 0)).toBe(true);
    expect(pickReady(2000, 1500)).toBe(false);
  });
});

describe('records', () => {
  const record: RunRecord = { score: 4250, wave: 3, bestCombo: 6, won: false, date: new Date(2026, 9, 29, 12).toISOString() };

  it('formats a date as day and month', () => {
    expect(formatDate(record.date)).toBe('29 Oct');
    expect(formatDate('not a date')).toBe('-');
  });

  it('turns a record into row text, ranked from 1', () => {
    expect(recordRowText(0, record)).toEqual({
      rank: '1',
      score: '004250',
      wave: 'W3/5',
      combo: 'x6',
      result: 'LOST',
      date: '29 Oct',
    });
    expect(recordRowText(9, { ...record, won: true, wave: 5 })).toMatchObject({ rank: '10', wave: 'W5/5', result: 'WON' });
  });

  it('shows the run length a record was saved with', () => {
    expect(recordRowText(0, { ...record, wave: 10, waves: 10, won: true })).toMatchObject({ wave: 'W10/10', result: 'WON' });
    expect(recordRowText(0, { ...record, waves: 10 }).wave).toBe('W3/10');
  });
});

describe('summarizeUpgrades', () => {
  it('counts each upgrade once, in the order first picked', () => {
    expect(summarizeUpgrades(['rapidFire', 'twinShot', 'rapidFire'])).toEqual([
      { id: 'rapidFire', name: 'Rapid fire', count: 2 },
      { id: 'twinShot', name: 'Twin shot', count: 1 },
    ]);
    expect(summarizeUpgrades([])).toEqual([]);
  });
});

describe('hudLayout', () => {
  it('overlays the field on a phone and leaves room for the pause button', () => {
    const layout = hudLayout(fitPlayfield(390, 844, 1), 390);
    expect(layout.side).toBe(false);
    expect(layout.sideWidth).toBe(0);
    // The field leaves 15 px at the right; the pause button needs 64 from the screen edge.
    expect(layout.rightInset).toBe(PAUSE_RESERVE - 15);
  });

  it('needs no inset when the field leaves room for the pause button', () => {
    const fit: Fit = { scale: 2, width: 360, height: 640, left: 100, top: 0 };
    expect(hudLayout(fit, 560).rightInset).toBe(0);
  });

  it('moves to side panels on a wide screen', () => {
    const layout = hudLayout(fitPlayfield(1440, 900, 1), 1440);
    expect(layout).toEqual({ side: true, sideWidth: 540, rightInset: 0 });
  });

  it('stays overlaid when the sides are too narrow', () => {
    expect(hudLayout(fitPlayfield(640, 700, 1), 640).side).toBe(false);
  });
});

describe('meterCells', () => {
  it('fills cells left to right', () => {
    expect(meterCells(0)).toEqual([0, 0, 0, 0, 0]);
    expect(meterCells(1)).toEqual([1, 1, 1, 1, 1]);
    const half = meterCells(0.5);
    expect(half.slice(0, 2)).toEqual([1, 1]);
    expect(half[2]).toBeCloseTo(0.5, 9);
    expect(half.slice(3)).toEqual([0, 0]);
  });

  it('keeps each cell between 0 and 1, and copes with bad numbers', () => {
    expect(meterCells(3)).toEqual([1, 1, 1, 1, 1]);
    expect(meterCells(-1)).toEqual([0, 0, 0, 0, 0]);
    expect(meterCells(Number.NaN)).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('specialHint', () => {
  it('names the key for each device', () => {
    expect(specialHint('keyboard')).toBe('X');
    expect(specialHint('gamepad')).toBe('B / LT');
    expect(specialHint('touch')).toBe('tap the button');
  });
});

describe('powerUpChips', () => {
  it('counts down in whole seconds, rounding up', () => {
    const chips = powerUpChips([
      { kind: 'spread', timeLeft: 5.2 },
      { kind: 'laser', timeLeft: 0.1 },
    ]);
    expect(chips.map((c) => c.label)).toEqual(['SPREAD 6s', 'LASER 1s']);
  });

  it('keeps the order they run in and flags the ones about to run out', () => {
    const chips = powerUpChips([
      { kind: 'helper', timeLeft: 9 },
      { kind: 'slow', timeLeft: 2.5 },
    ]);
    expect(chips.map((c) => c.kind)).toEqual(['helper', 'slow']);
    expect(chips.map((c) => c.low)).toEqual([false, true]);
  });

  it('skips a power-up with no time left, and shows nothing for none', () => {
    expect(powerUpChips([{ kind: 'spread', timeLeft: 0 }])).toEqual([]);
    expect(powerUpChips([])).toEqual([]);
  });
});

describe('bossBarPercent', () => {
  it('turns bossHealth into a whole percentage', () => {
    expect(bossBarPercent(1)).toBe(100);
    expect(bossBarPercent(0.624)).toBe(62);
    expect(bossBarPercent(0)).toBe(0);
  });

  it('clamps and copes with bad numbers', () => {
    expect(bossBarPercent(1.5)).toBe(100);
    expect(bossBarPercent(-0.2)).toBe(0);
    expect(bossBarPercent(Number.NaN)).toBe(0);
  });
});

describe('pick headings', () => {
  it('reads WAVE n CLEAR after a wave and the boss name after a boss', () => {
    expect(waveClearHeading(3)).toBe('WAVE 3 CLEAR');
    expect(bossDownHeading('broodMother')).toBe('BROOD MOTHER DOWN');
    expect(bossDownHeading('hiveMind')).toBe('HIVE MIND DOWN');
  });
});

describe('pickTags', () => {
  it('shows the rarity word when no synergy is completed', () => {
    expect(pickTags('common', null)).toEqual({ rarity: 'common', synergy: null });
    expect(pickTags('rare', null)).toEqual({ rarity: 'rare', synergy: null });
  });

  it('puts the synergy hint in place of the rarity word', () => {
    expect(pickTags('uncommon', 'lance')).toEqual({ rarity: null, synergy: 'completes LANCE' });
  });

  it('keeps the word "rare" beside a synergy hint', () => {
    expect(pickTags('rare', 'seekers')).toEqual({ rarity: 'rare', synergy: 'completes SEEKERS' });
  });
});

describe('synergyToast', () => {
  it('has the synergy name in capitals over its description', () => {
    expect(synergyToast('lance')).toEqual({
      text: 'SYNERGY: LANCE',
      sub: 'Every volley adds a bolt that pierces everything.',
    });
    expect(synergyToast('chainReaction').text).toBe('SYNERGY: CHAIN REACTION');
  });
});

describe('waveSector', () => {
  it('puts waves 1-5 in sector 1 and 6-10 in sector 2 (0-based index)', () => {
    expect(waveSector(0)).toBe(1);
    expect(waveSector(4)).toBe(1);
    expect(waveSector(5)).toBe(2);
    expect(waveSector(9)).toBe(2);
  });

  it('stays in the last sector past the end', () => {
    expect(waveSector(10)).toBe(2);
    expect(waveSector(-3)).toBe(1);
  });
});

describe('sectorBanner', () => {
  it('has a banner for sector 2 and keeps sector 1 quiet', () => {
    expect(sectorBanner(1)).toBeNull();
    expect(sectorBanner(2)).toEqual({ title: 'SECTOR 2', sub: 'Deeper into the hive' });
  });
});

describe('bossBarLabel', () => {
  it('shows the Hive Mind with its phase and the Brood Mother by name', () => {
    expect(bossBarLabel('hiveMind', 2)).toBe('HIVE MIND · PHASE 2');
    expect(bossBarLabel('broodMother', 2)).toBe('BROOD MOTHER');
  });

  it('gives the phase tag alone for the Hive Mind only', () => {
    expect(bossPhaseLabel('hiveMind', 3)).toBe('PHASE 3');
    expect(bossPhaseLabel('hiveMind', 0)).toBe('PHASE 1');
    expect(bossPhaseLabel('broodMother', 2)).toBeNull();
  });
});

describe('the wave counter over ten waves', () => {
  it('reads 1/10 to 10/10', () => {
    expect(waveLabel(1, 10)).toBe('1/10');
    expect(waveLabel(10, 10)).toBe('10/10');
  });
});
