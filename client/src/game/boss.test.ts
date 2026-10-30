import { describe, expect, it } from 'vitest';
import { ALIEN_SPECS, HIT_FLASH_SECONDS } from './aliens';
import {
  BOSS_DESCENT_SPEED,
  BOSS_HALF_HEIGHT,
  BOSS_HALF_WIDTH,
  BOSS_POINTS,
  BOSS_SPEED,
  BOSS_START_Y,
  BOSS_X_LIMIT,
  BOSS_Y,
  BROOD_PARTS,
  FIRE_INTERVAL,
  FIRST_FIRE_DELAY,
  FIRST_LAUNCH_DELAY,
  FREE_MAX_FALL_SPEED,
  LAUNCH_INTERVAL,
  SPREAD_SHOTS,
  beamHitBoss,
  bossBoxes,
  bossDefeated,
  bossEntering,
  bossHealth,
  createBoss,
  damageBossFixed,
  freeAlienGone,
  hitBoss,
  partBox,
  standingParts,
  stepBoss,
  stepFreeAlien,
} from './boss';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { BASE_STATS, SHIP_TOP, SHIP_Y, createPlayer, stepPlayer } from './player';
import { shotBox } from './collision';
import { createRng } from './rng';
import type { BossState, Box, PlayerState, RunEvent, Shot } from './types';
import { NO_INPUT } from './types';

const DT = 1 / 120;

function counter() {
  let n = 1;
  return () => n++;
}

/** A boss that has already landed. */
function landed(newId = counter()): BossState {
  const boss = createBoss('broodMother', newId);
  boss.y = BOSS_Y;
  return boss;
}

const part = (boss: BossState, kind: 'plate' | 'core' | 'bay', index = 0) => boss.parts.filter((p) => p.kind === kind)[index];
const shotAt = (x: number, y: number): Box => ({ x, y, halfWidth: 1, halfHeight: 3 });
/** A shot box just under the centre of a part. */
const under = (boss: BossState, p: { dx: number; dy: number; halfHeight: number }): Box => shotAt(boss.x + p.dx, boss.y + p.dy - p.halfHeight);

function killPlates(boss: BossState) {
  for (const p of standingParts(boss, 'plate')) p.hp = 0;
}

function step(boss: BossState, players: PlayerState[], seconds: number, seed = 1, newId = counter()) {
  const rng = createRng(seed);
  const launched = [];
  const shots: Shot[] = [];
  const events: RunEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    const r = stepBoss(boss, { players, rng, dt: DT, newId });
    launched.push(...r.launched);
    shots.push(...r.shots);
    events.push(...r.events);
  }
  return { launched, shots, events };
}

describe('layout', () => {
  it('has four plates across the front, a core behind the middle and two bays underneath', () => {
    const boss = createBoss('broodMother', counter());
    expect(boss.parts.map((p) => p.kind)).toEqual(['plate', 'plate', 'plate', 'plate', 'core', 'bay', 'bay']);
    expect(boss.parts.filter((p) => p.kind === 'plate').map((p) => p.dx)).toEqual([-39, -13, 13, 39]);
    expect(part(boss, 'core').dx).toBe(0);
    expect(boss.parts.filter((p) => p.kind === 'bay').every((p) => p.dy < part(boss, 'plate').dy - part(boss, 'plate').halfHeight)).toBe(true);
    expect(boss.parts.every((p) => p.hp === p.maxHp && p.hp > 0 && p.flash === 0)).toBe(true);
    expect(new Set(boss.parts.map((p) => p.id)).size).toBe(boss.parts.length);
  });

  it('starts above the field, centred, in phase 1, and fits inside the field when it moves', () => {
    const boss = createBoss('broodMother', counter());
    expect(boss).toMatchObject({ kind: 'broodMother', x: 0, y: BOSS_START_Y, phase: 1, stun: 0 });
    expect(BOSS_START_Y - 20).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(bossEntering(boss)).toBe(true);
    expect(BOSS_X_LIMIT + BOSS_HALF_WIDTH).toBeLessThan(FIELD_WIDTH / 2);
    for (const spec of BROOD_PARTS) expect(Math.abs(spec.dx) + spec.halfWidth).toBeLessThanOrEqual(BOSS_HALF_WIDTH);
  });

  it('gives box positions in field coordinates for the standing parts only', () => {
    const boss = landed();
    boss.x = 10;
    expect(bossBoxes(boss)).toHaveLength(7);
    const plate = part(boss, 'plate', 1);
    expect(partBox(boss, plate)).toEqual({ x: 10 - 13, y: BOSS_Y, halfWidth: plate.halfWidth, halfHeight: plate.halfHeight });
    plate.hp = 0;
    expect(bossBoxes(boss)).toHaveLength(6);
  });
});

