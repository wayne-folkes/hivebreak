import { describe, expect, it } from 'vitest';
import { WAVE_COUNT, WAVE_INTRO_SECONDS, chooseSpecial, createRun, pickUpgrade, stepRun } from './run';
import { SHIP_TOP, SHIP_Y, SHIP_X_LIMIT } from './player';
import { WAVES, waveAlienCount } from './waves';
import { marchSpeed } from './formation';
import { BASE_STATS } from './player';
import type { Alien, Shot } from './types';
import { VOLLEY_HIT } from './types';
import { FIELD_WIDTH } from './playfield';
import { NO_INPUT } from './types';
import { botInput, botPick } from './bot';
import { BOSS_POINTS, BOSS_Y, bossEntering } from './boss';
import { BUNKER_BOTTOM_Y, BUNKER_HEIGHT, bunkerSolidCount, erodeColumn } from './bunkers';
import { upgradeDef } from './upgrades';
import { SPLIT_APART_SECONDS, SPLIT_JOINED_SECONDS } from './formation';
import { activatePowerUp, POWER_UP_SECONDS } from './powerups';
import { PULSE_ALIEN_DAMAGE, PULSE_BOSS_DAMAGE, TIME_STOP_SECONDS, CHARGE_PER_BOSS_PART, killCharge } from './special';
import { FIELD_HEIGHT } from './playfield';
import { ALIEN_SHOT_SPEED } from './run';
import { BOSS_SHOT_SPEED } from './boss';
import type { RunEvent, RunState, ShipInput, SpecialId } from './types';

const DT = 1 / 120;

/** A new run with the Special chosen, in wave 0's intro. */
function startedRun(seed: number, special: SpecialId = 'pulseBomb', players = 1, bunkers = false): RunState {
  const run = createRun(seed, players);
  for (let i = 0; i < players; i++) chooseSpecial(run, special, i);
  // Most tests want a clear field; the bunker tests ask for the real ones.
  if (!bunkers) run.bunkers = [];
  return run;
}
const IDLE: readonly ShipInput[] = [NO_INPUT];
const HOLD_FIRE: readonly ShipInput[] = [{ move: 0, drag: 0, fire: true, special: false }];

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

/** Plays a whole run with the bot. Returns the run and how many steps it took. */
function playWithBot(seed: number, lives: number, maxSteps: number) {
  const run = startedRun(seed, 'pulseBomb', 1, true);
  run.players[0].lives = lives;
  const events: RunEvent[] = [];
  let n = 0;
  while (run.phase !== 'won' && run.phase !== 'lost' && n < maxSteps) {
    if (run.phase === 'upgradePick') events.push(...pickUpgrade(run, botPick(run.offer)));
    events.push(...stepRun(run, [botInput(run)], DT));
    n++;
  }
  return { run, steps: n, events };
}

