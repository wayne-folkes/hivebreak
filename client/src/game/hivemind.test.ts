import { describe, expect, it } from 'vitest';
import { HIT_FLASH_SECONDS } from './aliens';
import {
  BOSS_POINTS,
  beamHitBoss,
  bossBoxes,
  bossDefeated,
  bossEntering,
  bossHealth,
  createBoss,
  damageBossFixed,
  hitBoss,
  partBox,
  standingParts,
  stepBoss,
  stepFreeAlien,
} from './boss';
import { shotBox } from './collision';
import {
  HIVE_BEAM,
  HIVE_BEAM_AIM_OFFSET,
  HIVE_CORE_HP,
  HIVE_CORE_RADIUS,
  HIVE_DRIFT_SPEED,
  HIVE_PHASE_2_AT,
  HIVE_PHASE_3_AT,
  HIVE_RING_INNER,
  HIVE_RING_OUTER,
  HIVE_RING_RADIUS,
  HIVE_RING_SPEED,
  HIVE_SEGMENT_ARC,
  HIVE_SEGMENT_COUNT,
  HIVE_SEGMENT_HP,
  HIVE_SEGMENT_SPACING,
  HIVE_SHOT_SPEED,
  HIVE_SPIRAL,
  HIVE_START_Y,
  HIVE_X_LIMIT,
  HIVE_Y,
  beamCrossX,
  beamBunkerContacts,
  beamHitsBox,
  segmentAngle,
  segmentAt,
} from './hivemind';
import { createBunkers, erodeColumn } from './bunkers';
import { FIELD_HEIGHT } from './playfield';
import { BASE_STATS, SHIP_TOP, SHIP_Y, createPlayer, stepPlayer } from './player';
import { createRng } from './rng';
import type { BossBeam, BossState, Box, PlayerState, RunEvent, Shot } from './types';
import { NO_INPUT } from './types';

const DT = 1 / 120;

function counter() {
  let n = 1;
  return () => n++;
}

/** A Hive Mind that has already landed. */
function landed(newId = counter()): BossState {
  const boss = createBoss('hiveMind', newId);
  boss.y = HIVE_Y;
  return boss;
}

/** Landed and at the core health where `phase` begins, with the phase change already played out. */
function inPhase(phase: 1 | 2 | 3, newId = counter()): BossState {
  const boss = landed(newId);
  const core = coreOf(boss);
  if (phase === 2) core.hp = AT_2;
  if (phase === 3) core.hp = AT_3;
  const ship = [createPlayer(0)];
  for (let i = 0; i < phase; i++) stepBoss(boss, { players: ship, rng: createRng(1), dt: DT, newId });
  expect(boss.phase).toBe(phase);
  return boss;
}

const coreOf = (boss: BossState) => boss.parts[HIVE_SEGMENT_COUNT];
const segments = (boss: BossState) => boss.parts.slice(0, HIVE_SEGMENT_COUNT);
const shotAt = (x: number, y: number): Box => ({ x, y, halfWidth: 1, halfHeight: 3 });
const DEG = Math.PI / 180;
/** The core health where each phase begins (exact fractions of the core's hit points). */
const AT_2 = Math.floor(HIVE_CORE_HP * HIVE_PHASE_2_AT + 1e-9);
const AT_3 = Math.floor(HIVE_CORE_HP * HIVE_PHASE_3_AT + 1e-9);

/** A ship under the boss, at x. */
function shipAt(x: number): PlayerState {
  const p = createPlayer(0);
  p.x = x;
  return p;
}

function step(boss: BossState, players: PlayerState[], seconds: number, seed = 1, newId = counter()) {
  const rng = createRng(seed);
  const launched: ReturnType<typeof stepBoss>['launched'] = [];
  const shots: Shot[] = [];
  const events: RunEvent[] = [];
  const shattered: ReturnType<typeof stepBoss>['shattered'] = [];
  for (let t = 0; t < seconds; t += DT) {
    const r = stepBoss(boss, { players, rng, dt: DT, newId });
    launched.push(...r.launched);
    shots.push(...r.shots);
    events.push(...r.events);
    shattered.push(...r.shattered);
  }
  return { launched, shots, events, shattered };
}

/** Flies a shot straight up the column x from below the boss; returns what it hits first. */
function fly(boss: BossState, x: number) {
  for (let y = boss.y - 60; y < boss.y + 40; y += 1.5) {
    const hit = hitBoss(boss, shotAt(x, y), 1);
    if (hit) return hit;
  }
  return null;
}

describe('layout', () => {
  it('has eight ring segments in order, then the core', () => {
    const boss = createBoss('hiveMind', counter());
    expect(boss.parts.map((p) => p.kind)).toEqual([...Array(8).fill('segment'), 'core']);
    expect(boss.parts.every((p) => p.hp === p.maxHp && p.hp > 0 && p.flash === 0)).toBe(true);
    expect(new Set(boss.parts.map((p) => p.id)).size).toBe(9);
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP);
    expect(segments(boss).every((p) => p.hp === HIVE_SEGMENT_HP)).toBe(true);
    expect(coreOf(boss)).toMatchObject({ dx: 0, dy: 0 });
  });

  it('puts the segments 45 degrees apart on the ring, each 30 degrees of arc, with 15-degree gaps', () => {
    const boss = createBoss('hiveMind', counter());
    expect(HIVE_SEGMENT_SPACING).toBeCloseTo(45 * DEG, 10);
    expect(HIVE_SEGMENT_ARC).toBeCloseTo(30 * DEG, 10);
    segments(boss).forEach((p, i) => {
      expect(Math.hypot(p.dx, p.dy)).toBeCloseTo(HIVE_RING_RADIUS, 6);
      expect(Math.atan2(p.dy, p.dx)).toBeCloseTo(Math.atan2(Math.sin(i * 45 * DEG), Math.cos(i * 45 * DEG)), 6);
    });
    expect(HIVE_RING_OUTER - HIVE_RING_INNER).toBe(6);
    expect(HIVE_CORE_RADIUS).toBeLessThan(HIVE_RING_INNER);
  });

  it('starts above the field, centred, in phase 1, with the ring state in place', () => {
    const boss = createBoss('hiveMind', counter());
    expect(boss).toMatchObject({ kind: 'hiveMind', x: 0, y: HIVE_START_Y, phase: 1, stun: 0, ringAngle: 0, beams: [] });
    expect(HIVE_START_Y - HIVE_RING_OUTER).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(bossEntering(boss)).toBe(true);
    expect(bossEntering(landed())).toBe(false);
    expect(HIVE_Y).toBe(64);
  });

  it('gives box positions in field coordinates for the standing parts only', () => {
    const boss = landed();
    boss.x = 10;
    expect(bossBoxes(boss)).toHaveLength(9);
    const seg = boss.parts[2];
    expect(partBox(boss, seg)).toEqual({ x: 10 + seg.dx, y: HIVE_Y + seg.dy, halfWidth: seg.halfWidth, halfHeight: seg.halfHeight });
    seg.hp = 0;
    expect(bossBoxes(boss)).toHaveLength(8);
  });
});