describe('hitBoss', () => {
  it('ignores shots while the boss is still descending', () => {
    const boss = createBoss('broodMother', counter());
    expect(hitBoss(boss, under(boss, part(boss, 'plate')), 1)).toBeNull();
  });

  it('hits the plate a shot touches, flashing it', () => {
    const boss = landed();
    const plate = part(boss, 'plate', 3);
    const hit = hitBoss(boss, under(boss, plate), 2);
    expect(hit).toEqual({ part: plate, destroyed: false });
    expect(plate.hp).toBe(plate.maxHp - 2);
    expect(plate.flash).toBe(HIT_FLASH_SECONDS);
  });

  it('reports the hit that destroys a part, and passes through it afterwards', () => {
    const boss = landed();
    const plate = part(boss, 'plate', 0);
    plate.hp = 1;
    expect(hitBoss(boss, under(boss, plate), 1)).toEqual({ part: plate, destroyed: true });
    expect(plate.hp).toBe(0);
    expect(hitBoss(boss, under(boss, plate), 1)).toBeNull();
  });

  it('misses between the parts', () => {
    const boss = landed();
    expect(hitBoss(boss, shotAt(boss.x + 27, boss.y), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x + 80, boss.y), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x, boss.y - 60), 1)).toBeNull();
  });

  it('hits a bay before the plate above it, and bays can always be hit', () => {
    const boss = landed();
    const bay = part(boss, 'bay', 1);
    // x = 28 is under a bay and inside the outer plate's span; the bay is lower, so it is hit first.
    const shot = shotAt(boss.x + bay.dx + 4, boss.y + bay.dy);
    expect(hitBoss(boss, shot, 1)?.part).toBe(bay);
    const plate = part(boss, 'plate', 3);
    expect(plate.hp).toBe(plate.maxHp);
    killPlates(boss);
    expect(hitBoss(boss, shot, 1)?.part).toBe(bay);
  });

  it('shields the core: a shot that reaches it is stopped there, without damage', () => {
    const boss = landed();
    const core = part(boss, 'core');
    const hit = hitBoss(boss, shotAt(boss.x + 1, boss.y), 3);
    expect(hit).toEqual({ part: core, destroyed: false, blocked: true });
    expect(core.hp).toBe(core.maxHp);
    for (const p of standingParts(boss, 'plate')) expect(p.hp).toBe(p.maxHp);

    // Even with the middle plates gone the core stays guarded while an outer plate stands.
    part(boss, 'plate', 1).hp = 0;
    part(boss, 'plate', 2).hp = 0;
    expect(hitBoss(boss, shotAt(boss.x - 2, boss.y), 1)?.blocked).toBe(true);
    expect(core.hp).toBe(core.maxHp);
  });

  it('ignores shots outside the boss without looking at its parts', () => {
    const boss = landed();
    expect(hitBoss(boss, shotAt(boss.x + 80, boss.y), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x, boss.y + 40), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x, boss.y - 40), 1)).toBeNull();
    expect(hitBoss(boss, under(boss, part(boss, 'plate')), 0)).toBeNull();
    for (const p of boss.parts) {
      expect(Math.abs(p.dx) + p.halfWidth).toBeLessThanOrEqual(BOSS_HALF_WIDTH);
      expect(Math.abs(p.dy) + p.halfHeight).toBeLessThanOrEqual(BOSS_HALF_HEIGHT);
    }
  });

  it('exposes the core once every plate is down', () => {
    const boss = landed();
    killPlates(boss);
    const core = part(boss, 'core');
    const hit = hitBoss(boss, shotAt(boss.x, boss.y - 3), 5);
    expect(hit).toEqual({ part: core, destroyed: false });
    expect(core.hp).toBe(core.maxHp - 5);
    core.hp = 3;
    expect(hitBoss(boss, shotAt(boss.x, boss.y), 5)?.destroyed).toBe(true);
    expect(bossDefeated(boss)).toBe(true);
  });
});

