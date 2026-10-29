import { describe, expect, it } from 'vitest';
import { WAVE_COUNT, WAVE_INTRO_SECONDS, createRun, pickUpgrade, stepRun } from './run';
import { SHIP_TOP, SHIP_Y, SHIP_X_LIMIT } from './player';
import { WAVES, waveAlienCount } from './waves';
import { marchSpeed } from './formation';
import { BASE_STATS } from './player';
import type { Alien, Shot } from './types';
import { NO_INPUT } from './types';
import type { RunEvent, RunState, ShipInput } from './types';

const DT = 1 / 120;
const IDLE: readonly ShipInput[] = [NO_INPUT];
const HOLD_FIRE: readonly ShipInput[] = [{ move: 0, drag: 0, fire: true }];

function steps(run: RunState, n: number, inputs: readonly ShipInput[] = IDLE): RunEvent[] {
  const events: RunEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepRun(run, inputs, DT));
  return events;
}

/** Skips the wave intro. */
function startPlaying(run: RunState) {
  steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
  expect(run.phase).toBe('playing');
}

/** Puts the ship where a shot fired now will meet the alien, allowing for the formation's march. */
function aimAt(run: RunState, alien: Alien) {
  const flight = (alien.y - SHIP_TOP) / BASE_STATS.shotSpeed;
  const lead = run.formation.dir * marchSpeed(WAVES[run.wave], run.formation, run.aliens.length) * flight;
  run.players[0].x = Math.max(-SHIP_X_LIMIT, Math.min(SHIP_X_LIMIT, alien.x + lead));
}

/** Moves under the nearest alien and holds fire. */
function botInput(run: RunState): ShipInput {
  const ship = run.players[0];
  let target: number | null = null;
  for (const a of run.aliens) {
    if (target === null || Math.abs(a.x - ship.x) < Math.abs(target - ship.x)) target = a.x;
  }
  const move = target === null ? 0 : Math.max(-1, Math.min(1, (target - ship.x) / 6));
  return { move, drag: 0, fire: true };
}

/** Plays a whole run with the bot. Returns the run and how many steps it took. */
function playWithBot(seed: number, lives: number, maxSteps: number) {
  const run = createRun(seed);
  run.players[0].lives = lives;
  const events: RunEvent[] = [];
  let n = 0;
  while (run.phase !== 'won' && run.phase !== 'lost' && n < maxSteps) {
    if (run.phase === 'upgradePick') events.push(...pickUpgrade(run, 0));
    events.push(...stepRun(run, [botInput(run)], DT));
    n++;
  }
  return { run, steps: n, events };
}

describe('createRun', () => {
  it('starts at wave 0 in the intro with a full formation', () => {
    const run = createRun(1);
    expect(run.phase).toBe('waveIntro');
    expect(run.wave).toBe(0);
    expect(run.aliens).toHaveLength(waveAlienCount(WAVES[0]));
    expect(run.players).toHaveLength(1);
    expect(run.combo).toBe(1);
    expect(run.score).toBe(0);
  });

  it('can start more than one player', () => {
    const run = createRun(1, 2);
    expect(run.players.map((p) => p.id)).toEqual([0, 1]);
    expect(run.players[0].x).toBeLessThan(run.players[1].x);
  });
});