describe('createRun', () => {
  it('starts at wave 0 in the Special choice with a full formation', () => {
    const run = createRun(1);
    expect(run.phase).toBe('chooseSpecial');
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
    const run = startedRun(1);
    const y0 = run.aliens[0].y;
    steps(run, Math.floor(WAVE_INTRO_SECONDS / DT) - 2);
    expect(run.phase).toBe('waveIntro');
    expect(run.aliens[0].y).toBe(y0);
    steps(run, 4);
    expect(run.phase).toBe('playing');
  });

  it('announces each wave with one waveStart on the first step of its intro, including wave 0', () => {
    const run = startedRun(1);
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
    const run = startedRun(1);
    steps(run, 30, HOLD_FIRE);
    expect(run.shots).toHaveLength(0);
  });

  it('only advances the phase clock in chooseSpecial, upgradePick, won and lost', () => {
    for (const phase of ['chooseSpecial', 'upgradePick', 'won', 'lost'] as const) {
      const run = startedRun(1);
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
    const run = startedRun(1);
    startPlaying(run);
    const events = steps(run, 3, HOLD_FIRE);
    expect(events.some((e) => e.type === 'playerFired')).toBe(true);
    expect(run.shots.some((s) => s.owner === 'player' && s.vy > 0)).toBe(true);
  });

  it('kills an alien with a shot and scores it', () => {
    const run = startedRun(1);
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
      const run = startedRun(1);
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
    const run = startedRun(1);
    startPlaying(run);
    // Two aliens stay so the wave doesn't clear; one shot flies at the first, its sibling at nothing.
    const target = run.aliens.find((a) => a.row === 2 && a.col === 0)!;
    run.aliens = [target, run.aliens.find((a) => a.row === 0 && a.col === 3)!];
    run.combo = 3;
    const shot = (id: number, x: number): Shot => ({
      id, owner: 'player', kind: 'normal', damage: 1, homing: 0, bouncesLeft: 0, playerId: 0, x, y: SHIP_TOP, vx: 0, vy: 260, pierceLeft: 0, hits: 0, volley: 500,
    });
    aimAt(run, target); // puts the ship where a shot will meet the marching alien
    run.shots.push(shot(501, run.players[0].x), shot(502, -SHIP_X_LIMIT));
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && run.shots.length > 0; i++) events.push(...stepRun(run, IDLE, DT));
    expect(events.filter((e) => e.type === 'alienKilled')).toHaveLength(1);
    expect(events.some((e) => e.type === 'comboBroken')).toBe(false);
    expect(run.combo).toBe(4);
  });

  it('breaks the combo when every shot of a twin-shot volley misses', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.players[0].stats.shotsPerVolley = 2;
    run.combo = 3;
    run.players[0].x = SHIP_X_LIMIT;
    const events = [...steps(run, 3, HOLD_FIRE), ...steps(run, Math.ceil(1.3 / DT))];
    expect(events.filter((e) => e.type === 'comboBroken')).toEqual([{ type: 'comboBroken', combo: 3 }]);
  });

  it('breaks the combo when a shot flies off without hitting anything', () => {
    const run = startedRun(1);
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
    const run = startedRun(1);
    startPlaying(run);
    run.players[0].shield = 1;
    run.shots.push({ id: 999, owner: 'alien', kind: 'enemy' as const, damage: 1, homing: 0, bouncesLeft: 0, playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const first = steps(run, 1);
    expect(first).toContainEqual({ type: 'shieldHit', playerId: 0 });
    expect(run.players[0].lives).toBe(3);
    expect(run.players[0].shield).toBe(0);

    steps(run, Math.ceil(0.6 / DT)); // past the short safe moment
    run.shots.push({ id: 1000, owner: 'alien', kind: 'enemy' as const, damage: 1, homing: 0, bouncesLeft: 0, playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const second = steps(run, 1);
    expect(second).toContainEqual({ type: 'playerHit', playerId: 0, livesLeft: 2 });
  });

  it('gives a safe moment after a hit', () => {
    const run = startedRun(1);
    startPlaying(run);
    const shot = () => ({ id: run.nextId++, owner: 'alien' as const, kind: 'enemy' as const, damage: 1, homing: 0, bouncesLeft: 0, playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    run.shots.push(shot());
    steps(run, 1);
    run.shots.push(shot());
    steps(run, 1);
    expect(run.players[0].lives).toBe(2);
  });

  it('loses when the last life goes', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.players[0].lives = 1;
    run.shots.push({ id: 999, owner: 'alien', kind: 'enemy' as const, damage: 1, homing: 0, bouncesLeft: 0, playerId: null, x: run.players[0].x, y: SHIP_Y + 2, vx: 0, vy: -90, pierceLeft: 0, hits: 0, volley: 0 });
    const events = steps(run, 1);
    expect(events).toContainEqual({ type: 'lost', reason: 'lives' });
    expect(run.phase).toBe('lost');
  });

  it('loses when the formation reaches the ship', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.formation.offsetY = -250;
    const events = steps(run, 1);
    expect(events).toContainEqual({ type: 'lost', reason: 'invaded' });
    expect(run.phase).toBe('lost');
  });

  it('crashes a diver into the ship: the ship is hit and the diver is gone', () => {
    const run = startedRun(1);
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
    const run = startedRun(1);
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
    const run = startedRun(1);
    expect(pickUpgrade(run, 0)).toEqual([]);
    startPlaying(run);
    expect(pickUpgrade(run, 0)).toEqual([]);
    expect(run.wave).toBe(0);
    expect(run.players[0].upgrades).toEqual([]);
  });

  it('applies the choice, clears the offer and starts the next wave intro', () => {
    const run = startedRun(1);
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
    const run = startedRun(1);
    run.phase = 'upgradePick';
    run.offer = ['extraLife', 'twinShot', 'rapidFire'];
    expect(pickUpgrade(run, 3)).toEqual([]);
    expect(pickUpgrade(run, -1)).toEqual([]);
    expect(run.phase).toBe('upgradePick');
  });

  it('refills the shield at the start of the next wave', () => {
    const run = startedRun(1);
    run.players[0].stats.shieldPerWave = 1;
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    pickUpgrade(run, 0);
    expect(run.players[0].shield).toBe(1);
  });
});

describe('a whole run', () => {
  it('is won by a bot with spare lives: it clears all ten waves and defeats both bosses', () => {
    const { run, steps: n, events } = playWithBot(1, 99, 120 * 60 * 10);
    expect(run.phase).toBe('won');
    expect(run.wave).toBe(WAVE_COUNT - 1);
    expect(events.filter((e) => e.type === 'waveClear')).toHaveLength(WAVE_COUNT);
    expect(events.filter((e) => e.type === 'upgradePicked')).toHaveLength(WAVE_COUNT - 1);
    expect(events.filter((e) => e.type === 'bossKilled')).toEqual([
      expect.objectContaining({ kind: 'broodMother', points: BOSS_POINTS.core }),
      expect.objectContaining({ kind: 'hiveMind', points: BOSS_POINTS.core }),
    ]);
    expect(events.filter((e) => e.type === 'bossPartDestroyed' && e.part === 'plate')).toHaveLength(4);
    expect(events.filter((e) => e.type === 'sectorStart')).toEqual([
      { type: 'sectorStart', sector: 1 },
      { type: 'sectorStart', sector: 2 },
    ]);
    expect(events.filter((e) => e.type === 'bossPhase')).toEqual([2, 2, 3].map((phase) => ({ type: 'bossPhase', phase })));
    expect(run.aliens.filter((a) => a.mode === 'free')).toEqual([]);
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
    const run = startedRun(3);
    let n = 0;
    while (run.phase !== 'lost' && n < 120 * 60 * 10) {
      stepRun(run, IDLE, DT);
      n++;
    }
    expect(run.phase).toBe('lost');
  });
});


// Helpers for the 2a features ---------------------------------------------------------------------

const PRESS_SPECIAL: readonly ShipInput[] = [{ move: 0, drag: 0, fire: false, special: true }];
const has = (events: readonly RunEvent[], type: RunEvent['type']) => events.some((e) => e.type === type);
const ofType = <T extends RunEvent['type']>(events: readonly RunEvent[], type: T) =>
  events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

const playerShot = (id: number, x: number, y: number, over: Partial<Shot> = {}): Shot => ({
  id, owner: 'player', kind: 'normal', playerId: 0, x, y, vx: 0, vy: 260, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: id, ...over,
});
const enemyShot = (id: number, x: number, y: number, over: Partial<Shot> = {}): Shot => ({
  id, owner: 'alien', kind: 'enemy', playerId: null, x, y, vx: 0, vy: -90, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: id, ...over,
});

/** A run in wave 0, playing, with a full Special meter. */
function readyRun(special: SpecialId): RunState {
  const run = startedRun(1, special);
  startPlaying(run);
  run.players[0].specialCharge = 1;
  return run;
}

/** A run in the Brood Mother fight, playing, with the boss landed. */
function bossFight(special: SpecialId = 'pulseBomb'): RunState {
  const run = startedRun(1, special);
  run.phase = 'upgradePick';
  run.offer = ['extraLife'];
  run.wave = 3;
  pickUpgrade(run, 0);
  run.bunkers = [];
  startPlaying(run);
  for (let i = 0; i < 100 && bossEntering(run.boss!); i++) steps(run, 1);
  expect(bossEntering(run.boss!)).toBe(false);
  return run;
}

describe('chooseSpecial', () => {
  it('waits in the choice, ignoring the clock, until a Special is chosen', () => {
    const run = createRun(1);
    expect(run.phase).toBe('chooseSpecial');
    expect(run.players[0].special).toBeNull();
    expect(steps(run, 10, HOLD_FIRE)).toEqual([]);
    expect(run.phase).toBe('chooseSpecial');
  });

  it('sets the Special, announces it and starts wave 0 intro', () => {
    const run = createRun(1);
    const events = chooseSpecial(run, 'timeStop');
    expect(events).toEqual([{ type: 'specialChosen', playerId: 0, special: 'timeStop' }]);
    expect(run.players[0].special).toBe('timeStop');
    expect(run.players[0].specialCharge).toBe(0);
    expect(run.phase).toBe('waveIntro');
    expect(steps(run, 1)).toContainEqual({ type: 'waveStart', wave: 0 });
  });

  it('does nothing outside the choice or for an unknown player', () => {
    const run = startedRun(1);
    expect(chooseSpecial(run, 'shieldBurst')).toEqual([]);
    expect(run.players[0].special).toBe('pulseBomb');
    const fresh = createRun(1);
    expect(chooseSpecial(fresh, 'pulseBomb', 3)).toEqual([]);
    expect(fresh.phase).toBe('chooseSpecial');
  });

  it('waits for every player before the intro begins', () => {
    const run = createRun(1, 2);
    chooseSpecial(run, 'pulseBomb', 0);
    expect(run.phase).toBe('chooseSpecial');
    chooseSpecial(run, 'timeStop', 1);
    expect(run.phase).toBe('waveIntro');
    expect(run.players.map((p) => p.special)).toEqual(['pulseBomb', 'timeStop']);
  });
});

describe('Specials in a run', () => {
  it('Pulse Bomb: wipes enemy shots, hurts every alien, scores the kills, stuns the swarm and charges nothing', () => {
    const run = readyRun('pulseBomb');
    run.aliens.slice(0, 2).forEach((a) => ((a.kind = 'carrier'), (a.hp = 4)));
    const drones = run.aliens.filter((a) => a.kind === 'drone').length;
    run.players[0].stats.bombOnKill = 1;
    run.shots.push(enemyShot(900, 10, 0), enemyShot(901, -20, 40));
    const events = stepRun(run, PRESS_SPECIAL, DT);
    expect(events[0]).toEqual({ type: 'specialFired', playerId: 0, special: 'pulseBomb', x: run.players[0].x, y: SHIP_Y });
    expect(ofType(events, 'blast')).toHaveLength(1); // the pulse's own; its kills don't burst
    expect(run.shots.filter((s) => s.owner === 'alien')).toEqual([]);
    expect(ofType(events, 'alienKilled')).toHaveLength(drones);
    expect(run.score).toBe(drones * 10);
    expect(run.aliens).toHaveLength(2);
    expect(run.aliens.every((a) => a.hp === 4 - PULSE_ALIEN_DAMAGE)).toBe(true);
    expect(ofType(events, 'alienHit')).toHaveLength(2);
    expect(run.stun).toBeGreaterThan(1);
    expect(run.players[0].specialCharge).toBe(0);
    // Stunned: the formation holds still until the stun ends.
    const offset = run.formation.offsetX;
    steps(run, 60);
    expect(run.formation.offsetX).toBe(offset);
    steps(run, 120);
    expect(run.formation.offsetX).not.toBe(offset);
  });

  it('Pulse Bomb: hits the boss for fixed damage across its plates, with part events', () => {
    const run = bossFight('pulseBomb');
    run.boss!.stun = 0;
    run.players[0].specialCharge = 1;
    const events = stepRun(run, PRESS_SPECIAL, DT);
    const plates = run.boss!.parts.filter((p) => p.kind === 'plate');
    expect(plates.every((p) => p.hp === p.maxHp - PULSE_BOSS_DAMAGE / 4)).toBe(true);
    expect(ofType(events, 'bossPartHit')).toHaveLength(4);
    expect(run.boss!.stun).toBeGreaterThan(1);
  });

  it('Pulse Bomb: boss plates it destroys do not charge the meter', () => {
    const run = bossFight('pulseBomb');
    run.boss!.stun = 0;
    for (const p of run.boss!.parts) if (p.kind === 'plate') p.hp = 1;
    run.players[0].specialCharge = 1;
    const events = stepRun(run, PRESS_SPECIAL, DT);
    expect(ofType(events, 'bossPartDestroyed')).toHaveLength(4);
    expect(run.players[0].specialCharge).toBe(0);
    expect(has(events, 'specialReady')).toBe(false);
  });

  it('Shield Burst: reflects a shot that reaches the ship instead of hurting it', () => {
    const run = readyRun('shieldBurst');
    const p = run.players[0];
    steps(run, 1, PRESS_SPECIAL);
    expect(p.burst).toBeGreaterThan(2);
    run.shots.push(enemyShot(900, p.x, SHIP_Y + 2));
    const events = steps(run, 1);
    expect(has(events, 'shotReflected')).toBe(true);
    expect(has(events, 'playerHit')).toBe(false);
    expect(p.lives).toBe(3);
    const reflected = run.shots.find((s) => s.id === 900)!;
    expect(reflected.owner).toBe('player');
    expect(reflected.kind).toBe('reflected');
    expect(reflected.vy).toBeGreaterThan(0);
  });

  it('Time Stop: freezes the formation and enemy shots while the ship keeps moving and firing', () => {
    const run = readyRun('timeStop');
    const p = run.players[0];
    run.shots.push(enemyShot(900, 60, 40));
    const alien = run.aliens[0];
    steps(run, 1, PRESS_SPECIAL);
    expect(run.freeze).toBeGreaterThan(TIME_STOP_SECONDS - 0.1);
    const before = { offsetX: run.formation.offsetX, x: alien.x, y: alien.y, shotY: run.shots.find((s) => s.id === 900)!.y };
    const moving: readonly ShipInput[] = [{ move: 1, drag: 0, fire: true, special: false }];
    const x0 = p.x;
    const events = steps(run, 60, moving);
    expect(p.x).toBeGreaterThan(x0 + 10);
    expect(has(events, 'playerFired')).toBe(true);
    expect(run.formation.offsetX).toBe(before.offsetX);
    expect([alien.x, alien.y]).toEqual([before.x, before.y]);
    expect(run.shots.find((s) => s.id === 900)!.y).toBe(before.shotY);
    steps(run, Math.ceil(TIME_STOP_SECONDS / DT));
    expect(run.freeze).toBe(0);
    steps(run, 30);
    expect(run.formation.offsetX).not.toBe(before.offsetX);
  });

  it('does not fire without a full meter', () => {
    const run = readyRun('pulseBomb');
    run.players[0].specialCharge = 0.5;
    expect(has(steps(run, 1, PRESS_SPECIAL), 'specialFired')).toBe(false);
  });
});

describe('the Special meter', () => {
  it('charges on a shot kill and announces when it fills', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    p.specialCharge = 1 - killCharge(1) / 2;
    const target = run.aliens.find((a) => a.row === 2)!;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && !has(events, 'alienKilled'); i++) {
      aimAt(run, target);
      events.push(...stepRun(run, HOLD_FIRE, DT));
    }
    expect(p.specialCharge).toBe(1);
    expect(ofType(events, 'specialReady')).toEqual([{ type: 'specialReady', playerId: 0 }]);
  });
});

describe('pickups and power-ups', () => {
  it('catches a falling pickup, starts its power-up and ends it when the time runs out', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    run.pickups.push({ id: 900, kind: 'spread', x: p.x, y: SHIP_Y + 8 });
    const events = steps(run, 20);
    expect(ofType(events, 'pickupCollected')).toEqual([{ type: 'pickupCollected', playerId: 0, pickupId: 900, kind: 'spread' }]);
    expect(run.pickups).toEqual([]);
    expect(p.powerUps).toEqual([{ kind: 'spread', timeLeft: expect.any(Number) }]);
    // A spread volley is five shots wide.
    const fired = steps(run, 2, HOLD_FIRE).concat(steps(run, 1, HOLD_FIRE));
    expect(ofType(fired, 'playerFired')[0].shots).toBe(5);
    p.powerUps[0].timeLeft = 0.01;
    expect(ofType(steps(run, 3), 'powerUpEnded')).toEqual([{ type: 'powerUpEnded', playerId: 0, kind: 'spread' }]);
    expect(p.powerUps).toEqual([]);
  });

  it('starts the run-wide slow when the slow pickup is caught', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.pickups.push({ id: 900, kind: 'slow', x: run.players[0].x, y: SHIP_Y + 8 });
    steps(run, 20);
    expect(run.slow).toBeGreaterThan(POWER_UP_SECONDS.slow - 0.5);
  });

  it('drops a power-up when a Carrier dies', () => {
    const run = startedRun(1);
    startPlaying(run);
    const target = run.aliens.find((a) => a.row === 2)!;
    target.kind = 'carrier';
    target.hp = 1;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && !has(events, 'alienKilled'); i++) {
      aimAt(run, target);
      events.push(...stepRun(run, HOLD_FIRE, DT));
    }
    const spawned = ofType(events, 'pickupSpawned');
    expect(spawned).toHaveLength(1);
    expect(run.pickups.map((p) => p.id)).toContain(spawned[0].pickupId);
  });

  it('hands a last-kill drop to the nearest ship instead of losing it when the wave clears', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    const last = run.aliens[0];
    run.aliens = [last];
    last.kind = 'carrier';
    last.hp = 1;
    const events: RunEvent[] = [];
    for (let i = 0; i < 400 && run.phase === 'playing'; i++) {
      aimAt(run, last);
      events.push(...stepRun(run, HOLD_FIRE, DT));
    }
    expect(run.phase).toBe('upgradePick');
    const spawned = ofType(events, 'pickupSpawned')[0];
    expect(ofType(events, 'pickupCollected')).toEqual([{ type: 'pickupCollected', playerId: 0, pickupId: spawned.pickupId, kind: spawned.kind }]);
    expect(p.powerUps.map((u) => u.kind)).toContain(spawned.kind);
    expect(run.pickups).toEqual([]);
  });

  it('carries power-ups over to the next wave but resets the effects and pickups', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    activatePowerUp(p, 'helper');
    run.slow = 3;
    run.freeze = 1;
    run.pickups.push({ id: 900, kind: 'laser', x: 50, y: 0 });
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    pickUpgrade(run, 0);
    expect(p.powerUps.map((u) => u.kind)).toEqual(['helper']);
    expect([run.slow, run.freeze, run.stun]).toEqual([0, 0, 0]);
    expect(run.pickups).toEqual([]);
  });

  it('the laser replaces the volley, damages the first alien it reaches and keeps wingmen firing', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    activatePowerUp(p, 'laser');
    p.stats.wingmen = 1;
    const target = run.aliens.find((a) => a.row === 2 && a.col === 1)!;
    target.kind = 'warden';
    target.hp = 2;
    run.aliens = [target, run.aliens.find((a) => a.row === 0 && a.col === 3)!];
    p.x = target.x;
    const events = stepRun(run, HOLD_FIRE, DT);
    expect(run.beams).toHaveLength(1);
    expect(run.beams[0].topY).toBeCloseTo(target.y - 6, 5);
    expect(target.hp).toBe(1);
    expect(ofType(events, 'alienHit')).toHaveLength(1);
    // Only the wingman's shot is in the air, not the ship's own.
    expect(run.shots.filter((s) => s.owner === 'player')).toHaveLength(1);
    expect(run.shots[0].x).not.toBe(p.x);
    expect(p.volleys).toBe(0); // the laser fires no volleys, so overcharge cadence holds
    let kills = 0;
    for (let i = 0; i < 60; i++) {
      p.x = target.x;
      kills += ofType(stepRun(run, HOLD_FIRE, DT), 'alienKilled').length;
    }
    expect(kills).toBeGreaterThanOrEqual(1);
    expect(run.score).toBeGreaterThanOrEqual(30);
  });

  it('the laser stops at the boss core while a plate stands, and does no damage there', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    const p = run.players[0];
    p.x = boss.x; // between the two middle plates, under the core
    activatePowerUp(p, 'laser');
    const core = boss.parts.find((c) => c.kind === 'core')!;
    steps(run, 60, HOLD_FIRE);
    expect(run.beams[0].topY).toBeCloseTo(boss.y - core.halfHeight, 5);
    expect(core.hp).toBe(core.maxHp);
    // Over a plate it does damage.
    p.x = boss.x + 13;
    steps(run, 60, HOLD_FIRE);
    const plate = boss.parts.find((c) => c.kind === 'plate' && c.dx === 13)!;
    expect(plate.hp).toBeLessThan(plate.maxHp);
  });
});