describe('beamHitBoss', () => {
  it('stops at the lowest part in its column, and says when the core blocks it', () => {
    const boss = landed();
    const bay = part(boss, 'bay', 1);
    expect(beamHitBoss(boss, boss.x + bay.dx, -100)).toEqual({ part: bay, blocked: false, y: boss.y + bay.dy - bay.halfHeight });

    const plate = part(boss, 'plate', 0);
    expect(beamHitBoss(boss, boss.x + plate.dx, -100)).toEqual({ part: plate, blocked: false, y: boss.y + plate.dy - plate.halfHeight });

    // Between the middle plates only the core is there, and it is shielded.
    const core = part(boss, 'core');
    expect(beamHitBoss(boss, boss.x, -100)).toEqual({ part: core, blocked: true, y: boss.y + core.dy - core.halfHeight });
  });

  it('reaches an exposed core, and passes destroyed parts', () => {
    const boss = landed();
    part(boss, 'plate', 0).hp = 0;
    part(boss, 'bay', 0).hp = 0;
    expect(beamHitBoss(boss, boss.x - 39, -100)).toBeNull();
    killPlates(boss);
    const hit = beamHitBoss(boss, boss.x + 2, -100);
    expect(hit?.part).toBe(part(boss, 'core'));
    expect(hit?.blocked).toBe(false);
  });

  it('misses beside the boss, above where it starts, and while the boss descends', () => {
    const boss = landed();
    expect(beamHitBoss(boss, boss.x + 70, -100)).toBeNull();
    expect(beamHitBoss(boss, boss.x, boss.y + 40)).toBeNull();
    expect(beamHitBoss(createBoss('broodMother', counter()), 0, -100)).toBeNull();
  });

  it('agrees with a shot rising up the same column', () => {
    for (const x of [-39, -28, -13, -5, 0, 5, 13, 28, 39, 60]) {
      const beam = beamHitBoss(landed(), x, -100);
      const boss = landed();
      let shot = null;
      for (let y = -100; y < boss.y + 20 && !shot; y += 1) shot = hitBoss(boss, shotAt(x, y), 1);
      expect(shot?.part.kind ?? null).toBe(beam?.part.kind ?? null);
      expect(shot?.blocked ?? false).toBe(beam?.blocked ?? false);
    }
  });
});

describe('damageBossFixed', () => {
  it('spreads over the standing plates first, leaving the core and bays alone', () => {
    const boss = landed();
    const hits = damageBossFixed(boss, 8);
    expect(hits).toHaveLength(4);
    for (const p of standingParts(boss, 'plate')) expect(p.hp).toBe(p.maxHp - 2);
    expect(part(boss, 'core').hp).toBe(part(boss, 'core').maxHp);
    expect(part(boss, 'bay').hp).toBe(part(boss, 'bay').maxHp);
    expect(hits.every((h) => !h.destroyed && h.part.flash === HIT_FLASH_SECONDS)).toBe(true);
  });

  it('lets what a weak plate cannot take spill over to the others', () => {
    const boss = landed();
    part(boss, 'plate', 0).hp = 1;
    const hits = damageBossFixed(boss, 12);
    expect(part(boss, 'plate', 0).hp).toBe(0);
    expect(hits.find((h) => h.part === part(boss, 'plate', 0))?.destroyed).toBe(true);
    // 12 = 1 + 11: the other three take 3 each, then the last 2 go to the first two of them.
    const hpEach = part(boss, 'plate', 1).maxHp;
    expect(standingParts(boss, 'plate').map((p) => p.hp)).toEqual([hpEach - 4, hpEach - 4, hpEach - 3]);
    expect(part(boss, 'core').hp).toBe(part(boss, 'core').maxHp);
  });

  it('only ever deals whole points, and all of them', () => {
    for (const amount of [1, 2, 3, 7, 13, 50, 99]) {
      const boss = landed();
      part(boss, 'plate', 1).hp = 2;
      const before = boss.parts.reduce((sum, p) => sum + p.hp, 0);
      damageBossFixed(boss, amount);
      expect(boss.parts.every((p) => Number.isInteger(p.hp) && p.hp >= 0)).toBe(true);
      expect(before - boss.parts.reduce((sum, p) => sum + p.hp, 0)).toBe(amount);
    }
    const boss = landed();
    expect(damageBossFixed(boss, 0.9)).toEqual([]);
    expect(damageBossFixed(boss, 3.7).length).toBe(3);
  });

  it('goes on to the core once the plates are gone', () => {
    const boss = landed();
    const plateHp = 4 * part(boss, 'plate').maxHp;
    const hits = damageBossFixed(boss, plateHp + 30);
    expect(standingParts(boss, 'plate')).toHaveLength(0);
    expect(part(boss, 'core').hp).toBe(part(boss, 'core').maxHp - 30);
    expect(hits).toHaveLength(5);
    expect(hits.filter((h) => h.destroyed)).toHaveLength(4);
    expect(damageBossFixed(boss, 5).map((h) => h.part.kind)).toEqual(['core']);
  });

  it('does nothing while the boss is descending', () => {
    const boss = createBoss('broodMother', counter());
    expect(damageBossFixed(boss, 50)).toEqual([]);
  });
});