describe('descent', () => {
  it('descends to its landing height, turning the ring on the way, and takes no damage meanwhile', () => {
    const boss = createBoss('hiveMind', counter());
    expect(hitBoss(boss, shotAt(boss.x, boss.y), 1)).toBeNull();
    expect(beamHitBoss(boss, 0, -100)).toBeNull();
    expect(damageBossFixed(boss, 50)).toEqual([]);
    step(boss, [shipAt(0)], 1);
    expect(boss.y).toBeLessThan(HIVE_START_Y);
    expect(boss.ringAngle).toBeGreaterThan(0);
    step(boss, [shipAt(0)], 6);
    expect(boss.y).toBe(HIVE_Y);
    expect(bossEntering(boss)).toBe(false);
  });

  it('neither fires nor launches until it has landed', () => {
    const boss = createBoss('hiveMind', counter());
    const { shots, launched } = step(boss, [shipAt(0)], 2);
    expect(bossEntering(boss)).toBe(true);
    expect(shots).toHaveLength(0);
    expect(launched).toHaveLength(0);
  });
});

describe('the turning ring', () => {
  it('moves the segment offsets with the ring angle, keeping their radius', () => {
    const boss = landed();
    step(boss, [shipAt(0)], 1.5);
    expect(boss.ringAngle).not.toBe(0);
    segments(boss).forEach((p, i) => {
      const a = segmentAngle(boss, i);
      expect(p.dx).toBeCloseTo(Math.cos(a) * HIVE_RING_RADIUS, 6);
      expect(p.dy).toBeCloseTo(Math.sin(a) * HIVE_RING_RADIUS, 6);
    });
  });

  it('turns at the phase 1 speed, and faster in phase 2', () => {
    const slow = landed();
    step(slow, [shipAt(0)], 1);
    expect(slow.ringAngle).toBeCloseTo(HIVE_RING_SPEED[1], 1);
    const fast = inPhase(2);
    fast.ringAngle = 0;
    fast.ringTimer = 99;
    step(fast, [shipAt(0)], 1.5);
    expect(Math.abs(fast.ringAngle ?? 0)).toBeGreaterThan(HIVE_RING_SPEED[1] * 1.5 * 1.3);
  });

  it('reverses now and then in phase 2, slowing through zero', () => {
    const boss = inPhase(2);
    const dirs = new Set<number>();
    let slowest = Infinity;
    const rng = createRng(3);
    const ship = [shipAt(0)];
    for (let t = 0; t < 30; t += DT) {
      stepBoss(boss, { players: ship, rng, dt: DT, newId: counter() });
      dirs.add(Math.sign(boss.ringSpeed ?? 0));
      slowest = Math.min(slowest, Math.abs(boss.ringSpeed ?? 0));
    }
    expect(dirs.has(1) && dirs.has(-1)).toBe(true);
    expect(slowest).toBeLessThan(0.1);
  });

  it('keeps the ring angle bounded', () => {
    const boss = landed();
    step(boss, [shipAt(0)], 30);
    expect(Math.abs(boss.ringAngle ?? 0)).toBeLessThanOrEqual(Math.PI * 2);
  });
});