describe('combo and misses', () => {
  /** Three wardens-in-waiting so killing nothing keeps the wave going. */
  function twoTargets(run: RunState): [Alien, Alien] {
    const a = run.aliens.find((x) => x.row === 2 && x.col === 0)!;
    const b = run.aliens.find((x) => x.row === 2 && x.col === 3)!;
    for (const alien of [a, b]) {
      alien.kind = 'warden';
      alien.hp = 2;
    }
    return [a, b];
  }

  it('raises the combo once for a volley however many of its shots hit', () => {
    const run = startedRun(1);
    startPlaying(run);
    const [a, b] = twoTargets(run);
    run.shots.push(playerShot(900, a.x, a.y - 8, { volley: 700 }), playerShot(901, b.x, b.y - 8, { volley: 700 }));
    steps(run, 3);
    expect(a.hp + b.hp).toBe(2);
    expect(run.combo).toBe(2);
  });

  it('does not raise the combo for extra shots outside a counted volley', () => {
    const run = startedRun(1);
    startPlaying(run);
    const [a] = twoTargets(run);
    run.shots.push(playerShot(900, a.x, a.y - 8, { volley: VOLLEY_HIT }));
    steps(run, 3);
    expect(a.hp).toBe(1);
    expect(run.combo).toBe(1);
  });

  it('counts a volley that leaves the field together as one miss, and a combo guard forgives one', () => {
    const run = startedRun(1);
    startPlaying(run);
    const p = run.players[0];
    run.combo = 4;
    p.comboGuardLeft = 1;
    const top = FIELD_HEIGHT / 2 + 3;
    run.shots.push(playerShot(900, -5, top, { volley: 700 }), playerShot(901, 0, top, { volley: 700 }), playerShot(902, 5, top, { volley: 700 }));
    const first = steps(run, 1);
    expect(ofType(first, 'comboGuarded')).toEqual([{ type: 'comboGuarded', playerId: 0 }]);
    expect(has(first, 'comboBroken')).toBe(false);
    expect(run.combo).toBe(4);
    expect(p.comboGuardLeft).toBe(0);
    run.shots.push(playerShot(903, -5, top, { volley: 710 }), playerShot(904, 5, top, { volley: 710 }));
    const second = steps(run, 1);
    expect(ofType(second, 'comboBroken')).toEqual([{ type: 'comboBroken', combo: 4 }]);
    expect(run.combo).toBe(1);
  });

  it('counts a shot that leaves through the side as a miss', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.combo = 3;
    run.shots.push(playerShot(900, FIELD_WIDTH / 2 + 5, 0, { volley: 700, vx: 40, vy: 0 }));
    const events = steps(run, 1);
    expect(ofType(events, 'comboBroken')).toEqual([{ type: 'comboBroken', combo: 3 }]);
    expect(run.shots).toEqual([]);
  });
});