describe('health', () => {
  it('counts plates and core, not bays', () => {
    const boss = landed();
    expect(bossHealth(boss)).toBe(1);
    part(boss, 'bay', 0).hp = 0;
    expect(bossHealth(boss)).toBe(1);
    killPlates(boss);
    const total = BROOD_PARTS.filter((p) => p.kind !== 'bay').reduce((sum, p) => sum + p.hp, 0);
    expect(bossHealth(boss)).toBeCloseTo(part(boss, 'core').maxHp / total);
    part(boss, 'core').hp = 0;
    expect(bossHealth(boss)).toBe(0);
    expect(bossDefeated(boss)).toBe(true);
  });
});

describe('stepBoss movement', () => {
  const ship = [createPlayer(0, 0)];

  it('descends into place, then does nothing else until it has landed', () => {
    const boss = createBoss('broodMother', counter());
    const { launched, shots } = step(boss, ship, ((BOSS_START_Y - BOSS_Y) / BOSS_DESCENT_SPEED) * 0.9);
    expect(bossEntering(boss)).toBe(true);
    expect(boss.x).toBe(0);
    expect(launched).toHaveLength(0);
    expect(shots).toHaveLength(0);
    step(boss, ship, 1);
    expect(boss.y).toBe(BOSS_Y);
    expect(bossEntering(boss)).toBe(false);
  });

  it('bounces from side to side inside the field, faster in phase 2', () => {
    const boss = landed();
    boss.launchTimer = boss.fireTimer = 1e9;
    let min = 0;
    let max = 0;
    let turns = 0;
    let dir = Math.sign(boss.vx);
    for (let t = 0; t < 30; t += DT) {
      stepBoss(boss, { players: ship, rng: createRng(1), dt: DT, newId: counter() });
      min = Math.min(min, boss.x);
      max = Math.max(max, boss.x);
      if (Math.sign(boss.vx) !== dir) {
        turns++;
        dir = Math.sign(boss.vx);
      }
    }
    expect(max).toBeLessThanOrEqual(BOSS_X_LIMIT);
    expect(min).toBeGreaterThanOrEqual(-BOSS_X_LIMIT);
    expect(max).toBeGreaterThan(BOSS_X_LIMIT - 1);
    expect(min).toBeLessThan(-BOSS_X_LIMIT + 1);
    expect(turns).toBeGreaterThanOrEqual(3);
    expect(Math.abs(boss.vx)).toBe(BOSS_SPEED[1]);

    killPlates(boss);
    stepBoss(boss, { players: ship, rng: createRng(1), dt: DT, newId: counter() });
    expect(Math.abs(boss.vx)).toBe(BOSS_SPEED[2]);
    expect(BOSS_SPEED[2]).toBeGreaterThan(BOSS_SPEED[1]);
  });

  it('flashes decay', () => {
    const boss = landed();
    boss.launchTimer = boss.fireTimer = 1e9;
    part(boss, 'core').flash = HIT_FLASH_SECONDS;
    step(boss, ship, HIT_FLASH_SECONDS + 0.05);
    expect(part(boss, 'core').flash).toBe(0);
  });
});

