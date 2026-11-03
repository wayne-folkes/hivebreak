import { describe, expect, it } from 'vitest';
import { bossHealth } from '../game/boss';
import { WAVE_COUNT, chooseSpecial, createRun } from '../game/run';
import type { RunEvent, RunState } from '../game/types';
import { WAVES } from '../game/waves';
import { duckFor, musicState, stingerFor, waveProgress } from './director';

/** A real run in the given phase, at a wave (0-based). */
function runAt(wave: number, phase: RunState['phase'] = 'playing'): RunState {
  const run = createRun(1, 1, wave);
  chooseSpecial(run, 'pulseBomb');
  run.phase = phase;
  return run;
}

const BOSS_WAVES = WAVES.map((w, i) => (w.boss ? i : -1)).filter((i) => i >= 0);

describe('musicState: which track', () => {
  it('plays the title track on the title and the Special choice, whatever the run says', () => {
    const run = runAt(7);
    expect(musicState('title', run).track).toBe('title');
    expect(musicState('special', run).track).toBe('title');
  });

  it('plays the sector track by the wave, switching to sector 2 at wave 6 and sector 3 at wave 11', () => {
    for (let wave = 0; wave < WAVE_COUNT; wave++) {
      const def = WAVES[wave];
      const expected = def.boss === 'hiveHeart' ? 'heart' : def.boss ? 'boss' : def.sector === 1 ? 'sector1' : def.sector === 2 ? 'sector2' : 'sector3';
      expect(musicState('playing', runAt(wave)).track).toBe(expected);
    }
    expect(musicState('playing', runAt(4)).track).toBe('boss');
    expect(musicState('playing', runAt(5)).track).toBe('sector2');
    expect(musicState('playing', runAt(3)).track).toBe('sector1');
    expect(musicState('playing', runAt(9)).track).toBe('boss');
    expect(musicState('playing', runAt(10)).track).toBe('sector3');
    expect(musicState('playing', runAt(13)).track).toBe('sector3');
    expect(musicState('playing', runAt(14)).track).toBe('heart');
  });

  it('plays the boss track from the boss wave intro on', () => {
    for (const wave of BOSS_WAVES) {
      expect(musicState('playing', runAt(wave, 'waveIntro')).track).toBe(WAVES[wave].boss === 'hiveHeart' ? 'heart' : 'boss');
    }
  });

  it("plays the Hive Heart's own track on wave 15, and the shared boss theme on the other two bosses", () => {
    expect(WAVES[14].boss).toBe('hiveHeart');
    expect(musicState('playing', runAt(14)).track).toBe('heart');
    expect(musicState('playing', runAt(14, 'waveIntro')).track).toBe('heart');
    expect(musicState('playing', runAt(4)).track).toBe('boss');
    expect(musicState('playing', runAt(9)).track).toBe('boss');
  });

  it('keeps the run track through the upgrade pick, until the next wave starts', () => {
    expect(musicState('pick', runAt(2, 'upgradePick')).track).toBe('sector1');
    expect(musicState('pick', runAt(3, 'upgradePick')).track).toBe('sector1');
  });

  it('moves on to the next sector, calm, under the upgrade card once a boss is beaten', () => {
    const state = musicState('pick', runAt(4, 'upgradePick'));
    expect(state).toMatchObject({ track: 'sector2', intensity: 0, bossPhase: 1, danger: false });
  });

  it('is silent once the run is won or lost, and on the game-over card', () => {
    expect(musicState('playing', runAt(9, 'won')).track).toBeNull();
    expect(musicState('playing', runAt(2, 'lost')).track).toBeNull();
    expect(musicState('over', runAt(2, 'lost')).track).toBeNull();
    expect(musicState('over', runAt(9, 'won')).track).toBeNull();
  });
});

