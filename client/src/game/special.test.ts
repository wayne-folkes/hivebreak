import { describe, expect, it } from 'vitest';
import { createAlien } from './aliens';
import { SHIP_TOP, SHIP_Y, createPlayer } from './player';
import { createRun } from './run';
import { VOLLEY_HIT } from './scoring';
import {
  BURST_SECONDS,
  CHARGE_PER_BOSS_PART,
  CHARGE_PER_KILL,
  MISSILE_COUNT,
  MISSILE_DAMAGE,
  MISSILE_FAN,
  MISSILE_HOMING,
  MISSILE_SPEED,
  PULSE_BOSS_DAMAGE,
  PULSE_STUN_SECONDS,
  SPECIALS,
  SPECIAL_IDS,
  TIME_STOP_SECONDS,
  chargeSpecial,
  fireSpecial,
  isBursting,
  killCharge,
  reflectShot,
  reflectShots,
  tickBurst,
} from './special';
import { WELL_SECONDS, WELL_WALL_MARGIN } from './well';
import { FIELD_WIDTH } from './playfield';
import type { BossState, RunState, Shot, SpecialId } from './types';

function playingRun(special: SpecialId | null = 'pulseBomb', charge = 1): RunState {
  const run = createRun(3);
  run.phase = 'playing';
  const p = run.players[0];
  p.special = special;
  p.specialCharge = charge;
  return run;
}

const enemyShot = (id: number, x: number, y: number, vx = 20): Shot => ({
  id,
  owner: 'alien',
  kind: 'enemy',
  playerId: null,
  x,
  y,
  vx,
  vy: -90,
  pierceLeft: 0,
  damage: 1,
  homing: 0,
  bouncesLeft: 0,
  hits: 0,
  volley: id,
});

describe('SPECIALS', () => {
  it('describes each Special for the choice card', () => {
    expect(SPECIAL_IDS).toEqual(['pulseBomb', 'shieldBurst', 'timeStop', 'missileSwarm', 'gravityWell']);
    for (const id of SPECIAL_IDS) {
      expect(SPECIALS[id].name.length).toBeGreaterThan(0);
      expect(SPECIALS[id].description.endsWith('.')).toBe(true);
    }
  });
});

describe('chargeSpecial', () => {
  it('gives a kill more at a higher combo', () => {
    expect(killCharge(1)).toBeCloseTo(0.07, 9);
    expect(killCharge(5)).toBeCloseTo(0.07 * 1.6, 9);
    expect(CHARGE_PER_KILL).toBe(0.07);
    expect(CHARGE_PER_BOSS_PART).toBe(0.25);
  });

  it('adds to the meter and says specialReady once, when it fills', () => {
    const p = createPlayer(0);
    p.special = 'timeStop';
    expect(chargeSpecial(p, 0.4)).toEqual([]);
    expect(chargeSpecial(p, 0.4)).toEqual([]);
    expect(chargeSpecial(p, 0.4)).toEqual([{ type: 'specialReady', playerId: 0 }]);
    expect(p.specialCharge).toBe(1);
    expect(chargeSpecial(p, 0.4)).toEqual([]);
    expect(p.specialCharge).toBe(1);
  });

  it('fills from a string of kills without stopping a hair short', () => {
    const p = createPlayer(0);
    p.special = 'pulseBomb';
    let ready = 0;
    for (let i = 0; i < 100 && p.specialCharge < 1; i++) ready += chargeSpecial(p, killCharge(1)).length;
    expect(ready).toBe(1);
    expect(p.specialCharge).toBe(1);
  });

  it('Overclock multiplies the gain, and the Battery top-up can skip it', () => {
    const p = createPlayer(0);
    p.special = 'pulseBomb';
    p.stats.chargeRate = 1.3;
    chargeSpecial(p, 0.1);
    expect(p.specialCharge).toBeCloseTo(0.13, 9);
    chargeSpecial(p, 0.1, false);
    expect(p.specialCharge).toBeCloseTo(0.23, 9);
  });

  it('Overclock still says specialReady once, when the scaled gain fills the meter', () => {
    const p = createPlayer(0);
    p.special = 'timeStop';
    p.stats.chargeRate = 1.3;
    p.specialCharge = 0.8;
    expect(chargeSpecial(p, 0.2)).toEqual([{ type: 'specialReady', playerId: 0 }]);
    expect(p.specialCharge).toBe(1);
    expect(chargeSpecial(p, 0.2)).toEqual([]);
  });

  it('does nothing before a Special is chosen', () => {
    const p = createPlayer(0);
    expect(chargeSpecial(p, 0.5)).toEqual([]);
    expect(p.specialCharge).toBe(0);
  });
});