describe('stepBoss bays', () => {
  const ship = [createPlayer(0, 0)];

  it('launches a free Drone from each standing bay, heading down', () => {
    const boss = landed();
    boss.launchTimer = 0.01;
    boss.fireTimer = 1e9;
    const { launched, events } = step(boss, ship, 0.1);
    expect(launched).toHaveLength(2);
    for (const d of launched) {
      expect(d).toMatchObject({ kind: 'drone', mode: 'free', col: -1, row: -1, hp: 1 });
      expect(d.vy ?? 0).toBeLessThan(0);
      expect(d.y).toBeLessThan(boss.y + part(boss, 'bay').dy);
    }
    expect(launched.map((d) => Math.sign(d.x))).toEqual([-1, 1]);
    expect(events.filter((e) => e.type === 'bossLaunched').map((e) => (e as { alienId: number }).alienId)).toEqual(launched.map((d) => d.id));
  });

  it('launches on a timer: the first after its delay, then every few seconds', () => {
    const boss = landed();
    boss.fireTimer = 1e9;
    const early = step(boss, ship, FIRST_LAUNCH_DELAY - 0.2);
    expect(early.launched).toHaveLength(0);
    const first = step(boss, ship, 0.4);
    expect(first.launched).toHaveLength(2);
    const long = step(boss, ship, 30, 2);
    const waves = long.launched.length / 2;
    expect(waves).toBeGreaterThanOrEqual(30 / (LAUNCH_INTERVAL[1] * 1.15) - 1);
    expect(waves).toBeLessThanOrEqual(30 / (LAUNCH_INTERVAL[1] * 0.85) + 1);
  });

  it('stops launching from a destroyed bay, and from both once they are gone', () => {
    const boss = landed();
    boss.fireTimer = 1e9;
    part(boss, 'bay', 0).hp = 0;
    boss.launchTimer = 0.01;
    const one = step(boss, ship, 0.1);
    expect(one.launched).toHaveLength(1);
    expect(one.launched[0].x).toBeGreaterThan(0);

    part(boss, 'bay', 1).hp = 0;
    const none = step(boss, ship, 40);
    expect(none.launched).toHaveLength(0);
    expect(none.events.filter((e) => e.type === 'bossLaunched')).toHaveLength(0);
  });

  it('launches faster in phase 2', () => {
    const phase1 = landed();
    phase1.fireTimer = 1e9;
    const slow = step(phase1, ship, 40).launched.length;
    const phase2 = landed();
    phase2.fireTimer = 1e9;
    killPlates(phase2);
    const fast = step(phase2, ship, 40).launched.length;
    expect(fast).toBeGreaterThan(slow * 1.3);
  });
});