describe('kills', () => {
  it('bursts on a bomb-on-kill roll, hurting what is near, and the burst kills do not burst again', () => {
    const run = startedRun(1);
    startPlaying(run);
    run.players[0].stats.bombOnKill = 1;
    const at = (row: number, col: number) => run.aliens.find((a) => a.row === row && a.col === col)!;
    const target = at(2, 1);
    const side = [at(2, 0), at(2, 2)]; // 24 px away: inside the burst
    const tough = at(1, 1); // 20 px above
    const far = at(0, 3);
    tough.kind = 'warden';
    tough.hp = 2;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && !has(events, 'alienKilled'); i++) {
      aimAt(run, target);
      events.push(...stepRun(run, HOLD_FIRE, DT));
    }
    // The shot's kill bursts once; the neighbours it takes with it don't burst again.
    expect(ofType(events, 'blast')).toHaveLength(1);
    expect(ofType(events, 'alienKilled').map((e) => e.alienId).sort()).toEqual([target.id, ...side.map((a) => a.id)].sort());
    expect(ofType(events, 'alienHit')).toEqual([expect.objectContaining({ alienId: tough.id })]);
    expect(tough.hp).toBe(1);
    expect(far.hp).toBe(1);
    expect(run.aliens).toContain(far);
  });
});