describe('hits on the ring and core', () => {
  it('damages the standing segment whose arc a shot lands on, flashing it', () => {
    const boss = landed();
    const seg = boss.parts[6]; // at -90 degrees, straight under the core, with the ring at angle 0
    const hit = hitBoss(boss, shotAt(boss.x + seg.dx, boss.y + seg.dy), 2);
    expect(hit).toEqual({ part: seg, destroyed: false });
    expect(seg.hp).toBe(HIVE_SEGMENT_HP - 2);
    expect(seg.flash).toBe(HIT_FLASH_SECONDS);
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP);
  });

  it('reports the hit that destroys a segment', () => {
    const boss = landed();
    const seg = boss.parts[6];
    seg.hp = 1;
    expect(hitBoss(boss, shotAt(boss.x + seg.dx, boss.y + seg.dy), 1)).toEqual({ part: seg, destroyed: true });
    expect(seg.hp).toBe(0);
  });

  it('lets a shot through a gap, and the core takes it', () => {
    const boss = landed();
    boss.ringAngle = 22.5 * DEG; // a gap straight under the core
    const hit = fly(boss, boss.x);
    expect(hit?.part).toBe(coreOf(boss));
    expect(hit?.blocked).toBeUndefined();
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP - 1);
    expect(segments(boss).every((p) => p.hp === HIVE_SEGMENT_HP)).toBe(true);
  });

  it('stops a shot at the ring where a segment is, so the core is never touched', () => {
    const boss = landed();
    boss.ringAngle = 0; // a segment straight under the core
    const hit = fly(boss, boss.x);
    expect(hit?.part).toBe(boss.parts[6]);
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP);
  });

  it('does the same for every ring angle: the core is hit only when the column lines up with a gap', () => {
    for (let a = 0; a < 45; a += 3) {
      const boss = landed();
      boss.ringAngle = a * DEG;
      const hit = fly(boss, boss.x);
      const bottom = ((((-90 - a) % 45) + 45) % 45); // degrees past a segment centre, 0 to 45
      const inGap = Math.abs(bottom - 22.5) < 7.5 - 2; // clear of the gap's edges (shot width)
      const onSegment = Math.abs(bottom - 22.5) > 7.5 + 4;
      if (inGap) expect(hit?.part.kind).toBe('core');
      if (onSegment) expect(hit?.part.kind).toBe('segment');
    }
  });

  it('opens a wider gap when a segment is destroyed', () => {
    const boss = landed();
    const width = (): number => {
      // The angle range around straight down that no standing segment covers, scanned in half degrees.
      let n = 0;
      for (let a = -150; a <= -30; a += 0.5) if (!segmentAt(boss, a * DEG, 0)) n += 0.5;
      return n;
    };
    expect(Math.abs(width() - 2 * 15)).toBeLessThanOrEqual(1); // two gaps of 15 degrees in that 120-degree sweep
    boss.parts[6].hp = 0;
    expect(Math.abs(width() - (2 * 15 + 30))).toBeLessThanOrEqual(1);
    // A shot that was stopped at the destroyed segment's edge now reaches the core.
    boss.ringAngle = 0;
    const edge = boss.x + Math.cos(-100 * DEG) * HIVE_RING_RADIUS;
    expect(fly(boss, edge)?.part).toBe(coreOf(boss));
  });

  it('misses beside and above the ring', () => {
    const boss = landed();
    expect(hitBoss(boss, shotAt(boss.x + 60, boss.y), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x, boss.y - 60), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x, boss.y + 60), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(boss.x + 16, boss.y), 1)).toBeNull(); // between the core and the ring
  });

  it('ignores zero damage and shots while the ring is shattered only reach the core', () => {
    const boss = landed();
    expect(hitBoss(boss, shotAt(boss.x, boss.y), 0)).toBeNull();
    for (const s of segments(boss)) s.hp = 0;
    for (const a of [0, 40, 100, 200, 300]) {
      const x = boss.x + Math.cos(a * DEG) * HIVE_RING_RADIUS;
      const y = boss.y + Math.sin(a * DEG) * HIVE_RING_RADIUS;
      expect(hitBoss(boss, shotAt(x, y), 1)).toBeNull();
    }
    expect(hitBoss(boss, shotAt(boss.x, boss.y - 5), 1)?.part).toBe(coreOf(boss));
  });

  it('only counts the core as destroyed, not the segments', () => {
    const boss = landed();
    for (const s of segments(boss)) s.hp = 0;
    expect(bossDefeated(boss)).toBe(false);
    coreOf(boss).hp = 0;
    expect(bossDefeated(boss)).toBe(true);
  });
});

describe('beamHitBoss (the laser)', () => {
  it('stops at the segment in its column, or reaches the core through a gap, never blocked', () => {
    const boss = landed();
    boss.ringAngle = 0;
    const seg = beamHitBoss(boss, boss.x, -100);
    expect(seg?.part).toBe(boss.parts[6]);
    expect(seg?.blocked).toBe(false);
    expect(seg?.y).toBeGreaterThan(boss.y - HIVE_RING_OUTER - 3);
    expect(seg?.y).toBeLessThan(boss.y - HIVE_RING_INNER + 3);

    boss.ringAngle = 22.5 * DEG;
    const core = beamHitBoss(boss, boss.x, -100);
    expect(core?.part).toBe(coreOf(boss));
    expect(core?.blocked).toBe(false);
    expect(core?.y).toBeLessThan(boss.y);
    expect(core?.y).toBeGreaterThan(boss.y - HIVE_CORE_RADIUS - 3);
  });

  it('misses beside the boss, above where it starts, and while the boss descends', () => {
    const boss = landed();
    expect(beamHitBoss(boss, boss.x + 50, -100)).toBeNull();
    expect(beamHitBoss(boss, boss.x, boss.y + 60)).toBeNull();
    expect(beamHitBoss(createBoss('hiveMind', counter()), 0, -100)).toBeNull();
  });

  it('agrees with a shot rising up the same column', () => {
    for (let x = -30; x <= 30; x += 3) {
      const a = landed();
      a.ringAngle = 0.4;
      const b = landed();
      b.ringAngle = 0.4;
      const beam = beamHitBoss(a, x, -100);
      const shot = fly(b, x);
      // A shot has a size the laser does not, so only compare where both are clear-cut.
      if (beam && shot && beam.part.kind === 'core') expect(shot.part.kind).toBe('core');
      if (!beam) expect(Math.abs(x)).toBeGreaterThan(HIVE_RING_OUTER - 4);
    }
  });
});

describe('damageBossFixed (Pulse Bomb)', () => {
  it('shares whole points between the standing segments first, leaving the core', () => {
    const boss = landed();
    const hits = damageBossFixed(boss, 12);
    expect(hits).toHaveLength(8);
    expect(hits.every((h) => h.part.kind === 'segment' && !h.destroyed)).toBe(true);
    expect(segments(boss).map((p) => HIVE_SEGMENT_HP - p.hp)).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP);
    expect(segments(boss).every((p) => p.flash === HIT_FLASH_SECONDS)).toBe(true);
  });

  it('spills what the segments cannot take over to the core, in whole numbers', () => {
    const boss = landed();
    boss.parts[0].hp = 1;
    const total = HIVE_SEGMENT_HP * 7 + 1 + 13;
    const hits = damageBossFixed(boss, total + 0.9);
    expect(hits).toHaveLength(9);
    expect(new Set(hits.map((h) => h.part)).size).toBe(9);
    expect(segments(boss).every((p) => p.hp === 0)).toBe(true);
    const spilled = 13;
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP - spilled);
    expect(Number.isInteger(coreOf(boss).hp)).toBe(true);
  });

  it('goes straight to the core when the ring is gone, and ignores nonsense amounts', () => {
    const boss = landed();
    for (const s of segments(boss)) s.hp = 0;
    expect(damageBossFixed(boss, 10)).toEqual([{ part: coreOf(boss), destroyed: false }]);
    expect(coreOf(boss).hp).toBe(HIVE_CORE_HP - 10);
    expect(damageBossFixed(boss, 0.5)).toEqual([]);
    expect(damageBossFixed(boss, -4)).toEqual([]);
    expect(damageBossFixed(boss, 1000)[0].destroyed).toBe(true);
    expect(coreOf(boss).hp).toBe(0);
  });
});

