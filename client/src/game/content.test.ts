import { describe, expect, it } from 'vitest';
import { createAlien } from './aliens';
import { bossEntering } from './boss';
import { BUNKER_BOTTOM_Y } from './bunkers';
import { SHIP_TOP, SHIP_Y } from './player';
import { POWER_UP_SECONDS } from './powerups';
import { WAVE_INTRO_SECONDS, chooseSpecial, createRun, pickUpgrade, stepRun } from './run';
import { killCharge } from './special';
import { BATTERY_CHARGE, unlockSynergies } from './synergies';
import { NO_INPUT, VOLLEY_HIT } from './types';
import type { Alien, AlienKind, RunEvent, RunOptions, RunState, ShipInput, Shot, SpecialId, UpgradeId } from './types';
import { applyUpgrade, CHAIN_RANGE } from './upgrades';
import { WELL_SECONDS } from './well';

// Release 3b's content inside the run: Chain Spark and Storm, Scavenger, Overclock and Battery,
// Last Stand, the offer pool, Missile Swarm and Gravity Well. (Each piece's own numbers are tested
// beside it; these check that the run wires them up.)

const DT = 1 / 120;
const IDLE: readonly ShipInput[] = [NO_INPUT];
const HOLD_FIRE: readonly ShipInput[] = [{ move: 0, drag: 0, fire: true, special: false }];
const PRESS_SPECIAL: readonly ShipInput[] = [{ move: 0, drag: 0, fire: false, special: true }];

function steps(run: RunState, n: number, inputs: readonly ShipInput[] = IDLE): RunEvent[] {
  const events: RunEvent[] = [];
  for (let i = 0; i < n; i++) events.push(...stepRun(run, inputs, DT));
  return events;
}

const ofType = <T extends RunEvent['type']>(events: readonly RunEvent[], type: T) =>
  events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

/** A run playing wave 0 with no bunkers, an empty field but for one far-off anchor alien, and the formation held still. */
function arena(special: SpecialId = 'pulseBomb', options: RunOptions = {}): RunState {
  const run = createRun(1, 1, 0, options);
  chooseSpecial(run, special);
  run.bunkers = [];
  steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
  expect(run.phase).toBe('playing');
  run.aliens = [];
  run.shots = [];
  run.stun = 1e6; // formation and free aliens stand still; shots and the ship are unaffected
  anchor(run);
  return run;
}

let nextAlienId = 5000;
/** An alien of `kind` at (x, y) in its formation slot (held by the stun). */
function alien(run: RunState, kind: AlienKind, x: number, y: number, over: Partial<Alien> = {}): Alien {
  const a = createAlien(kind, nextAlienId++, 0, 0, x, y);
  Object.assign(a, over);
  run.aliens.push(a);
  return a;
}
/** A tough alien far from everything, so the wave does not clear. */
function anchor(run: RunState): Alien {
  return alien(run, 'carrier', -85, 150, { hp: 99 });
}

const playerShot = (id: number, x: number, y: number, over: Partial<Shot> = {}): Shot => ({
  id, owner: 'player', kind: 'normal', playerId: 0, x, y, vx: 0, vy: 260, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: id, ...over,
});
const enemyShot = (id: number, x: number, y: number, over: Partial<Shot> = {}): Shot => ({
  id, owner: 'alien', kind: 'enemy', playerId: null, x, y, vx: 0, vy: -90, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: id, ...over,
});

const take = (run: RunState, ...ids: UpgradeId[]) => {
  for (const id of ids) applyUpgrade(run.players[0], id);
  unlockSynergies(run.players[0]);
};

/** Fires a player shot straight into `target` and steps once. */
function hit(run: RunState, target: Alien): RunEvent[] {
  run.shots.push(playerShot(9000, target.x, target.y));
  return steps(run, 1);
}