describe('time scale', () => {
  it('scales the speed of alien shots by the target ship slow field', () => {
    const saved = WAVES[0].fireRate;
    (WAVES[0] as { fireRate: number }).fireRate = 1e6;
    try {
      for (const factor of [1, 0.75]) {
        const run = startedRun(1);
        startPlaying(run);
        run.players[0].stats.enemyShotSpeed = factor;
        steps(run, 1);
        const shot = run.shots.find((s) => s.owner === 'alien')!;
        expect(shot.vy).toBeCloseTo(-ALIEN_SHOT_SPEED * factor, 9);
      }
    } finally {
      (WAVES[0] as { fireRate: number }).fireRate = saved;
    }
  });

  it('scales the speed of boss volleys too', () => {
    for (const factor of [1, 0.75]) {
      const run = bossFight();
      run.players[0].stats.enemyShotSpeed = factor;
      run.boss!.fireTimer = 0.001;
      steps(run, 2);
      const shot = run.shots.find((s) => s.owner === 'alien')!;
      expect(shot.vy).toBeCloseTo(-BOSS_SHOT_SPEED * factor, 9);
    }
  });

  it('the slow power-up halves the speed of the enemies', () => {
    const fast = startedRun(1);
    const slow = startedRun(1);
    startPlaying(fast);
    startPlaying(slow);
    slow.slow = 100;
    steps(fast, 120);
    steps(slow, 120);
    expect(slow.formation.offsetX / fast.formation.offsetX).toBeCloseTo(0.5, 1);
  });
});

describe('upgrade picks', () => {
  it('announces a synergy the pick completes and refills guards for the next wave', () => {
    const run = startedRun(1);
    const p = run.players[0];
    p.upgrades.push('twinShot');
    p.stats.shotsPerVolley = 2;
    run.phase = 'upgradePick';
    run.offer = ['piercing', 'comboGuard', 'extraLife'];
    const events = pickUpgrade(run, 0);
    expect(events).toEqual([
      { type: 'upgradePicked', playerId: 0, upgrade: 'piercing' },
      { type: 'synergyUnlocked', playerId: 0, synergy: 'lance' },
    ]);
    expect(p.synergies).toEqual(['lance']);
    run.phase = 'upgradePick';
    run.offer = ['comboGuard'];
    pickUpgrade(run, 0);
    expect(p.comboGuardLeft).toBe(1);
  });
});

describe('the boss wave', () => {
  it('sets up the Brood Mother above the field with no formation, and it descends during the intro', () => {
    const run = startedRun(1);
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    run.wave = 3;
    pickUpgrade(run, 0);
    expect(run.wave).toBe(4);
    expect(run.aliens).toEqual([]);
    expect(run.boss).not.toBeNull();
    const y0 = run.boss!.y;
    steps(run, 30);
    expect(run.phase).toBe('waveIntro');
    expect(run.boss!.y).toBeLessThan(y0);
    expect(run.time).toBeGreaterThan(0);
  });

  it('is not cleared by an empty alien list, and free Drones do not invade', () => {
    const run = bossFight();
    run.boss!.stun = 100;
    expect(run.aliens).toEqual([]);
    steps(run, 20);
    expect(run.phase).toBe('playing');
    const drone = createAlienAt(run, 40, -20);
    run.aliens.push(drone);
    steps(run, 1);
    expect(run.phase).toBe('playing');
  });

  it('crashes a free Drone into the ship like a diver', () => {
    const run = bossFight();
    run.boss!.stun = 100;
    const drone = createAlienAt(run, run.players[0].x, SHIP_Y);
    run.aliens.push(drone);
    const events = steps(run, 1);
    expect(has(events, 'playerHit')).toBe(true);
    expect(run.aliens.find((a) => a.id === drone.id)).toBeUndefined();
  });

  it('spends a shot stopped by the shielded core without damage, an event or a miss', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    const core = boss.parts.find((p) => p.kind === 'core')!;
    run.combo = 3;
    run.shots.push(playerShot(900, boss.x, boss.y - core.halfHeight - 1, { volley: 700 }));
    const events = steps(run, 3);
    expect(core.hp).toBe(core.maxHp);
    expect(has(events, 'bossPartHit')).toBe(false);
    expect(ofType(events, 'coreBlocked')).toEqual([{ type: 'coreBlocked', x: boss.x, y: expect.any(Number) }]);
    expect(run.shots).toEqual([]);
    expect(has(events, 'comboBroken')).toBe(false);
  });

  it('flares the core shield for a blocked laser only a few times a second', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    const p = run.players[0];
    p.x = boss.x;
    activatePowerUp(p, 'laser');
    const events = steps(run, 120, HOLD_FIRE); // one second
    const flares = ofType(events, 'coreBlocked');
    expect(flares.length).toBeGreaterThanOrEqual(2);
    expect(flares.length).toBeLessThanOrEqual(4);
    expect(flares[0].x).toBeCloseTo(boss.x, 5);
    // Over a plate the beam isn't blocked.
    p.x = boss.x + 13;
    expect(ofType(steps(run, 60, HOLD_FIRE), 'coreBlocked')).toEqual([]);
  });

  it('lets a piercing shot hit a plate and carry on', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    const plate = boss.parts.find((p) => p.kind === 'plate' && p.dx === 13)!;
    run.shots.push(playerShot(900, boss.x + 13, boss.y - plate.halfHeight - 1, { pierceLeft: 1, damage: 2, volley: 700 }));
    const events = steps(run, 3);
    expect(plate.hp).toBe(plate.maxHp - 2);
    expect(ofType(events, 'bossPartHit')).toHaveLength(1);
    expect(run.shots).toHaveLength(1);
    expect(run.shots[0].pierceLeft).toBe(0);
  });

  it('scores a destroyed plate at the combo and charges the meter', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    const plate = boss.parts.find((p) => p.kind === 'plate' && p.dx === 13)!;
    plate.hp = 1;
    run.combo = 3;
    run.players[0].specialCharge = 0;
    run.shots.push(playerShot(900, boss.x + 13, boss.y - plate.halfHeight - 1, { volley: 700 }));
    const events = steps(run, 3);
    expect(ofType(events, 'bossPartDestroyed')).toEqual([expect.objectContaining({ part: 'plate', points: 300 })]);
    expect(run.score).toBe(300);
    expect(run.players[0].specialCharge).toBeCloseTo(CHARGE_PER_BOSS_PART, 9);
  });

  it('leads to an upgrade pick, with a rare on offer, when the Brood Mother falls: the run goes on', () => {
    const run = bossFight();
    const boss = run.boss!;
    boss.stun = 100;
    for (const part of boss.parts) if (part.kind !== 'core') part.hp = 0;
    const core = boss.parts.find((p) => p.kind === 'core')!;
    core.hp = 1;
    run.aliens.push(createAlienAt(run, 50, 60));
    run.combo = 5; // the boss kill is not multiplied
    const before = run.score;
    run.shots.push(playerShot(900, boss.x, boss.y - core.halfHeight - 1, { volley: 700 }));
    const events = steps(run, 3);
    expect(ofType(events, 'bossKilled')).toEqual([expect.objectContaining({ kind: 'broodMother', points: BOSS_POINTS.core })]);
    expect(run.score - before).toBe(BOSS_POINTS.core);
    expect(events).toContainEqual({ type: 'waveClear', wave: 4 });
    expect(has(events, 'won')).toBe(false);
    expect(ofType(events, 'bossPartDestroyed').some((e) => e.part === 'core')).toBe(false);
    expect(run.phase).toBe('upgradePick');
    expect(run.offer).toHaveLength(3);
    expect(upgradeDef(run.offer[2]).rarity).toBe('rare');
    expect(run.aliens).toEqual([]);
    pickUpgrade(run, 0);
    expect(run.wave).toBe(5);
  });

  it('keeps the boss out of reach while it descends', () => {
    const run = startedRun(1);
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    run.wave = 3;
    pickUpgrade(run, 0);
    steps(run, 10);
    expect(run.boss!.y).toBeGreaterThan(BOSS_Y);
    run.shots.push(playerShot(900, 0, run.boss!.y - 14, { volley: 700 }));
    const events = steps(run, 3);
    expect(has(events, 'bossPartHit')).toBe(false);
  });
});