describe('stepBoss volleys', () => {
  it('fires an aimed pair from the bays in phase 1, toward the ship, and announces it', () => {
    const player = createPlayer(0, -60);
    const boss = landed();
    boss.launchTimer = 1e9;
    boss.fireTimer = 0.01;
    const { shots, events } = step(boss, [player], 0.1);
    expect(shots).toHaveLength(2);
    for (const s of shots) {
      expect(s).toMatchObject({ owner: 'alien', kind: 'enemy', playerId: null, damage: 1, pierceLeft: 0 });
      expect(s.vy).toBeLessThan(0);
      expect(s.vx).toBeLessThan(0);
      expect(s.y).toBeLessThan(boss.y);
    }
    expect(shots[0].x).toBeLessThan(shots[1].x);
    expect(events.filter((e) => e.type === 'bossFired')).toHaveLength(1);
    expect(new Set(shots.map((s) => s.id)).size).toBe(2);
  });

  it('lands the pair either side of a still ship', () => {
    const player = createPlayer(0, 30);
    const boss = landed();
    boss.launchTimer = 1e9;
    boss.fireTimer = 0.01;
    const { shots } = step(boss, [player], 0.1);
    const arrivals = shots.map((s) => s.x + (s.vx * (s.y - SHIP_Y)) / -s.vy);
    expect(arrivals[0]).toBeLessThan(30);
    expect(arrivals[1]).toBeGreaterThan(30);
  });

  it('does not fire with nobody to shoot at', () => {
    const boss = landed();
    boss.launchTimer = 1e9;
    boss.fireTimer = 0.01;
    const dead = createPlayer(0);
    dead.lives = 0;
    expect(step(boss, [dead], 1).shots).toHaveLength(0);
  });

  it('fires faster in phase 2, a five-way spread from the core among the volleys', () => {
    const player = createPlayer(0, 0);
    const boss = landed();
    boss.launchTimer = 1e9;
    killPlates(boss);
    boss.fireTimer = 0.01;
    const run = step(boss, [player], 40, 3);
    const fans = run.events.filter((e) => e.type === 'bossFired').length;
    expect(fans).toBeGreaterThan(40 / (FIRE_INTERVAL[2] * 1.15) - 2);
    expect(run.shots.length).toBeGreaterThanOrEqual(SPREAD_SHOTS);

    const single = landed();
    single.launchTimer = 1e9;
    killPlates(single);
    part(single, 'bay', 0).hp = 0;
    part(single, 'bay', 1).hp = 0;
    single.fireTimer = 0.01;
    const { shots } = step(single, [player], 0.1);
    expect(shots).toHaveLength(SPREAD_SHOTS);
    expect(new Set(shots.map((s) => s.x)).size).toBe(1);
    const vxs = shots.map((s) => s.vx);
    expect([...vxs].sort((a, b) => a - b)).toEqual(vxs);
    expect(vxs[0]).toBeLessThan(0);
    expect(vxs[SPREAD_SHOTS - 1]).toBeGreaterThan(0);
    expect(shots.every((s) => s.vy < 0)).toBe(true);
  });

  it('fires slower in phase 1 than phase 2', () => {
    expect(FIRE_INTERVAL[1]).toBeGreaterThan(FIRE_INTERVAL[2]);
    const boss = landed();
    boss.launchTimer = 1e9;
    const early = step(boss, [createPlayer(0)], FIRST_FIRE_DELAY - 0.2);
    expect(early.shots).toHaveLength(0);
  });
});

describe('phases', () => {
  const ship = [createPlayer(0, 0)];

  it('enters phase 2 once, on the step the last plate falls', () => {
    const boss = landed();
    boss.launchTimer = boss.fireTimer = 1e9;
    for (let i = 0; i < 3; i++) part(boss, 'plate', i).hp = 0;
    expect(step(boss, ship, 0.5).events).toEqual([]);
    expect(boss.phase).toBe(1);

    const last = part(boss, 'plate', 3);
    last.hp = 1;
    expect(hitBoss(boss, under(boss, last), 1)?.destroyed).toBe(true);
    const r = step(boss, ship, 0.5);
    expect(boss.phase).toBe(2);
    expect(r.events).toEqual([{ type: 'bossPhase', phase: 2 }]);
    expect(step(boss, ship, 0.5).events).toEqual([]);
  });

  it('brings the next launch and volley forward so phase 2 starts promptly', () => {
    const boss = landed();
    killPlates(boss);
    const r = step(boss, ship, 1.5, 4);
    expect(r.launched.length).toBeGreaterThan(0);
    expect(r.shots.length).toBeGreaterThan(0);
  });

  it('also goes to phase 2 when a Pulse Bomb strips the plates', () => {
    const boss = landed();
    damageBossFixed(boss, 4 * part(boss, 'plate').maxHp);
    expect(step(boss, ship, DT * 2).events).toEqual([{ type: 'bossPhase', phase: 2 }]);
  });
});