describe('health and points', () => {
  it('reports the core as the health bar, not the ring', () => {
    const boss = landed();
    expect(bossHealth(boss)).toBe(1);
    boss.parts[0].hp = 0;
    expect(bossHealth(boss)).toBe(1);
    coreOf(boss).hp = HIVE_CORE_HP / 2;
    expect(bossHealth(boss)).toBeCloseTo(0.5, 10);
    coreOf(boss).hp = 0;
    expect(bossHealth(boss)).toBe(0);
  });

  it('scores a segment between a plate and the core', () => {
    expect(BOSS_POINTS.segment).toBeGreaterThan(BOSS_POINTS.plate);
    expect(BOSS_POINTS.segment).toBeLessThan(BOSS_POINTS.core);
  });
});

describe('phases', () => {
  const ship = () => [shipAt(0)];

  it('stays in phase 1 above two thirds and enters phase 2 at two thirds, with a bossPhase event', () => {
    const boss = landed();
    coreOf(boss).hp = AT_2 + 1;
    expect(step(boss, ship(), 0.1).events.filter((e) => e.type === 'bossPhase')).toEqual([]);
    expect(boss.phase).toBe(1);
    coreOf(boss).hp = AT_2;
    const { events } = step(boss, ship(), 0.1);
    expect(events.filter((e) => e.type === 'bossPhase')).toEqual([{ type: 'bossPhase', phase: 2 }]);
    expect(boss.phase).toBe(2);
    // ...and it does not repeat.
    expect(step(boss, ship(), 0.5).events.filter((e) => e.type === 'bossPhase')).toEqual([]);
  });

  it('enters phase 3 at one third, announcing it once', () => {
    const boss = inPhase(2);
    coreOf(boss).hp = AT_3 + 1;
    expect(step(boss, ship(), 0.1).events.filter((e) => e.type === 'bossPhase')).toEqual([]);
    coreOf(boss).hp = AT_3;
    const { events } = step(boss, ship(), 0.1);
    expect(events.filter((e) => e.type === 'bossPhase')).toEqual([{ type: 'bossPhase', phase: 3 }]);
    expect(boss.phase).toBe(3);
    expect(boss.phaseTime).toBeGreaterThan(0);
  });

  it('goes through phase 2 on the way when the core drops two thresholds at once', () => {
    const boss = landed();
    coreOf(boss).hp = 10;
    const { events } = step(boss, ship(), 0.1);
    expect(events.filter((e) => e.type === 'bossPhase')).toEqual([
      { type: 'bossPhase', phase: 2 },
      { type: 'bossPhase', phase: 3 },
    ]);
  });

  it('does not change phase because of segments alone', () => {
    const boss = landed();
    for (const s of segments(boss)) s.hp = 0;
    step(boss, ship(), 1);
    expect(boss.phase).toBe(1);
  });
});

describe('phase 1: aimed shots through the gaps', () => {
  it('fires an aimed shot about every 1.6 s, from the core toward the ship, only through a gap', () => {
    const boss = landed();
    const players = [shipAt(40)];
    const rng = createRng(5);
    const newId = counter();
    const fired: number[] = [];
    for (let t = 0; t < 30; t += DT) {
      const ringBefore = boss.ringAngle;
      const r = stepBoss(boss, { players, rng, dt: DT, newId });
      for (const s of r.shots) {
        fired.push(t);
        expect(ringBefore).toBeDefined();
        expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(HIVE_SHOT_SPEED, 6);
        expect(s.vy).toBeLessThan(0);
        expect(s.vx).toBeGreaterThan(0); // the ship is off to the right
        expect(Math.hypot(s.x - boss.x, s.y - boss.y)).toBeCloseTo(HIVE_CORE_RADIUS, 6);
        expect(segmentAt(boss, Math.atan2(s.vy, s.vx), 0)).toBeNull();
        expect(s.owner).toBe('alien');
        expect(r.events).toContainEqual({ type: 'bossFired', x: s.x, y: s.y });
      }
    }
    expect(fired.length).toBeGreaterThan(30 / 2.6);
    expect(fired.length).toBeLessThan(30 / 1.3);
  });

  it('holds the shot while a segment is in the way, and fires once a gap lines up', () => {
    const boss = landed();
    boss.fireTimer = 0;
    boss.ringAngle = 0; // a segment right under the core, the ship is straight down
    boss.ringSpeed = 0;
    const players = [shipAt(boss.x)];
    const rng = createRng(1);
    const newId = counter();
    const first = stepBoss(boss, { players, rng, dt: DT, newId });
    expect(first.shots).toHaveLength(0);
    let steps = 0;
    let shot: Shot | undefined;
    while (!shot && steps < 4 * 120) {
      shot = stepBoss(boss, { players, rng, dt: DT, newId }).shots[0];
      steps++;
    }
    expect(shot).toBeDefined();
    expect(steps).toBeGreaterThan(5);
    expect(segmentAt(boss, Math.atan2(shot!.vy, shot!.vx), 0)).toBeNull();
  });

  it('fires nothing and launches nothing in phase 1 without a ship, and never launches or beams', () => {
    const boss = landed();
    const { shots } = step(boss, [], 5);
    expect(shots).toHaveLength(0);
    const { launched, events } = step(landed(), [shipAt(0)], 20);
    expect(launched).toHaveLength(0);
    expect(events.filter((e) => e.type === 'bossBeam')).toHaveLength(0);
  });
});

