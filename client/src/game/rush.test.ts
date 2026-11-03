import { describe, expect, it } from 'vitest';
import { RUSH_BONUS_PER_SECOND, RUSH_PAR_SECONDS, RUSH_START_PICKS, WAVE_COUNT, WAVE_INTRO_SECONDS, chooseSpecial, createRun, pickUpgrade, rushBossesBeaten, stepRun } from './run';
import { BOSS_POINTS } from './boss';
import { WAVES } from './waves';
import { upgradeDef } from './upgrades';
import { NO_INPUT } from './types';
import type { RunEvent, RunState, ShipInput } from './types';

const DT = 1 / 120;
const IDLE: readonly ShipInput[] = [NO_INPUT];

function steps(run: RunState, n: number): RunEvent[] {
  const events: RunEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepRun(run, IDLE, DT));
  return events;
}

/** A Boss Rush with the Special chosen, in its first pick. */
function rush(seed = 1): RunState {
  const run = createRun(seed, 1, 0, { mode: 'bossRush' });
  chooseSpecial(run, 'pulseBomb');
  return run;
}

/** Takes every starting pick; the run is in the first boss's intro. */
function takePicks(run: RunState): RunEvent[] {
  const events: RunEvent[] = [];
  while (run.phase === 'upgradePick' && run.rush!.picksLeft > 0) events.push(...pickUpgrade(run, 0));
  return events;
}

function skipIntro(run: RunState) {
  steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
  expect(run.phase).toBe('playing');
}

/** Sets the boss fight's clock, then kills the core and steps once, so the wave clears. */
function killBoss(run: RunState, stageTime?: number): RunEvent[] {
  if (stageTime !== undefined) run.rush!.stageTime = stageTime;
  const core = run.boss!.parts.find((p) => p.kind === 'core')!;
  core.hp = 0;
  return steps(run, 1);
}

describe('Boss Rush setup', () => {
  it('plays the boss waves in order, ignores firstWave and starts in the Special choice', () => {
    const run = createRun(1, 1, 7, { mode: 'bossRush' });
    expect(run.mode).toBe('bossRush');
    expect(run.rush).toEqual({ stages: [4, 9, 14], stage: 0, picksLeft: RUSH_START_PICKS, time: 0, stageTime: 0 });
    expect(run.rush!.stages.map((i) => WAVES[i].boss)).toEqual(['broodMother', 'hiveMind', 'hiveHeart']);
    expect(run.wave).toBe(4);
    expect(run.phase).toBe('chooseSpecial');
    expect(run.boss?.kind).toBe('broodMother');
    expect(RUSH_START_PICKS).toBe(3);
  });

  it('leaves a normal run alone', () => {
    for (const run of [createRun(1), createRun(1, 1, 3, {}), createRun(1, 1, 0, { mode: 'normal' })]) {
      expect(run.mode).toBe('normal');
      expect(run.rush).toBeNull();
    }
    expect(createRun(1, 1, 3).wave).toBe(3);
    expect(rushBossesBeaten(createRun(1))).toBe(0);
  });

  it('goes from the Special choice to the first of three picks, then the Brood Mother', () => {
    const run = rush();
    expect(run.phase).toBe('upgradePick');
    expect(run.offer.length).toBeGreaterThan(0);
    const events: RunEvent[] = [];
    for (let i = 0; i < RUSH_START_PICKS; i++) {
      expect(run.phase).toBe('upgradePick');
      expect(run.rush!.picksLeft).toBe(RUSH_START_PICKS - i);
      events.push(...pickUpgrade(run, 0));
    }
    expect(events.filter((e) => e.type === 'upgradePicked')).toHaveLength(3);
    expect(run.phase).toBe('waveIntro');
    expect(run.rush!.picksLeft).toBe(0);
    expect(run.rush!.stage).toBe(0);
    expect(run.wave).toBe(4);
    expect(run.boss?.kind).toBe('broodMother');
    expect(run.offer).toEqual([]);
    const first = steps(run, 1);
    expect(first).toContainEqual({ type: 'sectorStart', sector: 1 });
    expect(first).toContainEqual({ type: 'waveStart', wave: 4 });
    expect(run.bunkers.length).toBeGreaterThan(0);
  });

  it('skips straight to the boss when nothing can be offered', () => {
    const run = createRun(1, 1, 0, { mode: 'bossRush', upgrades: [] });
    chooseSpecial(run, 'pulseBomb');
    expect(run.phase).toBe('waveIntro');
    expect(run.rush!.picksLeft).toBe(0);
    expect(run.wave).toBe(4);
  });

  it('applies and announces each pick like a normal one', () => {
    const run = rush();
    const choice = run.offer[0];
    const events = pickUpgrade(run, 0);
    expect(events[0]).toEqual({ type: 'upgradePicked', playerId: 0, upgrade: choice });
  });
});