describe('phases', () => {
  it('moves from the intro to playing after WAVE_INTRO_SECONDS, with aliens still until then', () => {
    const run = createRun(1);
    const y0 = run.aliens[0].y;
    steps(run, Math.floor(WAVE_INTRO_SECONDS / DT) - 2);
    expect(run.phase).toBe('waveIntro');
    expect(run.aliens[0].y).toBe(y0);
    steps(run, 4);
    expect(run.phase).toBe('playing');
  });

  it('announces each wave with one waveStart on the first step of its intro, including wave 0', () => {
    const run = createRun(1);
    expect(steps(run, 1)).toContainEqual({ type: 'waveStart', wave: 0 });
    const rest = steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 10);
    expect(rest.filter((e) => e.type === 'waveStart')).toEqual([]);
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    pickUpgrade(run, 0);
    const events = steps(run, 3);
    expect(events.filter((e) => e.type === 'waveStart')).toEqual([{ type: 'waveStart', wave: 1 }]);
  });

  it('does not fire during the intro', () => {
    const run = createRun(1);
    steps(run, 30, HOLD_FIRE);
    expect(run.shots).toHaveLength(0);
  });

  it('only advances the phase clock in upgradePick, won and lost', () => {
    for (const phase of ['upgradePick', 'won', 'lost'] as const) {
      const run = createRun(1);
      run.phase = phase;
      run.offer = ['twinShot', 'rapidFire', 'extraLife'];
      const before = JSON.stringify({ ...run, phaseTime: 0, rng: null });
      const events = steps(run, 50, HOLD_FIRE);
      expect(events).toEqual([]);
      expect(run.phaseTime).toBeCloseTo(50 * DT, 6);
      expect(JSON.stringify({ ...run, phaseTime: 0, rng: null })).toBe(before);
    }
  });
});