describe('phase 2: beams and Divers', () => {
  it('telegraphs a beam for 1.2 s, then fires it for 0.6 s, with bossBeam events', () => {
    const boss = inPhase(2);
    const rng = createRng(2);
    const newId = counter();
    const players = [shipAt(0)];
    boss.ringTimer = 99;
    const log: { t: number; e: RunEvent }[] = [];
    for (let t = 0; t < 8; t += DT) {
      const r = stepBoss(boss, { players, rng, dt: DT, newId });
      for (const e of r.events) if (e.type === 'bossBeam') log.push({ t, e });
    }
    const warns = log.filter((l) => l.e.type === 'bossBeam' && l.e.state === 'warn');
    const fires = log.filter((l) => l.e.type === 'bossBeam' && l.e.state === 'fire');
    expect(warns.length).toBeGreaterThanOrEqual(1);
    expect(fires.length).toBe(warns.length);
    // The first fire comes one warning after the first warn.
    expect(fires[0].t - warns[0].t).toBeCloseTo(HIVE_BEAM.warn[2], 1);
    expect(log.map((l) => (l.e as { state: string }).state)[0]).toBe('warn');
  });

  it('aims a beam near the ship, holds the dashed line still while warning, then sweeps while firing', () => {
    const boss = inPhase(2);
    boss.beamTimer = 0;
    boss.ringTimer = 99;
    const players = [shipAt(30)];
    const rng = createRng(4);
    const newId = counter();
    const first = stepBoss(boss, { players, rng, dt: DT, newId });
    const beams = boss.beams as BossBeam[];
    expect(beams.length === 1 || beams.length === 2).toBe(true);
    const aim = Math.atan2(SHIP_Y - boss.y, 30 - boss.x);
    for (const b of beams) {
      expect(b.state).toBe('warn');
      expect(b.timeLeft).toBeLessThanOrEqual(HIVE_BEAM.warn[2]);
      const off = Math.abs(b.angle - aim);
      expect(off).toBeGreaterThanOrEqual(HIVE_BEAM_AIM_OFFSET.min - 1e-9);
      expect(off).toBeLessThanOrEqual(HIVE_BEAM_AIM_OFFSET.max + 1e-9);
      expect(Math.sign(b.sweep)).toBe(-Math.sign(b.angle - aim)); // sweeps back toward the ship
    }
    expect(first.events.filter((e) => e.type === 'bossBeam')).toHaveLength(beams.length);

    const warnAngles = beams.map((b) => b.angle);
    for (let t = 0; t < 1.0; t += DT) stepBoss(boss, { players, rng, dt: DT, newId });
    expect(beams.map((b) => b.angle)).toEqual(warnAngles);
    for (let t = 0; t < 0.4 && beams.every((b) => b.state === 'warn'); t += DT) stepBoss(boss, { players, rng, dt: DT, newId });
    expect(beams.every((b) => b.state === 'fire')).toBe(true);
    const fireStart = beams.map((b) => b.angle);
    for (let t = 0; t < 0.3; t += DT) stepBoss(boss, { players, rng, dt: DT, newId });
    beams.forEach((b, i) => expect(Math.abs(b.angle - fireStart[i])).toBeCloseTo(Math.abs(b.sweep) * 0.3, 1));
  });

  it('removes the beams after they fire, then waits before the next wave', () => {
    const boss = inPhase(2);
    boss.beamTimer = 0;
    boss.ringTimer = 99;
    const players = [shipAt(0)];
    const rng = createRng(6);
    const newId = counter();
    stepBoss(boss, { players, rng, dt: DT, newId });
    let t = 0;
    while ((boss.beams?.length ?? 0) > 0 && t < 5) {
      stepBoss(boss, { players, rng, dt: DT, newId });
      t += DT;
    }
    expect(t).toBeGreaterThan(HIVE_BEAM.warn[2] + HIVE_BEAM.fire[2] - 0.05);
    expect(t).toBeLessThan(HIVE_BEAM.warn[2] + HIVE_BEAM.fire[2] + 0.1);
    // The pause: nothing new for a while.
    for (let u = 0; u < HIVE_BEAM.gap[2] * 0.8; u += DT) {
      stepBoss(boss, { players, rng, dt: DT, newId });
      expect(boss.beams).toHaveLength(0);
    }
  });

  it('sends one beam at times and two at others', () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const boss = inPhase(2);
      boss.beamTimer = 0;
      stepBoss(boss, { players: [shipAt(0)], rng: createRng(seed), dt: DT, newId: counter() });
      counts.add(boss.beams?.length ?? 0);
    }
    expect([...counts].sort()).toEqual([1, 2]);
  });

  it('launches a pair of Divers as free aliens about every 5 s', () => {
    const boss = inPhase(2);
    const { launched, events } = step(boss, [shipAt(0)], 22, 8);
    expect(launched.length % 2).toBe(0);
    expect(launched.length / 2).toBeGreaterThanOrEqual(3);
    expect(launched.length / 2).toBeLessThanOrEqual(5);
    for (const d of launched) {
      expect(d).toMatchObject({ kind: 'diver', mode: 'free', col: -1, row: -1, hp: 1 });
      expect(d.vy).toBeLessThan(0);
      expect(d.y).toBeLessThan(boss.y);
      expect(events).toContainEqual({ type: 'bossLaunched', alienId: d.id });
    }
    expect(launched[0].x).toBeLessThan(boss.x);
    expect(launched[1].x).toBeGreaterThan(boss.x);
    // They fly like any free alien.
    const diver = launched[0];
    const y = diver.y;
    stepFreeAlien(diver, 0, 0.1);
    expect(diver.y).toBeLessThan(y);
  });

  it('does not move the boss sideways in phases 1 and 2', () => {
    const boss = inPhase(2);
    step(boss, [shipAt(70)], 5);
    expect(boss.x).toBe(0);
  });
});