describe('Boss Rush clocks', () => {
  it('run in the intro and playing only', () => {
    const run = rush();
    steps(run, 50);
    expect(run.phase).toBe('upgradePick');
    expect(run.rush!.time).toBe(0);
    takePicks(run);
    expect(run.rush!.time).toBe(0);
    steps(run, 10);
    expect(run.rush!.time).toBeCloseTo(10 * DT, 9);
    expect(run.rush!.stageTime).toBeCloseTo(10 * DT, 9);
    skipIntro(run);
    steps(run, 100);
    expect(run.rush!.time).toBeCloseTo(run.time, 9);
    expect(run.rush!.stageTime).toBeCloseTo(run.time, 9);
  });

  it('stand still in the Special choice, in picks and after the end', () => {
    const run = createRun(1, 1, 0, { mode: 'bossRush' });
    steps(run, 50);
    expect(run.rush!.time).toBe(0);
    chooseSpecial(run, 'pulseBomb');
    takePicks(run);
    skipIntro(run);
    killBoss(run, 10);
    killBoss(run);
    const before = { ...run.rush! };
    expect(run.phase).toBe('upgradePick');
    steps(run, 100);
    expect(run.rush).toEqual(before);
    run.phase = 'lost';
    steps(run, 100);
    expect(run.rush).toEqual(before);
  });

  it('resets the stage clock when the next boss starts, while the total carries on', () => {
    const run = rush();
    takePicks(run);
    skipIntro(run);
    steps(run, 100);
    killBoss(run, 30);
    const total = run.rush!.time;
    pickUpgrade(run, 0);
    expect(run.rush!.stageTime).toBe(0);
    expect(run.rush!.time).toBe(total);
    steps(run, 12);
    expect(run.rush!.stageTime).toBeCloseTo(12 * DT, 9);
    expect(run.rush!.time).toBeCloseTo(total + 12 * DT, 9);
  });
});