describe('Chain Spark', () => {
  it('arcs from the alien it hit to the nearest other living alien for 1 damage', () => {
    const run = arena();
    take(run, 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const near = alien(run, 'warden', 20, 100);
    const far = alien(run, 'warden', -30, 100);
    const events = hit(run, a);
    expect(a.hp).toBe(0);
    expect(near.hp).toBe(1);
    expect(far.hp).toBe(2);
    expect(ofType(events, 'chainSpark')).toEqual([{ type: 'chainSpark', fromX: 0, fromY: 100, toX: 20, toY: 100 }]);
    expect(events).toContainEqual({ type: 'alienHit', alienId: near.id, kind: 'warden', x: 20, y: 100 });
  });

  it('does nothing without the upgrade', () => {
    const run = arena();
    const a = alien(run, 'drone', 0, 100);
    const next = alien(run, 'warden', 20, 100);
    const events = hit(run, a);
    expect(ofType(events, 'chainSpark')).toEqual([]);
    expect(next.hp).toBe(2);
  });

  it('only reaches aliens within CHAIN_RANGE', () => {
    const run = arena();
    take(run, 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const out = alien(run, 'warden', CHAIN_RANGE + 1, 100);
    expect(ofType(hit(run, a), 'chainSpark')).toEqual([]);
    expect(out.hp).toBe(2);

    const run2 = arena();
    take(run2, 'chainSpark');
    const b = alien(run2, 'drone', 0, 100);
    const inside = alien(run2, 'warden', CHAIN_RANGE - 1, 100);
    expect(ofType(hit(run2, b), 'chainSpark')).toHaveLength(1);
    expect(inside.hp).toBe(1);
  });

  it('a second copy arcs to a second, different alien, never the same one twice', () => {
    const run = arena();
    take(run, 'chainSpark', 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const b = alien(run, 'warden', 20, 100);
    const c = alien(run, 'warden', -25, 100);
    const d = alien(run, 'warden', 0, 130);
    const events = hit(run, a);
    const sparks = ofType(events, 'chainSpark');
    expect(sparks).toHaveLength(2);
    expect(sparks.map((s) => s.toX).sort((x, y) => x - y)).toEqual([-25, 20]);
    expect([b.hp, c.hp, d.hp]).toEqual([1, 1, 2]);
  });

  it('with only one other alien in range, two arcs make one spark', () => {
    const run = arena();
    take(run, 'chainSpark', 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const b = alien(run, 'warden', 20, 100);
    expect(ofType(hit(run, a), 'chainSpark')).toHaveLength(1);
    expect(b.hp).toBe(1);
  });

  it('a spark kill scores, charges the meter and can drop a power-up, like a normal kill', () => {
    const run = arena();
    take(run, 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const b = alien(run, 'carrier', 20, 100, { hp: 1 });
    const events = hit(run, a);
    expect(b.hp).toBe(0);
    expect(ofType(events, 'alienKilled').map((e) => e.kind)).toEqual(['drone', 'carrier']);
    expect(run.score).toBe(10 + 60);
    expect(run.players[0].specialCharge).toBeCloseTo(2 * killCharge(1), 9);
    expect(ofType(events, 'pickupSpawned')).toHaveLength(1);
    expect(run.aliens.map((x) => x.id)).not.toContain(b.id);
  });

  it('sparks do not spark again', () => {
    const run = arena();
    take(run, 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const b = alien(run, 'warden', 20, 100);
    const c = alien(run, 'warden', 45, 100); // beyond a's range, within b's
    const events = hit(run, a);
    expect(ofType(events, 'chainSpark')).toHaveLength(1);
    expect(b.hp).toBe(1);
    expect(c.hp).toBe(2);
  });

  it('a Splitter killed by a spark still splits', () => {
    const run = arena();
    take(run, 'chainSpark');
    const a = alien(run, 'drone', 0, 100);
    const s = alien(run, 'splitter', 20, 100, { hp: 1 });
    const events = hit(run, a);
    expect(ofType(events, 'alienSplit')).toEqual([{ type: 'alienSplit', alienId: s.id, x: 20, y: 100 }]);
    expect(run.aliens.filter((x) => x.kind === 'mini')).toHaveLength(2);
  });

  it('also arcs from a hit that does not kill, and from each alien a piercing shot passes through', () => {
    const run = arena();
    take(run, 'chainSpark');
    const tough = alien(run, 'warden', 0, 100);
    const next = alien(run, 'warden', 20, 100);
    hit(run, tough);
    expect(tough.hp).toBe(1);
    expect(next.hp).toBe(1);
  });

  describe('with Storm (Chain Spark + Homing)', () => {
    it('unlocks Storm and chains each spark on once more, to a new alien', () => {
      const run = arena();
      take(run, 'chainSpark', 'homing');
      expect(run.players[0].synergies).toContain('storm');
      const a = alien(run, 'drone', 0, 100);
      const b = alien(run, 'warden', 30, 100);
      const c = alien(run, 'warden', 60, 100); // out of a's reach, within b's
      const d = alien(run, 'warden', 100, 100); // out of everyone's
      const sparks = ofType(hit(run, a), 'chainSpark');
      expect(sparks).toEqual([
        { type: 'chainSpark', fromX: 0, fromY: 100, toX: 30, toY: 100 },
        { type: 'chainSpark', fromX: 30, fromY: 100, toX: 60, toY: 100 },
      ]);
      expect([b.hp, c.hp, d.hp]).toEqual([1, 1, 2]);
    });

    it('never hops back to an alien already sparked or to the one hit', () => {
      const run = arena();
      take(run, 'chainSpark', 'homing');
      const a = alien(run, 'drone', 0, 100);
      alien(run, 'warden', 20, 100);
      expect(ofType(hit(run, a), 'chainSpark')).toHaveLength(1);
    });

    it('with two copies makes every first hop before any second hop', () => {
      const run = arena();
      take(run, 'chainSpark', 'chainSpark', 'homing');
      const a = alien(run, 'drone', 0, 100);
      const b = alien(run, 'warden', 20, 100);
      const c = alien(run, 'warden', -22, 100);
      const d = alien(run, 'warden', 41, 100); // nearest to b once b and c are taken
      const sparks = ofType(hit(run, a), 'chainSpark');
      expect(sparks.map((s) => [s.fromX, s.toX])).toEqual([
        [0, 20],
        [0, -22],
        [20, 41],
      ]);
      expect([b.hp, c.hp, d.hp]).toEqual([1, 1, 1]);
    });

    it('a Storm hop that kills scores and charges like any spark kill', () => {
      const run = arena();
      take(run, 'chainSpark', 'homing');
      const a = alien(run, 'drone', 0, 100);
      alien(run, 'warden', 30, 100);
      alien(run, 'drone', 60, 100);
      hit(run, a);
      expect(run.score).toBe(10 + 10);
      expect(run.players[0].specialCharge).toBeCloseTo(2 * killCharge(1), 9);
    });
  });

  it('does not disturb the random numbers of a run without it', () => {
    const a = createRun(4);
    const b = createRun(4);
    chooseSpecial(a, 'pulseBomb');
    chooseSpecial(b, 'pulseBomb');
    steps(a, 400, HOLD_FIRE);
    steps(b, 400, HOLD_FIRE);
    expect(a.rng.next()).toBe(b.rng.next());
    expect(a.score).toBe(b.score);
  });
});

describe('Scavenger', () => {
  it('makes a caught power-up last 50% longer', () => {
    const run = arena();
    take(run, 'scavenger');
    run.pickups.push({ id: 700, kind: 'laser', x: run.players[0].x, y: SHIP_Y });
    steps(run, 1);
    const left = run.players[0].powerUps.find((u) => u.kind === 'laser')!.timeLeft;
    expect(left).toBeGreaterThan(POWER_UP_SECONDS.laser * 1.5 - 0.1);
    expect(left).toBeLessThanOrEqual(POWER_UP_SECONDS.laser * 1.5);
  });

  it('also lengthens the slow field the power-up starts', () => {
    const run = arena();
    take(run, 'scavenger');
    run.pickups.push({ id: 701, kind: 'slow', x: run.players[0].x, y: SHIP_Y });
    steps(run, 1);
    expect(run.slow).toBeGreaterThan(POWER_UP_SECONDS.slow * 1.5 - 0.1);
  });

  it('feeds the ship\'s drop rate into every kill', () => {
    const run = arena();
    take(run, 'scavenger');
    expect(run.players[0].stats.dropRate).toBeCloseTo(1.5, 9);
    run.players[0].stats.dropRate = 1e6; // every roll succeeds
    const a = alien(run, 'drone', 0, 100);
    expect(ofType(hit(run, a), 'pickupSpawned')).toHaveLength(1);

    const plain = arena();
    const b = alien(plain, 'drone', 0, 100);
    plain.rng.next = () => 0.04; // above the plain 3% chance, below 4.5%
    expect(ofType(hit(plain, b), 'pickupSpawned')).toHaveLength(0);
    const boosted = arena();
    boosted.players[0].stats.dropRate = 1.5;
    const c = alien(boosted, 'drone', 0, 100);
    boosted.rng.next = () => 0.04;
    expect(ofType(hit(boosted, c), 'pickupSpawned')).toHaveLength(1);
  });
});

describe('Overclock and Battery', () => {
  it('Overclock multiplies the charge every kill gives', () => {
    const run = arena();
    take(run, 'overclock');
    hit(run, alien(run, 'drone', 0, 100));
    expect(run.players[0].specialCharge).toBeCloseTo(killCharge(1) * 1.3, 9);
  });

  it('Battery adds a quarter of the meter for each power-up caught, not scaled by Overclock', () => {
    const run = arena();
    take(run, 'overclock', 'scavenger');
    expect(run.players[0].synergies).toContain('battery');
    run.pickups.push({ id: 702, kind: 'helper', x: run.players[0].x, y: SHIP_Y });
    steps(run, 1);
    expect(run.players[0].specialCharge).toBeCloseTo(BATTERY_CHARGE, 9);
    expect(BATTERY_CHARGE).toBe(0.25);
  });

  it('says specialReady once when a caught power-up fills the meter, and not again while it is full', () => {
    const run = arena();
    take(run, 'overclock', 'scavenger');
    run.players[0].specialCharge = 0.9;
    run.pickups.push({ id: 703, kind: 'helper', x: run.players[0].x, y: SHIP_Y });
    const first = steps(run, 1);
    expect(ofType(first, 'specialReady')).toHaveLength(1);
    expect(run.players[0].specialCharge).toBe(1);
    run.pickups.push({ id: 704, kind: 'spread', x: run.players[0].x, y: SHIP_Y });
    expect(ofType(steps(run, 1), 'specialReady')).toHaveLength(0);
  });

  it('a power-up caught without Battery adds nothing to the meter', () => {
    const run = arena();
    take(run, 'overclock');
    run.pickups.push({ id: 705, kind: 'helper', x: run.players[0].x, y: SHIP_Y });
    steps(run, 1);
    expect(run.players[0].specialCharge).toBe(0);
  });
});

describe('Last Stand', () => {
  it('speeds up fire only on the last life', () => {
    const volleys = (lives: number) => {
      const run = arena();
      take(run, 'lastStand');
      run.players[0].lives = lives;
      return ofType(steps(run, 360, HOLD_FIRE), 'playerFired').length;
    };
    expect(volleys(3)).toBe(volleys(2));
    expect(volleys(1)).toBeGreaterThan(volleys(2) * 1.3);
  });
});

describe('the offer pool', () => {
  const clearWave0 = (run: RunState) => {
    run.aliens = [];
    alien(run, 'drone', 0, 100);
    run.shots.push(playerShot(9100, 0, 100));
    steps(run, 1);
    expect(run.phase).toBe('upgradePick');
  };

  it('offers only what is in the run\'s pool', () => {
    const pool: UpgradeId[] = ['twinShot', 'magnet', 'homing'];
    for (let seed = 1; seed <= 20; seed++) {
      const run = createRun(seed, 1, 0, { upgrades: pool });
      chooseSpecial(run, 'pulseBomb');
      run.bunkers = [];
      steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
      run.stun = 1e6;
      clearWave0(run);
      expect([...run.offer].sort()).toEqual([...pool].sort());
    }
  });

  it('offers fewer than three when the pool is small', () => {
    const run = createRun(1, 1, 0, { upgrades: ['magnet'] });
    chooseSpecial(run, 'pulseBomb');
    run.bunkers = [];
    steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
    run.stun = 1e6;
    clearWave0(run);
    expect(run.offer).toEqual(['magnet']);
  });

  it('after a boss, a pool with no rare gets an ordinary offer from the pool', () => {
    const pool: UpgradeId[] = ['twinShot', 'rapidFire', 'piercing', 'magnet'];
    const run = createRun(1, 1, 4, { upgrades: pool });
    chooseSpecial(run, 'pulseBomb');
    run.phase = 'playing';
    for (const part of run.boss!.parts) part.hp = 0;
    steps(run, 1);
    expect(run.phase).toBe('upgradePick');
    expect(run.offer).toHaveLength(3);
    for (const id of run.offer) expect(pool).toContain(id);
  });

  it('after a boss, a rare in the pool is the guaranteed pick', () => {
    const pool: UpgradeId[] = ['twinShot', 'rapidFire', 'piercing', 'lastStand'];
    const run = createRun(2, 1, 4, { upgrades: pool });
    chooseSpecial(run, 'pulseBomb');
    run.phase = 'playing';
    for (const part of run.boss!.parts) part.hp = 0;
    steps(run, 1);
    expect(run.offer).toContain('lastStand');
    expect(pickUpgrade(run, run.offer.indexOf('lastStand')).map((e) => e.type)).toContain('upgradePicked');
    expect(run.players[0].stats.lastStand).toBeCloseTo(0.7, 9);
  });
});

describe('Missile Swarm', () => {
  const fireSwarm = (run: RunState) => {
    run.players[0].specialCharge = 1;
    return steps(run, 1, PRESS_SPECIAL);
  };

  it('launches eight missiles', () => {
    const run = arena('missileSwarm');
    const events = fireSwarm(run);
    expect(ofType(events, 'specialFired')).toHaveLength(1);
    expect(run.shots.filter((s) => s.kind === 'missile')).toHaveLength(8);
    expect(run.players[0].specialCharge).toBe(0);
  });

  it('a missile does 2 damage to an alien and is spent, without raising the combo', () => {
    const run = arena('missileSwarm');
    const w = alien(run, 'warden', 0, 100);
    run.shots.push(playerShot(9200, 0, 100, { kind: 'missile', damage: 2, volley: VOLLEY_HIT }));
    const events = steps(run, 1);
    expect(w.hp).toBe(0);
    expect(ofType(events, 'alienKilled')).toHaveLength(1);
    expect(run.shots.find((s) => s.id === 9200)).toBeUndefined();
    expect(run.combo).toBe(1);
  });

  it('a normal shot still takes only one hit point from a warden', () => {
    const run = arena();
    const w = alien(run, 'warden', 0, 100);
    hit(run, w);
    expect(w.hp).toBe(1);
  });

  it('home in on aliens spread across the field and kill them', () => {
    const run = arena('missileSwarm');
    const targets = [alien(run, 'drone', -40, 60), alien(run, 'drone', 0, 100), alien(run, 'drone', 40, 60)];
    fireSwarm(run);
    steps(run, 360);
    expect(targets.map((t) => t.hp)).toEqual([0, 0, 0]);
  });

  it('never break the combo, even when they find nothing and leave the field', () => {
    const run = arena('missileSwarm');
    run.aliens = [];
    alien(run, 'drone', -80, SHIP_TOP - 20, { mode: 'free' }); // below the missiles: nothing above
    run.combo = 5;
    const events = fireSwarm(run);
    events.push(...steps(run, 600));
    expect(run.shots.filter((s) => s.kind === 'missile')).toHaveLength(0);
    expect(ofType(events, 'comboBroken')).toEqual([]);
    expect(run.combo).toBe(5);
  });

  it('hit boss parts for 2 damage each', () => {
    const run = createRun(1, 1, 4);
    chooseSpecial(run, 'missileSwarm');
    run.bunkers = [];
    for (let i = 0; i < 1000 && (run.phase !== 'playing' || bossEntering(run.boss!)); i++) steps(run, 1);
    expect(bossEntering(run.boss!)).toBe(false);
    run.stun = 0;
    run.boss!.stun = 1e6;
    run.shots = [];
    const events = fireSwarm(run);
    events.push(...steps(run, 480));
    expect(ofType(events, 'bossPartHit').length).toBeGreaterThan(0);
    // Missiles seek the nearest parts (bays, plates); the shielded core takes nothing.
    const parts = run.boss!.parts.filter((p) => p.kind !== 'core');
    const lost = parts.map((p) => p.maxHp - p.hp);
    expect(lost.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    for (const n of lost) expect(n % 2).toBe(0);
  });

  it('are spent by a bunker like any player shot', () => {
    const run = createRun(1);
    chooseSpecial(run, 'missileSwarm');
    steps(run, Math.ceil(WAVE_INTRO_SECONDS / DT) + 1);
    run.aliens = [];
    anchor(run);
    run.stun = 1e6;
    const bunker = run.bunkers[0];
    run.shots = [playerShot(9300, bunker.x + bunker.width / 2, BUNKER_BOTTOM_Y - 3, { kind: 'missile', damage: 2, vy: 180, volley: VOLLEY_HIT })];
    const events = steps(run, 3);
    expect(ofType(events, 'bunkerHit').length).toBeGreaterThan(0);
    expect(run.shots.find((s) => s.id === 9300)).toBeUndefined();
  });
});

describe('Gravity Well', () => {
  const openWell = (run: RunState) => {
    run.players[0].specialCharge = 1;
    return steps(run, 1, PRESS_SPECIAL);
  };

  it('opens at the ship\'s x, mid-field, and lasts three seconds of real time', () => {
    const run = arena('gravityWell');
    run.players[0].x = -50;
    const events = openWell(run);
    expect(ofType(events, 'specialFired')).toHaveLength(1);
    expect(run.well).toMatchObject({ x: -50, y: 0, playerId: 0 });
    expect(run.well!.timeLeft).toBeCloseTo(WELL_SECONDS - DT, 6);
    steps(run, Math.round((WELL_SECONDS - 0.5) / DT));
    expect(run.well).not.toBeNull();
    steps(run, Math.round(0.6 / DT));
    expect(run.well).toBeNull();
  });

  it('swallows enemy shots before they reach the ship', () => {
    const run = arena('gravityWell');
    openWell(run);
    run.shots = [enemyShot(9400, run.well!.x + 12, 50), enemyShot(9401, run.well!.x - 10, 30)];
    const events = steps(run, 240);
    expect(ofType(events, 'wellConsumed')).toHaveLength(2);
    expect(run.shots.filter((s) => s.owner === 'alien')).toEqual([]);
    expect(ofType(events, 'playerHit').length + ofType(events, 'shieldHit').length).toBe(0);
  });

  it('drags in and grinds a free alien, scoring the kill for the ship without charging the meter', () => {
    const run = arena('gravityWell');
    openWell(run);
    run.stun = 0;
    run.players[0].stats.dropRate = 1e6; // drops are allowed
    const mini = alien(run, 'mini', 35, 40, { mode: 'free', col: -1, row: -1, vx: 0, vy: -20 });
    const before = run.score;
    const events = steps(run, 240);
    expect(ofType(events, 'alienKilled').map((e) => e.alienId)).toContain(mini.id);
    expect(run.score).toBe(before + 10);
    expect(run.aliens.find((a) => a.id === mini.id)).toBeUndefined();
    expect(run.players[0].specialCharge).toBe(0);
    expect(ofType(events, 'pickupSpawned')).toHaveLength(1);
  });

  it('breaks a diver mid-dive out of its dive and grinds it', () => {
    const run = arena('gravityWell');
    openWell(run);
    run.stun = 0;
    const diver = alien(run, 'diver', 40, 40, { mode: 'diving', modeTime: 1, dive: { fromX: 40, fromY: 100, toX: 0 } });
    const events = steps(run, 300);
    expect(ofType(events, 'alienKilled').map((e) => e.alienId)).toContain(diver.id);
  });

  it('leaves aliens in their formation slots and the boss alone', () => {
    const run = arena('gravityWell');
    const slotted = alien(run, 'warden', 0, 0);
    openWell(run);
    steps(run, 200);
    expect(slotted.hp).toBe(2);

    const boss = createRun(1, 1, 4);
    chooseSpecial(boss, 'gravityWell');
    boss.bunkers = [];
    for (let i = 0; i < 1000 && (boss.phase !== 'playing' || bossEntering(boss.boss!)); i++) steps(boss, 1);
    boss.players[0].specialCharge = 1;
    const hp = boss.boss!.parts.map((p) => p.hp);
    steps(boss, 1, PRESS_SPECIAL);
    boss.boss!.stun = 1e6;
    const x = boss.boss!.x;
    steps(boss, 200);
    expect(boss.boss!.parts.map((p) => p.hp)).toEqual(hp);
    expect(boss.boss!.x).toBe(x);
  });

  it('is gone when the next wave starts', () => {
    const run = arena('gravityWell');
    run.phase = 'upgradePick';
    run.offer = ['extraLife'];
    run.well = { x: 0, y: 0, timeLeft: 2, playerId: 0 };
    pickUpgrade(run, 0);
    expect(run.well).toBeNull();
  });

  it('is gone when the wave clears', () => {
    const run = arena('gravityWell');
    run.aliens = [];
    const last = alien(run, 'drone', 0, 100);
    run.well = { x: 80, y: 0, timeLeft: 2, playerId: 0 };
    hit(run, last);
    expect(run.phase).toBe('upgradePick');
    expect(run.well).toBeNull();
  });

  it('is gone when the run is lost', () => {
    const run = arena('gravityWell');
    run.well = { x: 0, y: 0, timeLeft: 2, playerId: 0 };
    run.players[0].lives = 1;
    run.players[0].invulnerable = 0;
    run.shots.push(enemyShot(9500, run.players[0].x, SHIP_TOP + 1));
    // Keep the well from swallowing it: put the well far away.
    run.well.x = 80;
    steps(run, 10);
    expect(run.phase).toBe('lost');
    expect(run.well).toBeNull();
  });

  it('counts down on real time while Time Stop holds the enemies', () => {
    const run = arena('gravityWell');
    openWell(run);
    run.freeze = 5;
    steps(run, 120);
    expect(run.well!.timeLeft).toBeLessThan(WELL_SECONDS - 0.95);
  });
});