describe('phase 3: the ring shatters and the core hunts', () => {
  it('shatters the standing segments the step phase 3 begins, reporting them', () => {
    const boss = inPhase(2);
    boss.parts[3].hp = 0; // already destroyed: not reported again
    coreOf(boss).hp = AT_3;
    const r = stepBoss(boss, { players: [shipAt(0)], rng: createRng(1), dt: DT, newId: counter() });
    expect(r.events).toContainEqual({ type: 'bossPhase', phase: 3 });
    expect(r.shattered).toHaveLength(7);
    expect(r.shattered.every((p) => p.kind === 'segment' && p.hp === 0)).toBe(true);
    expect(r.shattered).not.toContain(boss.parts[3]);
    expect(standingParts(boss, 'segment')).toHaveLength(0);
    expect(step(boss, [shipAt(0)], 1).shattered).toHaveLength(0);
    // With the ring gone every shot at the core lands.
    expect(hitBoss(boss, shotAt(boss.x, boss.y - 12), 1)?.part).toBe(coreOf(boss));
  });

  it('drifts toward the ship at a capped speed, within its limit', () => {
    const boss = inPhase(3);
    const x0 = boss.x;
    step(boss, [shipAt(70)], 1);
    expect(boss.x - x0).toBeGreaterThan(HIVE_DRIFT_SPEED * 0.8);
    expect(boss.x - x0).toBeLessThanOrEqual(HIVE_DRIFT_SPEED * 1.02);
    step(boss, [shipAt(-70)], 30);
    expect(boss.x).toBeGreaterThanOrEqual(-HIVE_X_LIMIT);
    expect(boss.x).toBeLessThan(-HIVE_X_LIMIT + 1);
    // It settles over a ship it has reached instead of overshooting.
    const target = shipAt(-30);
    step(boss, [target], 10);
    expect(Math.abs(boss.x - target.x)).toBeLessThan(1);
  });

  it('fires a slowly turning spiral that never aims upward', () => {
    const boss = inPhase(3);
    const { shots } = step(boss, [shipAt(0)], 6);
    expect(shots.length).toBeGreaterThan(6 / HIVE_SPIRAL.interval);
    for (const s of shots) {
      expect(s.vy).toBeLessThanOrEqual(0);
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(HIVE_SPIRAL.speed, 6);
    }
    // Later ticks use different angles: the directions are spread, not repeated.
    const dirs = new Set(shots.map((s) => Math.round(Math.atan2(s.vy, s.vx) * 20)));
    expect(dirs.size).toBeGreaterThan(8);
  });

  it('keeps firing beams, faster', () => {
    const boss = inPhase(3);
    boss.beamTimer = 0;
    const rng = createRng(3);
    const newId = counter();
    stepBoss(boss, { players: [shipAt(0)], rng, dt: DT, newId });
    expect(boss.beams!.length).toBeGreaterThan(0);
    expect(boss.beams![0].timeLeft).toBeLessThanOrEqual(HIVE_BEAM.warn[3]);
    expect(HIVE_BEAM.warn[3]).toBeLessThan(HIVE_BEAM.warn[2]);
    expect(Math.abs(boss.beams![0].sweep)).toBeCloseTo(HIVE_BEAM.sweep[3], 10);
    expect(HIVE_BEAM.sweep[3]).toBeGreaterThan(HIVE_BEAM.sweep[2]);
    expect(HIVE_BEAM.gap[3]).toBeLessThan(HIVE_BEAM.gap[2]);
    const { events, launched } = step(boss, [shipAt(0)], 8);
    expect(events.filter((e) => e.type === 'bossBeam').length).toBeGreaterThan(2);
    expect(launched).toHaveLength(0);
  });
});