describe('musicState: Boss Rush', () => {
  /** A rush past the Special choice: on its starting picks (3 left) until `stage` and `picksLeft` are changed. */
  function rushRun(): RunState {
    const run = createRun(1, 1, 0, { mode: 'bossRush' });
    chooseSpecial(run, 'pulseBomb');
    return run;
  }

  /** The rush at the pick after the boss of `stage`. */
  function pickAfterBoss(stage: number): RunState {
    const run = rushRun();
    const rush = run.rush!;
    rush.picksLeft = 0;
    rush.stage = stage;
    run.wave = rush.stages[stage];
    run.phase = 'upgradePick';
    return run;
  }

  it('starts a rush on the starting picks, with the first boss', () => {
    const run = rushRun();
    expect(run.phase).toBe('upgradePick');
    expect(run.rush?.picksLeft).toBe(3);
    expect(run.wave).toBe(BOSS_WAVES[0]);
  });

  it('plays the title track on the ship and Special cards, as a normal run does', () => {
    expect(musicState('special', createRun(1, 1, 0, { mode: 'bossRush' })).track).toBe('title');
    expect(musicState('special', rushRun()).track).toBe('title');
  });

  it("plays the first boss's track, calm, under each of the starting picks", () => {
    const run = rushRun();
    for (const picksLeft of [3, 2, 1]) {
      run.rush!.picksLeft = picksLeft;
      expect(musicState('pick', run)).toMatchObject({ track: 'boss', intensity: 0, danger: false, bossPhase: 1, timeScale: 1 });
      // The pick opens a frame after the phase changes, while the mode is still `playing`.
      expect(musicState('playing', run).track).toBe('boss');
    }
  });

  it("plays the next boss's track, calm, under the pick after a boss", () => {
    expect(WAVES[BOSS_WAVES[2]].boss).toBe('hiveHeart');
    expect(musicState('pick', pickAfterBoss(0))).toMatchObject({ track: 'boss', intensity: 0, bossPhase: 1 });
    expect(musicState('pick', pickAfterBoss(1))).toMatchObject({ track: 'heart', intensity: 0, bossPhase: 1 });
  });

  it('does not use the normal rule for the sector after a boss (every rush wave is a boss wave)', () => {
    // Normal runs go from the Brood Mother (wave 5) to the sector 2 track; a rush goes to the next boss.
    expect(musicState('pick', runAt(4, 'upgradePick')).track).toBe('sector2');
    expect(musicState('pick', pickAfterBoss(0)).track).not.toBe('sector2');
  });

  it("plays each boss's own track in its fight, with the usual intensity", () => {
    const run = rushRun();
    run.rush!.picksLeft = 0;
    run.phase = 'playing';
    for (const [stage, track] of [[0, 'boss'], [1, 'boss'], [2, 'heart']] as const) {
      run.rush!.stage = stage;
      run.wave = run.rush!.stages[stage];
      expect(musicState('playing', run).track).toBe(track);
    }
  });

  it('is silent once the rush is won or lost', () => {
    const run = pickAfterBoss(2);
    run.phase = 'won';
    expect(musicState('playing', run).track).toBeNull();
    expect(musicState('over', run).track).toBeNull();
    run.phase = 'lost';
    expect(musicState('playing', run).track).toBeNull();
  });
});

describe('musicState: intensity', () => {
  it('is 0 during the wave intro and the title', () => {
    const run = runAt(2, 'waveIntro');
    run.aliens.splice(0, 5);
    expect(musicState('playing', run).intensity).toBe(0);
    expect(musicState('title', runAt(2)).intensity).toBe(0);
  });

  it('is the fraction of the formation destroyed', () => {
    const run = runAt(0);
    expect(waveProgress(run)).toBe(0);
    const total = run.aliens.length;
    run.aliens.splice(0, total / 4);
    expect(musicState('playing', run).intensity).toBeCloseTo(0.25);
    run.aliens.splice(0, total / 4);
    expect(musicState('playing', run).intensity).toBeCloseTo(0.5);
    run.aliens.length = 0;
    expect(musicState('playing', run).intensity).toBe(1);
  });

  it('does not count free aliens (minis, Drones) as part of the formation', () => {
    const run = runAt(5);
    const total = run.aliens.length;
    run.aliens.splice(0, total / 2);
    const half = waveProgress(run);
    run.aliens.push({ ...run.aliens[0], id: 900, kind: 'mini', mode: 'free', col: -1, row: -1 });
    expect(waveProgress(run)).toBe(half);
  });

  it('on a boss wave follows the boss health the way its bar does', () => {
    const run = runAt(4);
    expect(waveProgress(run)).toBe(0);
    for (const p of run.boss!.parts) if (p.kind === 'plate') p.hp = 0;
    const lost = 1 - bossHealth(run.boss!);
    expect(lost).toBeGreaterThan(0);
    expect(musicState('playing', run).intensity).toBeCloseTo(lost);
    for (const p of run.boss!.parts) p.hp = 0;
    expect(musicState('playing', run).intensity).toBe(1);
  });

  it('on the Hive Mind follows its core', () => {
    const run = runAt(9);
    expect(waveProgress(run)).toBe(0);
    const core = run.boss!.parts.find((p) => p.kind === 'core')!;
    core.hp = core.maxHp / 2;
    expect(musicState('playing', run).intensity).toBeCloseTo(1 - bossHealth(run.boss!));
    expect(musicState('playing', run).intensity).toBeGreaterThan(0);
  });

  it('is full once the wave is clear', () => {
    const run = runAt(1, 'upgradePick');
    run.aliens.length = 0;
    expect(musicState('pick', run).intensity).toBe(1);
  });
});