describe('stun', () => {
  it('freezes movement, launches and volleys, then resumes', () => {
    const player = createPlayer(0, 0);
    const boss = landed();
    boss.x = 5;
    boss.launchTimer = 0.01;
    boss.fireTimer = 0.01;
    boss.stun = 2;
    const frozen = step(boss, [player], 1.9);
    expect(boss.x).toBe(5);
    expect(frozen.launched).toHaveLength(0);
    expect(frozen.shots).toHaveLength(0);
    expect(boss.stun).toBeGreaterThan(0);

    const after = step(boss, [player], 0.5);
    expect(boss.stun).toBe(0);
    expect(boss.x).not.toBe(5);
    expect(after.launched.length).toBeGreaterThan(0);
    expect(after.shots.length).toBeGreaterThan(0);
  });

  it('still announces a phase change, and still lets flashes fade', () => {
    const boss = landed();
    boss.stun = 1;
    killPlates(boss);
    part(boss, 'core').flash = HIT_FLASH_SECONDS;
    const r = step(boss, [createPlayer(0)], 0.5);
    expect(r.events).toEqual([{ type: 'bossPhase', phase: 2 }]);
    expect(part(boss, 'core').flash).toBe(0);
  });
});

describe('free Drones', () => {
  function launchOne(shipX: number) {
    const player = createPlayer(0, shipX);
    const boss = landed();
    boss.fireTimer = 1e9;
    boss.launchTimer = 0.01;
    part(boss, 'bay', 1).hp = 0;
    const { launched } = step(boss, [player], 0.1, 7);
    return launched[0];
  }

  it('fly down and toward the ship, whichever side it is on', () => {
    for (const shipX of [-70, 70]) {
      const drone = launchOne(shipX);
      const startX = drone.x;
      const startY = drone.y;
      for (let t = 0; t < 1.5; t += DT) stepFreeAlien(drone, shipX, DT);
      expect(drone.y).toBeLessThan(startY - 40);
      expect(Math.sign(drone.x - startX)).toBe(Math.sign(shipX - startX));
      expect(Math.abs(drone.x - shipX)).toBeLessThan(Math.abs(startX - shipX));
    }
  });

  it('speed up to a cap, and hold their course close to the ship', () => {
    const drone = launchOne(0);
    for (let t = 0; t < 2; t += DT) stepFreeAlien(drone, 0, DT);
    expect(drone.vy).toBe(-FREE_MAX_FALL_SPEED);

    const late = launchOne(0);
    late.y = SHIP_TOP + 30;
    late.x = 20;
    late.vx = 5;
    stepFreeAlien(late, -80, 0.5);
    expect(late.vx).toBe(5);
  });

  it('count down their flash and clock, with no target needed', () => {
    const drone = launchOne(0);
    drone.flash = HIT_FLASH_SECONDS;
    stepFreeAlien(drone, null, 0.1);
    expect(drone.flash).toBe(0);
    expect(drone.modeTime).toBeGreaterThan(0);
  });

  it('are gone once they leave the bottom or the side of the field', () => {
    const drone = launchOne(0);
    drone.x = 0;
    drone.y = 0;
    expect(freeAlienGone(drone)).toBe(false);
    drone.y = -FIELD_HEIGHT / 2 + 2;
    expect(freeAlienGone(drone)).toBe(false);
    drone.y = -FIELD_HEIGHT / 2 - ALIEN_SPECS.drone.halfHeight - 1;
    expect(freeAlienGone(drone)).toBe(true);
    drone.y = 0;
    drone.x = FIELD_WIDTH;
    expect(freeAlienGone(drone)).toBe(true);
  });

  it('always leave the field in the end', () => {
    const drone = launchOne(-30);
    let t = 0;
    while (!freeAlienGone(drone) && t < 20) {
      stepFreeAlien(drone, -30, DT);
      t += DT;
    }
    expect(freeAlienGone(drone)).toBe(true);
    expect(t).toBeLessThan(8);
  });
});

describe('determinism', () => {
  it('plays out the same way from the same seed, and differently from another', () => {
    const play = (seed: number) => {
      const boss = createBoss('broodMother', counter());
      const players = [createPlayer(0, 25)];
      const r = step(boss, players, 25, seed);
      return JSON.stringify({ boss, launched: r.launched, shots: r.shots, events: r.events });
    };
    expect(play(5)).toBe(play(5));
    expect(play(5)).not.toBe(play(6));
  });
});

describe('points', () => {
  it('rewards the core most and a plate least', () => {
    expect(BOSS_POINTS.core).toBeGreaterThan(BOSS_POINTS.bay);
    expect(BOSS_POINTS.bay).toBeGreaterThan(BOSS_POINTS.plate);
    expect(BOSS_POINTS.plate).toBeGreaterThan(0);
  });
});