describe('Boss Rush stages', () => {
  it('scores a time bonus for a boss beaten under par', () => {
    const run = rush();
    takePicks(run);
    skipIntro(run);
    const events = killBoss(run, 20);
    const stageTime = run.rush!.stageTime;
    const points = Math.round((RUSH_PAR_SECONDS.broodMother - stageTime) * RUSH_BONUS_PER_SECOND);
    expect(points).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === 'rushBonus')).toEqual([{ type: 'rushBonus', stage: 0, seconds: stageTime, points }]);
    expect(events.filter((e) => e.type === 'bossKilled')).toEqual([expect.objectContaining({ kind: 'broodMother', points: BOSS_POINTS.core })]);
    expect(run.score).toBe(BOSS_POINTS.core + points);
    expect(run.phase).toBe('upgradePick');
    expect(run.offer.length).toBeGreaterThan(0);
  });

  it('scores no bonus at or over par', () => {
    for (const stageTime of [RUSH_PAR_SECONDS.broodMother, RUSH_PAR_SECONDS.broodMother + 30]) {
      const run = rush();
      takePicks(run);
      skipIntro(run);
      const events = killBoss(run, stageTime - DT); // this step adds one more
      expect(events.some((e) => e.type === 'rushBonus')).toBe(false);
      expect(run.score).toBe(BOSS_POINTS.core);
    }
  });

  it('guarantees a rare in the pick after a boss, and counts bosses beaten', () => {
    const run = rush();
    takePicks(run);
    expect(rushBossesBeaten(run)).toBe(0);
    skipIntro(run);
    killBoss(run, 100);
    expect(run.phase).toBe('upgradePick');
    expect(run.offer.some((id) => upgradeDef(id).rarity === 'rare')).toBe(true);
    expect(rushBossesBeaten(run)).toBe(1);
    expect(run.rush!.stage).toBe(0); // advances when the pick is taken
  });

  it('goes to the Hive Mind with fresh bunkers and its sector banner, then the Hive Heart', () => {
    const run = rush();
    takePicks(run);
    skipIntro(run);
    // Wear the bunkers down: the next boss gets fresh ones.
    run.bunkers = run.bunkers.slice(0, 1);
    killBoss(run, 100);
    pickUpgrade(run, 0);
    expect(run.rush!.stage).toBe(1);
    expect(run.wave).toBe(9);
    expect(run.boss?.kind).toBe('hiveMind');
    expect(run.phase).toBe('waveIntro');
    expect(run.bunkers.length).toBeGreaterThan(1);
    expect(run.shots).toEqual([]);
    const intro = steps(run, 1);
    expect(intro).toContainEqual({ type: 'sectorStart', sector: 2 });
    expect(intro).toContainEqual({ type: 'waveStart', wave: 9 });
    skipIntro(run);
    run.bunkers = run.bunkers.slice(0, 1);
    killBoss(run, 100);
    expect(rushBossesBeaten(run)).toBe(2);
    pickUpgrade(run, 0);
    expect(run.rush!.stage).toBe(2);
    expect(run.wave).toBe(14);
    expect(run.boss?.kind).toBe('hiveHeart');
    expect(run.bunkers.length).toBeGreaterThan(1);
    expect(steps(run, 1)).toContainEqual({ type: 'sectorStart', sector: 3 });
  });

  it('is won after the last boss, with its bonus and a won event', () => {
    const run = rush();
    takePicks(run);
    for (let stage = 0; stage < 3; stage++) {
      skipIntro(run);
      expect(run.rush!.stage).toBe(stage);
      const events = killBoss(run, 10);
      expect(events.filter((e) => e.type === 'waveClear')).toHaveLength(1);
      if (stage < 2) {
        expect(run.phase).toBe('upgradePick');
        pickUpgrade(run, 0);
      } else {
        expect(run.phase).toBe('won');
        expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['bossKilled', 'waveClear', 'rushBonus', 'won']));
        expect(events.find((e) => e.type === 'rushBonus')).toMatchObject({ stage: 2 });
      }
    }
    expect(rushBossesBeaten(run)).toBe(3);
    expect(run.rush!.stage).toBe(2);
    expect(run.wave).toBe(WAVE_COUNT - 1);
  });

  it('advances to the next boss when the pick after a boss has nothing to offer', () => {
    const run = createRun(1, 1, 0, { mode: 'bossRush', upgrades: [] });
    chooseSpecial(run, 'pulseBomb');
    skipIntro(run);
    killBoss(run, 100);
    expect(run.phase).toBe('waveIntro');
    expect(run.rush!.stage).toBe(1);
    expect(run.wave).toBe(9);
  });

  it('keeps its state when the run is lost', () => {
    const run = rush();
    takePicks(run);
    skipIntro(run);
    killBoss(run, 100);
    pickUpgrade(run, 0);
    skipIntro(run);
    run.players[0].lives = 0;
    run.players[0].shield = 0;
    const events = steps(run, 1);
    expect(run.phase).toBe('lost');
    expect(events).toContainEqual({ type: 'lost', reason: 'lives' });
    expect(run.rush).toMatchObject({ stage: 1, picksLeft: 0 });
    expect(rushBossesBeaten(run)).toBe(1);
    expect(run.rush!.time).toBeGreaterThan(0);
  });

  it('carries lives and score between bosses', () => {
    const run = rush();
    takePicks(run);
    skipIntro(run);
    run.players[0].lives = 2;
    killBoss(run, 100);
    const score = run.score;
    pickUpgrade(run, 0);
    expect(run.players[0].lives).toBe(2);
    expect(run.score).toBe(score);
  });
});

describe('normal runs next to Boss Rush', () => {
  it('still announce sector changes and rebuild bunkers by wave order', () => {
    const run = createRun(1, 1, 4);
    chooseSpecial(run, 'pulseBomb');
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    run.bunkers = run.bunkers.slice(0, 1);
    pickUpgrade(run, 0);
    expect(run.wave).toBe(5);
    expect(run.bunkers.length).toBeGreaterThan(1);
    expect(steps(run, 1)).toContainEqual({ type: 'sectorStart', sector: 2 });
    expect(run.rush).toBeNull();
  });
});