function createAlienAt(run: RunState, x: number, y: number): Alien {
  const alien: Alien = { id: run.nextId++, kind: 'drone', hp: 1, col: -1, row: -1, x, y, mode: 'free', modeTime: 0, flash: 0, vx: 0, vy: 0 };
  return alien;
}


// Slice 2b ----------------------------------------------------------------------------------------

/** A run starting at the given wave index, in the Special choice done, optionally with its real bunkers. */
function waveRun(wave: number, bunkers = false, seed = 1): RunState {
  const run = createRun(seed, 1, wave);
  chooseSpecial(run, 'pulseBomb');
  if (!bunkers) run.bunkers = [];
  return run;
}

/** The Hive Mind fight, playing, with the boss landed and its own attacks held off. */
function hiveFight(bunkers = false): RunState {
  const run = waveRun(9, bunkers);
  run.players[0].lives = 99;
  startPlaying(run);
  const boss = run.boss!;
  boss.fireTimer = 1e9;
  boss.launchTimer = 1e9;
  boss.beamTimer = 1e9;
  for (let i = 0; i < 400 && bossEntering(boss); i++) steps(run, 1);
  expect(bossEntering(boss)).toBe(false);
  return run;
}

const solid = (run: RunState) => run.bunkers.map(bunkerSolidCount);
/** The x of the third bunker's solid left edge column: a good place for a shot to bite. */
const BUNKER_3_X = 15;