describe('musicState: danger, boss phase and time scale', () => {
  it('is danger on the last life only', () => {
    const run = runAt(1);
    run.players[0].lives = 3;
    expect(musicState('playing', run).danger).toBe(false);
    run.players[0].lives = 2;
    expect(musicState('playing', run).danger).toBe(false);
    run.players[0].lives = 1;
    expect(musicState('playing', run).danger).toBe(true);
    run.players[0].lives = 0;
    expect(musicState('playing', run).danger).toBe(false);
  });

  it('has no danger behind the title, even if the demo is on its last life', () => {
    const run = runAt(1);
    run.players[0].lives = 1;
    expect(musicState('title', run).danger).toBe(false);
  });

  it('follows the boss phase, and is 1 with no boss', () => {
    const run = runAt(9);
    expect(musicState('playing', run).bossPhase).toBe(1);
    run.boss!.phase = 3;
    expect(musicState('playing', run).bossPhase).toBe(3);
    expect(musicState('playing', runAt(2)).bossPhase).toBe(1);
  });

  it('slows to a quarter under Time Stop and a half under Slow, Time Stop winning', () => {
    const run = runAt(1);
    expect(musicState('playing', run).timeScale).toBe(1);
    run.slow = 4;
    expect(musicState('playing', run).timeScale).toBe(0.5);
    run.freeze = 1;
    expect(musicState('playing', run).timeScale).toBe(0.25);
    run.freeze = 0;
    run.slow = 0;
    expect(musicState('playing', run).timeScale).toBe(1);
  });

  it('slows during the wave intro too, but not once the wave is clear', () => {
    const run = runAt(1, 'waveIntro');
    run.slow = 2;
    expect(musicState('playing', run).timeScale).toBe(0.5);
    run.phase = 'upgradePick';
    run.freeze = 1;
    expect(musicState('pick', run).timeScale).toBe(1);
  });
});

describe('stingerFor', () => {
  it('maps the events that have a stinger', () => {
    expect(stingerFor({ type: 'waveClear', wave: 0 })).toBe('waveClear');
    expect(stingerFor({ type: 'waveClear', wave: WAVE_COUNT - 2 })).toBe('waveClear');
    expect(stingerFor({ type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' })).toBe('upgrade');
    expect(stingerFor({ type: 'won' })).toBe('victory');
    expect(stingerFor({ type: 'lost', reason: 'lives' })).toBe('gameOver');
    expect(stingerFor({ type: 'lost', reason: 'invaded' })).toBe('gameOver');
  });

  it('skips the wave-clear stinger on the final wave, where the victory follows', () => {
    expect(stingerFor({ type: 'waveClear', wave: WAVE_COUNT - 1 })).toBeNull();
  });

  it('has none for other events', () => {
    const others: RunEvent[] = [
      { type: 'waveStart', wave: 0 },
      { type: 'playerHit', playerId: 0, livesLeft: 1 },
      { type: 'bossKilled', kind: 'broodMother', x: 0, y: 0, points: 1 },
      { type: 'bossPhase', phase: 2 },
    ];
    for (const e of others) expect(stingerFor(e)).toBeNull();
  });
});

describe('duckFor', () => {
  it('ducks hardest and longest for a boss kill, then a Special, then a hit', () => {
    const boss = duckFor({ type: 'bossKilled', kind: 'hiveMind', x: 0, y: 0, points: 1 })!;
    const special = duckFor({ type: 'specialFired', playerId: 0, special: 'timeStop', x: 0, y: 0 })!;
    const hit = duckFor({ type: 'playerHit', playerId: 0, livesLeft: 1 })!;
    expect(boss).toEqual({ seconds: 2, depth: 0.8 });
    expect(special).toEqual({ seconds: 1, depth: 0.5 });
    expect(hit).toEqual({ seconds: 0.6, depth: 0.4 });
    expect(boss.depth).toBeGreaterThan(special.depth);
    expect(special.depth).toBeGreaterThan(hit.depth);
  });

  it('has none for other events', () => {
    expect(duckFor({ type: 'shieldHit', playerId: 0 })).toBeNull();
    expect(duckFor({ type: 'waveClear', wave: 0 })).toBeNull();
    expect(duckFor({ type: 'won' })).toBeNull();
  });
});