describe('fireSpecial', () => {
  it('does nothing with no Special, a half-empty meter, a dead ship or outside play', () => {
    for (const make of [
      () => playingRun(null, 1),
      () => playingRun('pulseBomb', 0.99),
      () => {
        const run = playingRun();
        run.players[0].lives = 0;
        return run;
      },
      () => {
        const run = playingRun();
        run.phase = 'waveIntro';
        return run;
      },
    ]) {
      const run = make();
      const charge = run.players[0].specialCharge;
      const result = fireSpecial(run, run.players[0]);
      expect(result.events).toEqual([]);
      expect(result.hits).toEqual([]);
      expect(run.players[0].specialCharge).toBe(charge);
      expect(run.stun + run.freeze).toBe(0);
    }
  });

  it('empties the meter and announces the Special', () => {
    const run = playingRun('timeStop');
    const { events } = fireSpecial(run, run.players[0]);
    expect(run.players[0].specialCharge).toBe(0);
    expect(events).toEqual([{ type: 'specialFired', playerId: 0, special: 'timeStop', x: run.players[0].x, y: SHIP_Y }]);
    expect(fireSpecial(run, run.players[0]).events).toEqual([]);
  });

  describe('pulse bomb', () => {
    it('clears enemy shots but not the ship\'s, damages every alien, stuns, and blasts', () => {
      const run = playingRun('pulseBomb');
      const [first, second] = run.aliens;
      first.kind = 'warden';
      first.hp = 2;
      second.kind = 'carrier';
      second.hp = 4;
      const total = run.aliens.length;
      run.shots = [enemyShot(500, 0, 0), { ...enemyShot(501, 5, 5), owner: 'player', kind: 'normal', playerId: 0 }];
      const result = fireSpecial(run, run.players[0]);

      expect(run.shots.map((s) => s.id)).toEqual([501]);
      expect(result.hits).toHaveLength(total);
      expect(result.hits.find((h) => h.alien === first)?.killed).toBe(true);
      expect(result.hits.find((h) => h.alien === second)?.killed).toBe(false);
      expect(second.hp).toBe(2);
      expect(run.aliens.filter((a) => a.hp <= 0).length).toBe(total - 1);
      expect(run.stun).toBe(PULSE_STUN_SECONDS);
      expect(result.bossDamage).toBe(0);
      expect(result.events.map((e) => e.type)).toEqual(['specialFired', 'blast']);
    });

    it('stuns the boss and reports its fixed damage', () => {
      const run = playingRun('pulseBomb');
      run.aliens = [];
      run.boss = { kind: 'broodMother', x: 0, y: 100, vx: 0, phase: 1, phaseTime: 0, parts: [], launchTimer: 1, fireTimer: 1, stun: 0 } as BossState;
      const result = fireSpecial(run, run.players[0]);
      expect(result.bossDamage).toBe(PULSE_BOSS_DAMAGE);
      expect(run.boss.stun).toBe(PULSE_STUN_SECONDS);
    });
  });

  describe('time stop', () => {
    it('freezes the enemies', () => {
      const run = playingRun('timeStop');
      const result = fireSpecial(run, run.players[0]);
      expect(run.freeze).toBe(TIME_STOP_SECONDS);
      expect(result.hits).toEqual([]);
    });
  });

  describe('shield burst', () => {
    it('makes the ship untouchable for the burst, and the burst runs down', () => {
      const run = playingRun('shieldBurst');
      const p = run.players[0];
      fireSpecial(run, p);
      expect(p.burst).toBe(BURST_SECONDS);
      expect(p.invulnerable).toBeGreaterThanOrEqual(BURST_SECONDS);
      expect(isBursting(p)).toBe(true);
      tickBurst(p, 2);
      expect(p.burst).toBe(1);
      tickBurst(p, 5);
      expect(p.burst).toBe(0);
      expect(isBursting(p)).toBe(false);
    });
  });
});

