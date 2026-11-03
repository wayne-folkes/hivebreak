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
      const expected = def.boss ? 'boss' : def.sector === 1 ? 'sector1' : def.sector === 2 ? 'sector2' : 'sector3';
      expect(musicState('playing', runAt(wave)).track).toBe(expected);
    }
    expect(musicState('playing', runAt(4)).track).toBe('boss');
    expect(musicState('playing', runAt(5)).track).toBe('sector2');
    expect(musicState('playing', runAt(3)).track).toBe('sector1');
    expect(musicState('playing', runAt(9)).track).toBe('boss');
    expect(musicState('playing', runAt(10)).track).toBe('sector3');
    expect(musicState('playing', runAt(13)).track).toBe('sector3');
  });

  it('plays the boss track from the boss wave intro on', () => {
    for (const wave of BOSS_WAVES) {
      expect(musicState('playing', runAt(wave, 'waveIntro')).track).toBe('boss');
    }
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