describe('sectors and bunkers', () => {
  it('announces the sector and builds bunkers at waves 1 and 6 only, and keeps them between', () => {
    const run = createRun(1);
    expect(run.bunkers).toHaveLength(4);
    chooseSpecial(run, 'pulseBomb');
    const announced: Array<[number, number]> = [];
    const versions = (r: RunState) => r.bunkers.map((b) => `${b.id}:${b.version}`).join();
    let ids = run.bunkers.map((b) => b.id).join();
    const rebuilt: number[] = [];
    for (let wave = 0; wave < WAVE_COUNT; wave++) {
      if (wave > 0) {
        run.phase = 'upgradePick';
        run.offer = ['extraLife'];
        pickUpgrade(run, 0);
        // Chew a bunker so persistence shows: a rebuilt set would be whole again.
        if (wave === 2) erodeColumn(run.bunkers, 15, BUNKER_BOTTOM_Y + 5, 4);
      }
      const nowIds = run.bunkers.map((b) => b.id).join();
      if (nowIds !== ids) rebuilt.push(wave);
      ids = nowIds;
      for (const e of steps(run, 2)) if (e.type === 'sectorStart') announced.push([wave, e.sector]);
      expect(run.phase).toBe('waveIntro');
    }
    expect(announced).toEqual([[0, 1], [5, 2]]);
    expect(rebuilt).toEqual([5]);
    expect(run.bunkers.every((b) => b.version === 0)).toBe(true);
    // Persistence in sector 1: the chewed bunker stays chewed through waves 3, 4 and the boss wave.
    const again = createRun(2);
    chooseSpecial(again, 'pulseBomb');
    erodeColumn(again.bunkers, 15, BUNKER_BOTTOM_Y + 5, 4);
    const chewed = versions(again);
    again.phase = 'upgradePick';
    again.offer = ['extraLife'];
    pickUpgrade(again, 0);
    expect(versions(again)).toBe(chewed);
  });

  it('starts bunkers for a run that begins in sector 2', () => {
    const run = createRun(1, 1, 7);
    expect(run.bunkers).toHaveLength(4);
    chooseSpecial(run, 'pulseBomb');
    const events = steps(run, 1);
    expect(events).toContainEqual({ type: 'sectorStart', sector: 2 });
    // The sector comes before the wave's own announcement.
    expect(events.map((e) => e.type).filter((t) => t === 'sectorStart' || t === 'waveStart')).toEqual(['sectorStart', 'waveStart']);
  });

  it('spends an enemy shot on a bunker with a bunkerHit, and the ship beneath is not hurt', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    run.players[0].x = 23;
    const bunker = run.bunkers[2];
    const before = bunkerSolidCount(bunker);
    run.shots.push(enemyShot(900, 23, BUNKER_BOTTOM_Y + BUNKER_HEIGHT + 2));
    const events = steps(run, 2);
    expect(ofType(events, 'bunkerHit')).toEqual([expect.objectContaining({ bunkerId: bunker.id })]);
    expect(run.shots.find((s) => s.id === 900)).toBeUndefined();
    expect(bunkerSolidCount(bunker)).toBeLessThan(before);
    expect(run.players[0].lives).toBe(3);
  });

  it('lets an enemy shot through a hole in a bunker', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    run.bunkers[2].mask.fill(0);
    run.players[0].x = 23;
    run.shots.push(enemyShot(900, 23, BUNKER_BOTTOM_Y + BUNKER_HEIGHT + 2));
    const events = steps(run, 40);
    expect(has(events, 'bunkerHit')).toBe(false);
    expect(has(events, 'playerHit')).toBe(true);
  });

  it('spends a player shot on a bunker, neither a hit nor a miss for the combo', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    run.combo = 3;
    const bunker = run.bunkers[2];
    const top = FIELD_HEIGHT / 2 + 3;
    run.shots.push(
      playerShot(900, BUNKER_3_X, BUNKER_BOTTOM_Y - 2, { volley: 700 }),
      playerShot(901, -50, top, { volley: 700 }), // its sibling leaves through the top
    );
    const events = steps(run, 3);
    expect(ofType(events, 'bunkerHit')).toEqual([expect.objectContaining({ bunkerId: bunker.id })]);
    expect(run.shots.find((s) => s.id === 900)).toBeUndefined();
    expect(has(events, 'comboBroken') || has(events, 'comboGuarded')).toBe(false);
    expect(run.combo).toBe(3); // no hit, so no rise either
  });

  it('lets lance and overcharge shots tunnel on, reporting bunkerHit only now and then, but stops piercing shots', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    const bunker = run.bunkers[2];
    const before = bunkerSolidCount(bunker);
    run.shots.push(
      playerShot(900, BUNKER_3_X, BUNKER_BOTTOM_Y - 2, { kind: 'lance', pierceLeft: 99, vy: 30, volley: VOLLEY_HIT }),
      playerShot(901, 28, BUNKER_BOTTOM_Y - 2, { pierceLeft: 2, vy: 30, volley: VOLLEY_HIT }),
    );
    const events = steps(run, 20); // 1/6 of a second of slow tunnelling
    expect(bunkerSolidCount(bunker)).toBeLessThan(before - 10);
    const lance = run.shots.find((s) => s.id === 900)!;
    expect(lance.pierceLeft).toBe(99);
    expect(lance.y).toBeGreaterThan(BUNKER_BOTTOM_Y - 2);
    expect(ofType(events, 'bunkerHit').length).toBeGreaterThanOrEqual(2);
    expect(ofType(events, 'bunkerHit').length).toBeLessThanOrEqual(4); // one lance, one stopped shot: not one per step
    // The ordinary piercing shot was spent on the bunker and kept its pierce unspent.
    expect(run.shots.find((s) => s.id === 901)).toBeUndefined();
  });

  it('erodes a bunker an alien flies through', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    run.freeze = 100; // hold everything still
    const bunker = run.bunkers[1];
    const before = bunkerSolidCount(bunker);
    const mini = createAlienAt(run, bunker.x + 10, bunker.y + 5);
    run.aliens.push(mini);
    steps(run, 1);
    expect(bunkerSolidCount(bunker)).toBeLessThan(before);
    // High formation aliens leave the bunkers alone.
    const whole = solid(run);
    run.aliens = run.aliens.filter((a) => a.mode !== 'free');
    steps(run, 5);
    expect(solid(run)).toEqual(whole);
  });

  it('stops the laser at a bunker and burns it on damage ticks, hurting no alien', () => {
    const run = startedRun(1, 'pulseBomb', 1, true);
    startPlaying(run);
    const p = run.players[0];
    p.x = BUNKER_3_X;
    activatePowerUp(p, 'laser');
    const bunker = run.bunkers[2];
    const hp = run.aliens.map((a) => a.hp);
    const before = bunkerSolidCount(bunker);
    steps(run, 30, HOLD_FIRE);
    expect(run.beams[0].topY).toBeLessThan(BUNKER_BOTTOM_Y + BUNKER_HEIGHT);
    expect(run.beams[0].topY).toBeGreaterThanOrEqual(BUNKER_BOTTOM_Y);
    expect(bunkerSolidCount(bunker)).toBeLessThan(before);
    expect(run.aliens.map((a) => a.hp)).toEqual(hp);
  });
});

describe('the Splitter', () => {
  function splitterRun(): { run: RunState; splitter: Alien } {
    const run = waveRun(5);
    startPlaying(run);
    run.freeze = 100;
    const splitter = run.aliens.find((a) => a.kind === 'splitter')!;
    splitter.hp = 1;
    run.aliens = [splitter, run.aliens.find((a) => a.kind === 'drone' && a.row === 3 && a.col === 5)!];
    run.players[0].x = splitter.x;
    return { run, splitter };
  }

  it('breaks into two minis when shot, which join after the pass and are not killed by its own burst', () => {
    const { run, splitter } = splitterRun();
    run.players[0].stats.bombOnKill = 1;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && !has(events, 'alienKilled'); i++) events.push(...stepRun(run, HOLD_FIRE, DT));
    expect(ofType(events, 'alienSplit')).toEqual([{ type: 'alienSplit', alienId: splitter.id, x: splitter.x, y: splitter.y }]);
    expect(ofType(events, 'blast')).toHaveLength(1);
    const minis = run.aliens.filter((a) => a.kind === 'mini');
    expect(minis).toHaveLength(2);
    expect(minis.every((m) => m.mode === 'free' && m.hp === 1)).toBe(true);
    expect(minis[0].vx! * minis[1].vx!).toBeLessThan(0);
    expect(run.aliens.some((a) => a.id === splitter.id)).toBe(false);
  });

  it('splits when a Pulse Bomb kills it, and the minis survive that bomb', () => {
    const { run, splitter } = splitterRun();
    run.players[0].specialCharge = 1;
    const events = stepRun(run, PRESS_SPECIAL, DT);
    expect(ofType(events, 'alienSplit')).toHaveLength(1);
    expect(run.aliens.filter((a) => a.kind === 'mini')).toHaveLength(2);
    expect(run.aliens.some((a) => a.id === splitter.id)).toBe(false);
  });

  it('splits when the laser kills it', () => {
    const { run } = splitterRun();
    activatePowerUp(run.players[0], 'laser');
    const events = steps(run, 20, HOLD_FIRE);
    expect(ofType(events, 'alienSplit')).toHaveLength(1);
  });

  it('does not split on a crash into the ship (no kill, no minis)', () => {
    const run = waveRun(5);
    startPlaying(run);
    const splitter = run.aliens.find((a) => a.kind === 'splitter')!;
    splitter.mode = 'diving';
    splitter.x = run.players[0].x;
    splitter.y = SHIP_Y;
    splitter.dive = { fromX: splitter.x, fromY: splitter.y, toX: splitter.x };
    splitter.modeTime = 0.1;
    const events = steps(run, 1);
    expect(has(events, 'playerHit')).toBe(true);
    expect(has(events, 'alienSplit')).toBe(false);
    expect(run.aliens.some((a) => a.kind === 'mini')).toBe(false);
  });

  it('keeps the wave going while minis live and clears it once they and the rest are gone', () => {
    const { run } = splitterRun();
    run.aliens = run.aliens.filter((a) => a.kind === 'splitter');
    run.players[0].stats.damage = 5;
    const events: RunEvent[] = [];
    for (let i = 0; i < 300 && !has(events, 'alienKilled'); i++) events.push(...stepRun(run, HOLD_FIRE, DT));
    expect(run.phase).toBe('playing');
    expect(run.aliens).toHaveLength(2);
  });
});