describe('missile swarm', () => {
  it('launches eight missiles from the nose, fanned about 60 degrees either side of straight up', () => {
    const run = playingRun('missileSwarm');
    const p = run.players[0];
    p.x = 25;
    run.shots = [];
    const result = fireSpecial(run, p);
    expect(result.events.map((e) => e.type)).toEqual(['specialFired']);
    expect(result.hits).toEqual([]);
    expect(run.shots).toHaveLength(MISSILE_COUNT);
    expect(MISSILE_COUNT).toBe(8);
    const angles = run.shots.map((s) => Math.atan2(s.vx, s.vy));
    expect(angles[0]).toBeCloseTo(-MISSILE_FAN, 6);
    expect(angles[7]).toBeCloseTo(MISSILE_FAN, 6);
    expect(MISSILE_FAN).toBeCloseTo(Math.PI / 3, 9);
    for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeGreaterThan(angles[i - 1]);
    // Evenly spread, symmetric about straight up.
    expect(angles[3] + angles[4]).toBeCloseTo(0, 9);
    for (const s of run.shots) {
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(MISSILE_SPEED, 6);
      expect(s.x).toBe(25);
      expect(s.y).toBe(SHIP_TOP);
    }
  });

  it('makes homing, 2-damage, non-piercing, non-bouncing missiles that can never be a miss', () => {
    const run = playingRun('missileSwarm');
    run.shots = [];
    fireSpecial(run, run.players[0]);
    expect(new Set(run.shots.map((s) => s.id)).size).toBe(MISSILE_COUNT);
    for (const s of run.shots) {
      expect(s).toMatchObject({
        owner: 'player',
        kind: 'missile',
        playerId: 0,
        damage: MISSILE_DAMAGE,
        homing: MISSILE_HOMING,
        pierceLeft: 0,
        bouncesLeft: 0,
        hits: 0,
        volley: VOLLEY_HIT,
      });
    }
    expect([MISSILE_DAMAGE, MISSILE_HOMING, MISSILE_SPEED]).toEqual([2, 6, 180]);
  });

  it('ignores the ship\'s own piercing, homing and bounces', () => {
    const run = playingRun('missileSwarm');
    Object.assign(run.players[0].stats, { pierce: 3, ricochet: 2, homing: 9, damage: 4 });
    run.shots = [];
    fireSpecial(run, run.players[0]);
    expect(run.shots.every((s) => s.pierceLeft === 0 && s.bouncesLeft === 0 && s.homing === MISSILE_HOMING && s.damage === 2)).toBe(true);
  });
});

describe('gravity well', () => {
  it('opens a three-second well at the ship\'s x, mid-field, owned by the ship', () => {
    const run = playingRun('gravityWell');
    run.players[0].x = 40;
    const result = fireSpecial(run, run.players[0]);
    expect(result.events.map((e) => e.type)).toEqual(['specialFired']);
    expect(run.well).toEqual({ x: 40, y: 0, timeLeft: WELL_SECONDS, playerId: 0 });
    expect(WELL_SECONDS).toBe(3);
  });

  it('keeps the well inside the field when the ship is by a wall', () => {
    const run = playingRun('gravityWell');
    run.players[0].x = FIELD_WIDTH / 2 - 8;
    fireSpecial(run, run.players[0]);
    expect(run.well!.x).toBe(FIELD_WIDTH / 2 - WELL_WALL_MARGIN);
    const left = playingRun('gravityWell');
    left.players[0].x = -(FIELD_WIDTH / 2 - 8);
    fireSpecial(left, left.players[0]);
    expect(left.well!.x).toBe(-(FIELD_WIDTH / 2 - WELL_WALL_MARGIN));
  });

  it('touches nothing else: no aliens, shots or clocks', () => {
    const run = playingRun('gravityWell');
    const shots = run.shots.length;
    const hp = run.aliens.map((a) => a.hp);
    fireSpecial(run, run.players[0]);
    expect(run.shots).toHaveLength(shots);
    expect(run.aliens.map((a) => a.hp)).toEqual(hp);
    expect(run.stun + run.freeze).toBe(0);
  });
});

describe('reflectShot', () => {
  it('turns an enemy shot into the ship\'s own, going up', () => {
    const shot = enemyShot(7, 10, 0, 30);
    reflectShot(shot, 1);
    expect(shot).toMatchObject({ owner: 'player', kind: 'reflected', playerId: 1, vx: -30, volley: VOLLEY_HIT, hits: 0 });
    expect(shot.vy).toBeGreaterThan(0);
  });
});

describe('reflectShots', () => {
  it('reflects only the enemy shots touching a bursting ship', () => {
    const run = playingRun('shieldBurst', 0);
    const p = run.players[0];
    p.burst = 2;
    run.shots = [enemyShot(1, p.x, SHIP_TOP - 2), enemyShot(2, p.x + 60, SHIP_TOP - 2), enemyShot(3, p.x, SHIP_TOP + 60)];
    const events = reflectShots(run);
    expect(events).toEqual([{ type: 'shotReflected', x: p.x, y: SHIP_TOP - 2 }]);
    expect(run.shots.map((s) => s.kind)).toEqual(['reflected', 'enemy', 'enemy']);
    expect(run.shots[0].owner).toBe('player');
  });

  it('does nothing when no ship is bursting', () => {
    const run = playingRun(null, 0);
    run.shots = [enemyShot(1, run.players[0].x, SHIP_TOP - 2)];
    expect(reflectShots(run)).toEqual([]);
    expect(run.shots[0].kind).toBe('enemy');
  });
});

describe('a carrier next to the rest', () => {
  it('survives one pulse bomb with half its hit points', () => {
    const run = playingRun('pulseBomb');
    run.aliens = [createAlien('carrier', 99, 0, 0, 0, 80)];
    fireSpecial(run, run.players[0]);
    expect(run.aliens[0].hp).toBe(2);
  });
});