describe('beamHitsBox', () => {
  const fireBeam = (boss: BossState, angle: number, state: BossBeam['state'] = 'fire') => {
    boss.beams = [{ angle, sweep: 0, state, timeLeft: 0.5 }];
  };
  const box = (x: number, y: number, halfWidth = 8, halfHeight = 7): Box => ({ x, y, halfWidth, halfHeight });

  it('hits a box on a firing beam, straight down from the core', () => {
    const boss = landed();
    fireBeam(boss, -Math.PI / 2);
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(true);
    expect(beamHitsBox(boss, box(9, SHIP_Y), [])).toBe(true); // within the box's half width plus the beam's
    expect(beamHitsBox(boss, box(11, SHIP_Y), [])).toBe(false);
    expect(beamHitsBox(boss, box(-11, SHIP_Y), [])).toBe(false);
  });

  it('follows an angled beam and the boss when it moves', () => {
    const boss = landed();
    fireBeam(boss, -Math.PI / 4);
    expect(beamHitsBox(boss, box(60, HIVE_Y - 60), [])).toBe(true);
    expect(beamHitsBox(boss, box(60, HIVE_Y - 30), [])).toBe(false);
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(false);
    boss.x = -40;
    expect(beamHitsBox(boss, box(20, HIVE_Y - 60), [])).toBe(true);
  });

  it('does not reach behind the core or past a box beside the line', () => {
    const boss = landed();
    fireBeam(boss, -Math.PI / 2);
    expect(beamHitsBox(boss, box(0, HIVE_Y + 60), [])).toBe(false);
    expect(beamHitsBox(boss, box(40, SHIP_Y), [])).toBe(false);
    fireBeam(boss, 0); // along +x
    expect(beamHitsBox(boss, box(50, HIVE_Y), [])).toBe(true);
    expect(beamHitsBox(boss, box(-50, HIVE_Y), [])).toBe(false);
    expect(beamHitsBox(boss, box(50, HIVE_Y + 12), [])).toBe(false);
  });

  it('ignores a beam that is only warning, a stunned boss, a defeated one and an empty list', () => {
    const boss = landed();
    fireBeam(boss, -Math.PI / 2, 'warn');
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(false);
    fireBeam(boss, -Math.PI / 2);
    boss.stun = 1;
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(false);
    boss.stun = 0;
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(true);
    coreOf(boss).hp = 0;
    expect(beamHitsBox(boss, box(0, SHIP_Y), [])).toBe(false);
    boss.beams = [];
    expect(beamHitsBox(landed(), box(0, SHIP_Y), [])).toBe(false);
    expect(beamHitsBox(createBoss('broodMother', counter()), box(0, SHIP_Y), [])).toBe(false);
  });

  it('checks every firing beam, and crosses a height at the right x', () => {
    const boss = landed();
    boss.beams = [
      { angle: -Math.PI / 2 - 0.5, sweep: 0, state: 'warn', timeLeft: 1 },
      { angle: -Math.PI / 2 + 0.5, sweep: 0, state: 'fire', timeLeft: 1 },
    ];
    const x = beamCrossX(boss, boss.beams[1], SHIP_Y)!;
    expect(x).toBeCloseTo((SHIP_Y - HIVE_Y) / Math.tan(-Math.PI / 2 + 0.5), 6);
    expect(beamHitsBox(boss, box(x, SHIP_Y), [])).toBe(true);
    expect(beamHitsBox(boss, box(-x, SHIP_Y), [])).toBe(false); // the warning beam is harmless
    expect(beamCrossX(boss, boss.beams[1], HIVE_Y + 30)).toBeNull(); // behind the core
    expect(beamCrossX(boss, { angle: 0, sweep: 0, state: 'fire', timeLeft: 1 }, SHIP_Y)).toBeNull();
  });
});

describe('beams and bunkers', () => {
  const box = (x: number, y: number): Box => ({ x, y, halfWidth: 8, halfHeight: 7 });
  const fireDown = (boss: BossState) => {
    boss.beams = [{ angle: -Math.PI / 2, sweep: 0, state: 'fire', timeLeft: 0.5 }];
  };

  it('shelters a ship behind a solid bunker pixel, but not one beside the bunker', () => {
    const bunkers = createBunkers(counter());
    const b = bunkers[0];
    const boss = landed();
    boss.x = b.x + b.width / 2;
    fireDown(boss);
    expect(beamHitsBox(boss, box(boss.x, SHIP_Y), [])).toBe(true);
    expect(beamHitsBox(boss, box(boss.x, SHIP_Y), bunkers)).toBe(false);
    // A ship above the bunker is still in the beam.
    expect(beamHitsBox(boss, box(boss.x, b.y + b.height + 12), bunkers)).toBe(true);
    // Between bunkers nothing shelters it.
    boss.x = 0;
    expect(beamHitsBox(boss, box(0, SHIP_Y), bunkers)).toBe(true);
  });

  it('lets the beam through once it has eroded a hole', () => {
    const bunkers = createBunkers(counter());
    const b = bunkers[0];
    const boss = landed();
    boss.x = b.x + b.width / 2;
    fireDown(boss);
    let stepsToBore = 0;
    while (!beamHitsBox(boss, box(boss.x, SHIP_Y), bunkers) && stepsToBore < 100) {
      for (const c of beamBunkerContacts(boss, bunkers)) erodeColumn(bunkers, c.x, c.y, 4);
      stepsToBore++;
    }
    expect(stepsToBore).toBeGreaterThan(1);
    expect(stepsToBore).toBeLessThan(40);
  });

  it('lists where each firing beam meets a bunker, once per beam, reusing the array', () => {
    const bunkers = createBunkers(counter());
    const b = bunkers[0];
    const boss = landed();
    boss.x = b.x + b.width / 2;
    boss.beams = [
      { angle: -Math.PI / 2, sweep: 0, state: 'fire', timeLeft: 0.5 },
      { angle: -Math.PI / 2, sweep: 0, state: 'warn', timeLeft: 0.5 },
    ];
    const out: ReturnType<typeof beamBunkerContacts> = [];
    const got = beamBunkerContacts(boss, bunkers, out);
    expect(got).toBe(out);
    expect(got).toHaveLength(1);
    expect(got[0].beam).toBe(0);
    expect(got[0].x).toBeCloseTo(boss.x, 6);
    expect(got[0].y).toBeLessThanOrEqual(b.y + b.height + 0.5);
    expect(got[0].y).toBeGreaterThanOrEqual(b.y + b.height - 1.5);
    expect(beamBunkerContacts(boss, [], out)).toHaveLength(0);
    boss.stun = 1;
    expect(beamBunkerContacts(boss, bunkers, out)).toHaveLength(0);
  });

  it('works for an angled beam', () => {
    const bunkers = createBunkers(counter());
    const b = bunkers[1];
    const boss = landed();
    const tx = b.x + b.width / 2;
    const ty = b.y + b.height - 1;
    boss.beams = [{ angle: Math.atan2(ty - boss.y, tx - boss.x), sweep: 0, state: 'fire', timeLeft: 0.5 }];
    const [c] = beamBunkerContacts(boss, bunkers);
    expect(c).toBeDefined();
    expect(Math.hypot(c.x - tx, c.y - ty)).toBeLessThan(6);
  });
});