/**
 * A scripted shooter under the boss: it steers beneath the standing plate nearest to it (the core
 * when they're all down), leading its aim for the boss's drift, and holds fire. Shots that hit
 * are spent; enemy shots and Drones are ignored (the ship can't be hurt), but Drones are stepped
 * so their code runs. Returns how long the fight took from landing, in seconds.
 */
function fight(opts: { fireInterval: number; shotsPerVolley: number; damage?: number; maxSeconds: number }) {
  const rng = createRng(11);
  const newId = counter();
  const boss = createBoss('broodMother', newId);
  const player = createPlayer(0);
  player.stats = { ...BASE_STATS, fireInterval: opts.fireInterval, shotsPerVolley: opts.shotsPerVolley, damage: opts.damage ?? 1 };
  let shots: Shot[] = [];
  let drones = [] as ReturnType<typeof step>['launched'];
  let landedAt: number | null = null;
  const phases: number[] = [];

  for (let t = 0; t < opts.maxSeconds; t += DT) {
    if (landedAt === null && !bossEntering(boss)) landedAt = t;
    const standing = standingParts(boss, 'plate');
    const goal = standing.length > 0 ? standing : standingParts(boss, 'core');
    let aimX = player.x;
    if (goal.length > 0) {
      const flight = (boss.y - SHIP_TOP) / player.stats.shotSpeed;
      let best = goal[0];
      for (const p of goal) if (Math.abs(boss.x + p.dx - player.x) < Math.abs(boss.x + best.dx - player.x)) best = p;
      aimX = boss.x + best.dx + boss.vx * flight;
    }
    const move = Math.max(-1, Math.min(1, (aimX - player.x) / 4));
    const input = { ...NO_INPUT, move, fire: !bossEntering(boss) && Math.abs(aimX - player.x) < 3 };
    stepPlayer(player, input, DT);
    if (input.fire && player.cooldown <= 0) {
      player.cooldown = player.stats.fireInterval;
      for (let i = 0; i < player.stats.shotsPerVolley; i++) {
        shots.push({
          id: newId(), owner: 'player', kind: 'normal', playerId: 0,
          x: player.x + (i - (player.stats.shotsPerVolley - 1) / 2) * 4, y: SHIP_TOP, vx: 0, vy: player.stats.shotSpeed,
          pierceLeft: 0, damage: player.stats.damage, homing: 0, bouncesLeft: 0, hits: 0, volley: 0,
        });
      }
    }

    const r = stepBoss(boss, { players: [player], rng, dt: DT, newId });
    drones.push(...r.launched);
    for (const e of r.events) if (e.type === 'bossPhase') phases.push(e.phase);
    for (const d of drones) stepFreeAlien(d, player.x, DT);
    drones = drones.filter((d) => !freeAlienGone(d));

    const kept: Shot[] = [];
    for (const s of shots) {
      s.y += s.vy * DT;
      if (hitBoss(boss, shotBox(s), s.damage)) continue;
      if (s.y < FIELD_HEIGHT / 2 + 4) kept.push(s);
    }
    shots = kept;
    if (bossDefeated(boss)) return { seconds: t - (landedAt ?? 0), boss, phases, drones };
  }
  return { seconds: Infinity, boss, phases, drones };
}

describe('a simulated fight', () => {
  it('lasts about a minute for a ship with a couple of upgrades', () => {
    // Rapid fire (x0.65 interval) and a second shot per volley.
    const { seconds, phases, boss } = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 200 });
            expect(bossDefeated(boss)).toBe(true);
    expect(phases).toEqual([2]);
    // A bot that never misses its aim or dodges; a person takes longer, so this sits at the short end.
    expect(seconds).toBeGreaterThan(25);
    expect(seconds).toBeLessThan(60);
  });

  it('is slower, but still beatable, for an unupgraded ship', () => {
    const base = fight({ fireInterval: BASE_STATS.fireInterval, shotsPerVolley: 1, maxSeconds: 300 });
    const upgraded = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 300 });
    expect(base.seconds).toBeLessThan(160);
    expect(base.seconds).toBeGreaterThan(upgraded.seconds * 1.5);
    expect(base.seconds).toBeGreaterThan(45);
  });
});