describe('formation behaviours', () => {
  it('reports the split and the regroup', () => {
    const run = waveRun(6);
    run.players[0].lives = 99;
    startPlaying(run);
    const events = steps(run, Math.ceil((SPLIT_JOINED_SECONDS + SPLIT_APART_SECONDS + 1) / DT));
    const names = events.filter((e) => e.type === 'formationSplit' || e.type === 'formationRegroup').map((e) => e.type);
    expect(names).toEqual(['formationSplit', 'formationRegroup']);
    expect(run.phase).toBe('playing');
  });

  it('sends two neighbouring divers dive together on a paired-dives wave', () => {
    const saved = WAVES[7].diveRate;
    (WAVES[7] as { diveRate: number }).diveRate = 1e6;
    try {
      const run = waveRun(7);
      startPlaying(run);
      const events = steps(run, 1);
      const starts = ofType(events, 'diveStart');
      expect(starts).toHaveLength(2);
      const [a, b] = starts.map((e) => run.aliens.find((x) => x.id === e.alienId)!);
      expect([a.mode, b.mode]).toEqual(['diving', 'diving']);
      expect(a.row).toBe(b.row);
      expect(Math.abs(a.col - b.col)).toBe(1);
      expect(a.modeTime).toBe(b.modeTime);
    } finally {
      (WAVES[7] as { diveRate: number }).diveRate = saved;
    }
  });

  it('falls back to a single dive when no pair of divers is left', () => {
    const saved = WAVES[7].diveRate;
    (WAVES[7] as { diveRate: number }).diveRate = 1e6;
    try {
      const run = waveRun(7);
      startPlaying(run);
      const diver = run.aliens.find((a) => a.kind === 'diver')!;
      run.aliens = run.aliens.filter((a) => a.kind !== 'diver' || a === diver);
      const events = steps(run, 1);
      expect(ofType(events, 'diveStart')).toEqual([{ type: 'diveStart', alienId: diver.id }]);
    } finally {
      (WAVES[7] as { diveRate: number }).diveRate = saved;
    }
  });
});

describe('the Hive Mind', () => {
  const fireBeam = (run: RunState, x: number, seconds = 5) => {
    const boss = run.boss!;
    boss.x = x;
    run.players[0].x = x;
    boss.beams = [{ angle: -Math.PI / 2, sweep: 0, state: 'fire', timeLeft: seconds }];
  };

  it('is a boss wave with no formation that descends during the intro', () => {
    const run = waveRun(9);
    expect(run.aliens).toEqual([]);
    expect(run.boss?.kind).toBe('hiveMind');
    const y0 = run.boss!.y;
    steps(run, 30);
    expect(run.boss!.y).toBeLessThan(y0);
  });

  it('hurts a ship caught in a firing beam, and not one in a warning beam', () => {
    const run = hiveFight();
    fireBeam(run, 0);
    run.boss!.beams![0].state = 'warn';
    expect(has(steps(run, 5), 'playerHit')).toBe(false);
    run.boss!.beams![0].state = 'fire';
    const events = steps(run, 2);
    expect(has(events, 'playerHit')).toBe(true);
    expect(run.players[0].lives).toBe(98);
  });

  it('shelters a ship under a bunker and burns the bunker where the beam meets it', () => {
    const run = hiveFight(true);
    const bunker = run.bunkers[2];
    const before = bunkerSolidCount(bunker);
    fireBeam(run, BUNKER_3_X);
    const events = steps(run, 30);
    expect(has(events, 'playerHit')).toBe(false);
    expect(bunkerSolidCount(bunker)).toBeLessThan(before);
  });

  it('does not hurt a ship while time is frozen', () => {
    const run = hiveFight();
    fireBeam(run, 0);
    run.freeze = 100;
    expect(has(steps(run, 10), 'playerHit')).toBe(false);
  });

  it('passes bossBeam events through and shatters the ring in phase 3 with part events worth nothing', () => {
    const run = hiveFight();
    const boss = run.boss!;
    const core = boss.parts.find((p) => p.kind === 'core')!;
    core.hp = 60; // below a third: phases 2 then 3, one per step
    boss.beamTimer = 0;
    const before = run.score;
    const events = steps(run, 4);
    expect(ofType(events, 'bossPhase').map((e) => e.phase)).toEqual([2, 3]);
    const shattered = ofType(events, 'bossPartDestroyed').filter((e) => e.part === 'segment');
    expect(shattered).toHaveLength(8);
    expect(shattered.every((e) => e.points === 0)).toBe(true);
    expect(run.score).toBe(before);
    expect(ofType(events, 'bossBeam').length).toBeGreaterThan(0);
  });

  it('ends the run in a win when the core falls after wave 10, removing the Divers it launched', () => {
    const run = hiveFight();
    const boss = run.boss!;
    for (const part of boss.parts) if (part.kind !== 'core') part.hp = 0;
    const core = boss.parts.find((p) => p.kind === 'core')!;
    core.hp = 1;
    run.aliens.push({ ...createAlienAt(run, 40, 30), kind: 'diver' });
    const before = run.score;
    run.shots.push(playerShot(900, boss.x, boss.y - 12, { volley: 700 }));
    const events = steps(run, 3);
    expect(ofType(events, 'bossKilled')).toEqual([expect.objectContaining({ kind: 'hiveMind', points: BOSS_POINTS.core })]);
    expect(events).toContainEqual({ type: 'waveClear', wave: 9 });
    expect(has(events, 'won')).toBe(true);
    expect(run.phase).toBe('won');
    expect(run.score - before).toBe(BOSS_POINTS.core);
    expect(run.aliens).toEqual([]);
  });

  it('lets a shot through a gap in the ring to the core, and stops others on a segment', () => {
    const run = hiveFight();
    const boss = run.boss!;
    const core = boss.parts.find((p) => p.kind === 'core')!;
    // Segment 6 sits straight below at ring angle 0; turned half a step, a gap is straight below.
    boss.ringAngle = Math.PI / 8;
    run.shots.push(playerShot(900, boss.x, boss.y - 14, { volley: 700 }));
    steps(run, 2);
    expect(core.hp).toBeLessThan(core.maxHp);
    boss.ringAngle = 0;
    const hp = core.hp;
    run.shots.push(playerShot(901, boss.x, boss.y - 26, { volley: 701 }));
    steps(run, 2);
    expect(core.hp).toBe(hp);
    expect(boss.parts.some((p) => p.kind === 'segment' && p.hp < p.maxHp)).toBe(true);
  });
});