describe('stun', () => {
  it('freezes the ring, shots, beams and Divers, counting the stun down', () => {
    const boss = inPhase(2);
    boss.beamTimer = 0;
    boss.launchTimer = 0;
    boss.ringTimer = 99;
    boss.stun = 1;
    const ringAngle = boss.ringAngle;
    const x = boss.x;
    const { shots, launched, events } = step(boss, [shipAt(0)], 0.9);
    expect(boss.ringAngle).toBe(ringAngle);
    expect(boss.x).toBe(x);
    expect(boss.beams).toHaveLength(0);
    expect([shots.length, launched.length, events.length]).toEqual([0, 0, 0]);
    expect(boss.stun).toBeGreaterThan(0);
    expect(boss.stun).toBeLessThan(0.15);
    // Then it carries on.
    const after = step(boss, [shipAt(0)], 1);
    expect(boss.stun).toBe(0);
    expect(boss.ringAngle).not.toBe(ringAngle);
    expect(after.launched.length).toBe(2);
    expect(boss.beams!.length).toBeGreaterThan(0);
  });

  it('holds beams that were already out, and holds the phase 3 drift and spiral', () => {
    const boss = inPhase(2);
    boss.beams = [{ angle: -1.5, sweep: 0.3, state: 'fire', timeLeft: 0.4 }];
    boss.stun = 0.5;
    step(boss, [shipAt(0)], 0.4);
    expect(boss.beams[0]).toMatchObject({ angle: -1.5, timeLeft: 0.4 });

    const hunter = inPhase(3);
    hunter.stun = 1;
    const { shots } = step(hunter, [shipAt(60)], 0.9);
    expect(shots).toHaveLength(0);
    expect(hunter.x).toBe(0);
  });

  it('still changes phase (the bomb that stuns it can also hurt it)', () => {
    const boss = landed();
    boss.stun = 1;
    coreOf(boss).hp = AT_2;
    expect(step(boss, [shipAt(0)], 0.05).events).toContainEqual({ type: 'bossPhase', phase: 2 });
  });
});

describe('time scaling', () => {
  it('does half as much in half the time', () => {
    const a = landed();
    const b = landed();
    const rng = createRng(1);
    const ship = [shipAt(0)];
    for (let i = 0; i < 240; i++) stepBoss(a, { players: ship, rng, dt: DT, newId: counter() });
    for (let i = 0; i < 240; i++) stepBoss(b, { players: ship, rng, dt: DT / 2, newId: counter() });
    expect(b.ringAngle! / a.ringAngle!).toBeCloseTo(0.5, 1);
  });
});

describe('determinism', () => {
  it('plays the same for the same seed and inputs', () => {
    const run = () => {
      const boss = createBoss('hiveMind', counter());
      const out = step(boss, [shipAt(25)], 12, 9);
      coreOf(boss).hp = 55;
      const more = step(boss, [shipAt(-25)], 15, 9);
      return JSON.stringify({ boss, out, more });
    };
    expect(run()).toBe(run());
  });

  it('differs between seeds once it starts choosing', () => {
    const run = (seed: number) => {
      const boss = inPhase(2);
      return JSON.stringify(step(boss, [shipAt(25)], 12, seed).events);
    };
    expect(run(1)).not.toBe(run(2));
  });
});

/**
 * A scripted shooter under the Hive Mind: it stays under the core and holds fire, so shots meet
 * the ring and some pass through gaps. It never dodges (the ship can't be hurt). Returns how
 * long the fight took from landing, in seconds.
 */
function fight(opts: { fireInterval: number; shotsPerVolley: number; damage?: number; maxSeconds: number; useBomb?: boolean }) {
  const rng = createRng(11);
  const newId = counter();
  const boss = createBoss('hiveMind', newId);
  const player = createPlayer(0);
  player.stats = { ...BASE_STATS, fireInterval: opts.fireInterval, shotsPerVolley: opts.shotsPerVolley, damage: opts.damage ?? 1 };
  let shots: Shot[] = [];
  let landedAt: number | null = null;
  const phases: number[] = [];
  /** Seconds after landing when each phase began (phase 1 at 0). */
  const phaseTimes: number[] = [0];
  let shattered = 0;

  for (let t = 0; t < opts.maxSeconds; t += DT) {
    if (landedAt === null && !bossEntering(boss)) landedAt = t;
    // Follow the core, leading it a little in phase 3 when it drifts.
    const aimX = boss.x + boss.vx * ((boss.y - SHIP_TOP) / player.stats.shotSpeed);
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
    shattered += r.shattered.length;
    for (const e of r.events) {
      if (e.type !== 'bossPhase') continue;
      phases.push(e.phase);
      phaseTimes.push(t - (landedAt ?? 0));
    }

    const kept: Shot[] = [];
    for (const s of shots) {
      s.y += s.vy * DT;
      if (hitBoss(boss, shotBox(s), s.damage)) continue;
      if (s.y < FIELD_HEIGHT / 2 + 4) kept.push(s);
    }
    shots = kept;
    if (bossDefeated(boss)) return { seconds: t - (landedAt ?? 0), boss, phases, phaseTimes, shattered };
  }
  return { seconds: Infinity, boss, phases, phaseTimes, shattered };
}

describe('a simulated fight', () => {
  it('lasts about half a minute for a perfect bot with a couple of upgrades, through all three phases', () => {
    // Rapid fire (x0.65 interval) and a second shot per volley.
    const { seconds, phases, phaseTimes, boss } = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 300 });
    expect(bossDefeated(boss)).toBe(true);
    expect(phases).toEqual([2, 3]);
    // The ring is the first thing to go; the phases come in order with the first the longest.
    expect(phaseTimes[1]).toBeGreaterThan(10);
    expect(phaseTimes[2]).toBeGreaterThan(phaseTimes[1] + 5);
    expect(seconds).toBeGreaterThan(phaseTimes[2] + 5);
    expect(seconds).toBeGreaterThan(28);
    expect(seconds).toBeLessThan(90);
  });

  it('is slower, but still beatable, for an unupgraded ship', () => {
    const base = fight({ fireInterval: BASE_STATS.fireInterval, shotsPerVolley: 1, maxSeconds: 400 });
    const upgraded = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 400 });
    expect(base.seconds).toBeLessThan(220);
    expect(base.seconds).toBeGreaterThan(upgraded.seconds * 1.3);
  });
});