describe('playing', () => {
  it('fires shots upward and reports it', () => {
    const run = createRun(1);
    startPlaying(run);
    const events = steps(run, 3, HOLD_FIRE);
    expect(events.some((e) => e.type === 'playerFired')).toBe(true);
    expect(run.shots.some((s) => s.owner === 'player' && s.vy > 0)).toBe(true);
  });

  it('kills an alien with a shot and scores it', () => {
    const run = createRun(1);
    startPlaying(run);
    // Stand under a bottom-row alien and shoot until something dies.
    const target = run.aliens.filter((a) => a.row === 2)[0];
    let kills = 0;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && kills === 0; i++) {
      aimAt(run, target);
      const stepEvents = stepRun(run, HOLD_FIRE, DT);
      events.push(...stepEvents);
      kills += stepEvents.filter((e) => e.type === 'alienKilled').length;
    }
    expect(kills).toBeGreaterThan(0);
    expect(events).toContainEqual(expect.objectContaining({ type: 'alienKilled', points: 10, combo: 1 }));
    expect(run.score).toBe(10); // a drone at the starting combo of x1
    expect(run.combo).toBeGreaterThan(1);
  });

  it('lets a piercing shot kill two aliens in a column, and one without piercing only one', () => {
    for (const pierce of [0, 1]) {
      const run = createRun(1);
      startPlaying(run);
      run.aliens = run.aliens.filter((a) => a.col === 1 && a.row >= 1);
      expect(run.aliens).toHaveLength(2);
      run.players[0].stats.pierce = pierce;
      const lower = run.aliens.find((a) => a.row === 2)!;
      let kills = 0;
      for (let i = 0; i < 40 && kills < 2; i++) {
        aimAt(run, lower);
        kills += stepRun(run, i === 0 ? HOLD_FIRE : IDLE, DT).filter((e) => e.type === 'alienKilled').length;
      }
      for (let i = 0; i < 120; i++) {
        aimAt(run, lower);
        kills += stepRun(run, IDLE, DT).filter((e) => e.type === 'alienKilled').length;
      }
      expect(kills).toBe(pierce === 0 ? 1 : 2);
    }
  });

  it('keeps the combo when one shot of a twin-shot volley hits and its sibling misses', () => {
    const run = createRun(1);
    startPlaying(run);
    // Two aliens stay so the wave doesn't clear; one shot flies at the first, its sibling at nothing.
    const target = run.aliens.find((a) => a.row === 2 && a.col === 0)!;
    run.aliens = [target, run.aliens.find((a) => a.row === 0 && a.col === 3)!];
    run.combo = 3;
    const shot = (id: number, x: number): Shot => ({
      id, owner: 'player', playerId: 0, x, y: SHIP_TOP, vx: 0, vy: 260, pierceLeft: 0, hits: 0, volley: 500,
    });
    aimAt(run, target); // puts the ship where a shot will meet the marching alien
    run.shots.push(shot(501, run.players[0].x), shot(502, SHIP_X_LIMIT));
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && run.shots.length > 0; i++) events.push(...stepRun(run, IDLE, DT));
    expect(events.filter((e) => e.type === 'alienKilled')).toHaveLength(1);
    expect(events.some((e) => e.type === 'comboBroken')).toBe(false);
    expect(run.combo).toBe(4);
  });

  it('breaks the combo when every shot of a twin-shot volley misses', () => {
    const run = createRun(1);
    startPlaying(run);
    run.players[0].stats.shotsPerVolley = 2;
    run.combo = 3;
    run.players[0].x = SHIP_X_LIMIT;
    const events = [...steps(run, 3, HOLD_FIRE), ...steps(run, Math.ceil(1.3 / DT))];
    expect(events.filter((e) => e.type === 'comboBroken')).toEqual([{ type: 'comboBroken', combo: 3 }]);
  });

  it('breaks the combo when a shot flies off without hitting anything', () => {
    const run = createRun(1);
    startPlaying(run);
    run.combo = 3;
    run.players[0].x = SHIP_X_LIMIT; // the wave 1 formation is nowhere near the edge at the start
    const events = steps(run, 3, HOLD_FIRE);
    expect(events.some((e) => e.type === 'comboBroken')).toBe(false);
    const later = steps(run, Math.ceil(1.3 / DT), IDLE);
    expect(later).toContainEqual({ type: 'comboBroken', combo: 3 });
    expect(run.combo).toBe(1);
  });

  it('lets a shield absorb a hit before a life is lost', () => {
    const run = createRun(1);
    startPlaying(run);
    run.players[0].shield = 1;
    run.shots.push({ id: 999, owner: 'alien', playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const first = steps(run, 1);
    expect(first).toContainEqual({ type: 'shieldHit', playerId: 0 });
    expect(run.players[0].lives).toBe(3);
    expect(run.players[0].shield).toBe(0);

    steps(run, Math.ceil(0.6 / DT)); // past the short safe moment
    run.shots.push({ id: 1000, owner: 'alien', playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const second = steps(run, 1);
    expect(second).toContainEqual({ type: 'playerHit', playerId: 0, livesLeft: 2 });
  });

  it('gives a safe moment after a hit', () => {
    const run = createRun(1);
    startPlaying(run);
    const shot = () => ({ id: run.nextId++, owner: 'alien' as const, playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    run.shots.push(shot());
    steps(run, 1);
    run.shots.push(shot());
    steps(run, 1);
    expect(run.players[0].lives).toBe(2);
  });

  it('loses when the last life goes', () => {
    const run = createRun(1);
    startPlaying(run);
    run.players[0].lives = 1;
    run.shots.push({ id: 999, owner: 'alien', playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const events = steps(run, 1);
    expect(events).toContainEqual({ type: 'lost', reason: 'lives' });
    expect(run.phase).toBe('lost');
  });

  it('loses when the formation reaches the ship', () => {
    const run = createRun(1);
    startPlaying(run);
    run.formation.offsetY = -250;
    const events = steps(run, 1);
    expect(events).toContainEqual({ type: 'lost', reason: 'invaded' });
    expect(run.phase).toBe('lost');
  });

  it('crashes a diver into the ship: the ship is hit and the diver is gone', () => {
    const run = createRun(1);
    startPlaying(run);
    const diver = run.aliens[0];
    diver.kind = 'diver';
    diver.mode = 'diving';
    diver.x = run.players[0].x;
    diver.y = SHIP_Y;
    diver.dive = { fromX: diver.x, fromY: diver.y, toX: diver.x };
    diver.modeTime = 0.1;
    const events = steps(run, 1);
    expect(events.some((e) => e.type === 'playerHit')).toBe(true);
    expect(run.aliens.find((a) => a.id === diver.id)).toBeUndefined();
  });

  it('clears the wave and offers upgrades when the last alien dies', () => {
    const run = createRun(1);
    startPlaying(run);
    run.aliens = run.aliens.slice(0, 1);
    const a = run.aliens[0];
    const events: RunEvent[] = [];
    for (let i = 0; i < 400 && run.phase === 'playing'; i++) {
      aimAt(run, a);
      events.push(...stepRun(run, HOLD_FIRE, DT));
    }
    expect(events).toContainEqual({ type: 'waveClear', wave: 0 });
    expect(run.phase).toBe('upgradePick');
    expect(run.offer).toHaveLength(3);
    expect(run.shots).toHaveLength(0);
  });
});

describe('pickUpgrade', () => {
  it('does nothing outside the upgrade pick', () => {
    const run = createRun(1);
    expect(pickUpgrade(run, 0)).toEqual([]);
    startPlaying(run);
    expect(pickUpgrade(run, 0)).toEqual([]);
    expect(run.wave).toBe(0);
    expect(run.players[0].upgrades).toEqual([]);
  });

  it('applies the choice, clears the offer and starts the next wave intro', () => {
    const run = createRun(1);
    run.phase = 'upgradePick';
    run.offer = ['extraLife', 'twinShot', 'rapidFire'];
    const events = pickUpgrade(run, 1);
    expect(events).toEqual([{ type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' }]);
    expect(run.players[0].stats.shotsPerVolley).toBe(2);
    expect(run.offer).toEqual([]);
    expect(run.wave).toBe(1);
    expect(run.phase).toBe('waveIntro');
    expect(run.aliens).toHaveLength(waveAlienCount(WAVES[1]));
  });

  it('ignores a choice that is not on offer', () => {
    const run = createRun(1);
    run.phase = 'upgradePick';
    run.offer = ['extraLife', 'twinShot', 'rapidFire'];
    expect(pickUpgrade(run, 3)).toEqual([]);
    expect(pickUpgrade(run, -1)).toEqual([]);
    expect(run.phase).toBe('upgradePick');
  });

  it('refills the shield at the start of the next wave', () => {
    const run = createRun(1);
    run.players[0].stats.shieldPerWave = 1;
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    pickUpgrade(run, 0);
    expect(run.players[0].shield).toBe(1);
  });
});

describe('a whole run', () => {
  it('is won by a bot that tracks the nearest alien, holds fire and takes the first upgrade', () => {
    const { run, steps: n, events } = playWithBot(1, 99, 120 * 60 * 10);
    expect(run.phase).toBe('won');
    expect(run.wave).toBe(WAVE_COUNT - 1);
    expect(events.filter((e) => e.type === 'waveClear')).toHaveLength(WAVE_COUNT);
    expect(events.filter((e) => e.type === 'upgradePicked')).toHaveLength(WAVE_COUNT - 1);
    expect(n).toBeLessThan(120 * 60 * 10);
    expect(run.score).toBeGreaterThan(0);
  });

  it('is won on several seeds', () => {
    for (const seed of [2, 3, 4, 5]) {
      expect(playWithBot(seed, 99, 120 * 60 * 10).run.phase).toBe('won');
    }
  });

  it('gives the same score for the same seed and inputs', () => {
    const a = playWithBot(7, 99, 120 * 60 * 10);
    const b = playWithBot(7, 99, 120 * 60 * 10);
    expect(a.run.score).toBe(b.run.score);
    expect(a.steps).toBe(b.steps);
  });

  it('plays differently with a different seed', () => {
    const a = playWithBot(7, 99, 120 * 60 * 10);
    const b = playWithBot(8, 99, 120 * 60 * 10);
    expect(a.steps === b.steps && a.run.score === b.run.score).toBe(false);
  });

  it('can be lost: a ship that never fights back runs out of lives or gets invaded', () => {
    const run = createRun(3);
    let n = 0;
    while (run.phase !== 'lost' && n < 120 * 60 * 10) {
      stepRun(run, IDLE, DT);
      n++;
    }
    expect(run.phase).toBe('lost');
  });
});
