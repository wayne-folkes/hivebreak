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
  HEART_BEAT_INTERVAL,
  HEART_BEAT_SECONDS,
  HEART_ECHO_DELAY,
  HEART_ECHO_SHIFT,
  HEART_FAST_BEAT_FACTOR,
  HEART_GAP_SHOTS,
  HEART_GAP_WIDTH,
  HEART_HP,
  HEART_LAUNCH_INTERVAL,
  HEART_PARTS,
  HEART_PHASE_3_AT,
  HEART_RADIUS,
  HEART_RING_SHOTS,
  HEART_RING_SPACING,
  HEART_RING_SPEED,
  HEART_SINK,
  HEART_START_Y,
  HEART_VEIN_COUNT,
  HEART_VEIN_HP,
  HEART_AIM_OFFSET,
  HEART_Y,
  heartHealth,
} from './heart';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { BASE_STATS, SHIP_HALF_WIDTH, SHIP_TOP, SHIP_Y, createPlayer, stepPlayer } from './player';
import { createRng } from './rng';
import { WAVE_COUNT, WAVE_INTRO_SECONDS, chooseSpecial, createRun, stepRun } from './run';
import type { BossState, Box, PlayerState, RunEvent, Shot } from './types';
import { NO_INPUT } from './types';

const DT = 1 / 120;

function counter() {
  let n = 1;
  return () => n++;
}

/** A Hive Heart that has already landed. */
function landed(newId = counter()): BossState {
  const boss = createBoss('hiveHeart', newId);
  boss.y = HEART_Y;
  return boss;
}

const heartOf = (boss: BossState) => boss.parts[HEART_VEIN_COUNT];
const veins = (boss: BossState) => boss.parts.slice(0, HEART_VEIN_COUNT);
const shotAt = (x: number, y: number): Box => ({ x, y, halfWidth: 1, halfHeight: 3 });
/** The heart's health where phase 3 begins (exact: hp * 3 <= maxHp). */
const AT_3 = Math.floor(HEART_HP * HEART_PHASE_3_AT + 1e-9);

function shipAt(x: number): PlayerState {
  const p = createPlayer(0);
  p.x = x;
  return p;
}

/** Landed, all veins cut and the phase change played out. */
function inPhase2(newId = counter()): BossState {
  const boss = landed(newId);
  for (const v of veins(boss)) v.hp = 0;
  stepBoss(boss, { players: [shipAt(0)], rng: createRng(1), dt: DT, newId });
  expect(boss.phase).toBe(2);
  return boss;
}

/** Landed, veins cut, heart at the phase 3 threshold, both phase changes played out. */
function inPhase3(newId = counter()): BossState {
  const boss = inPhase2(newId);
  heartOf(boss).hp = AT_3;
  stepBoss(boss, { players: [shipAt(0)], rng: createRng(1), dt: DT, newId });
  expect(boss.phase).toBe(3);
  return boss;
}

function step(boss: BossState, players: PlayerState[], seconds: number, seed = 1, newId = counter()) {
  const rng = createRng(seed);
  const launched: ReturnType<typeof stepBoss>['launched'] = [];
  const shots: Shot[] = [];
  const events: RunEvent[] = [];
  const timed: { t: number; event: RunEvent }[] = [];
  for (let i = 0; i * DT < seconds; i++) {
    const r = stepBoss(boss, { players, rng, dt: DT, newId });
    launched.push(...r.launched);
    shots.push(...r.shots);
    events.push(...r.events);
    for (const event of r.events) timed.push({ t: (i + 1) * DT, event });
  }
  return { launched, shots, events, timed };
}

/** Flies a shot straight up the column x from below the boss; returns what it hits first. */
function fly(boss: BossState, x: number) {
  for (let y = boss.y - 60; y < boss.y + 40; y += 1.5) {
    const hit = hitBoss(boss, shotAt(x, y), 1);
    if (hit) return hit;
  }
  return null;
}

/** Where a ring shot crosses the ship's row. */
const rowX = (s: Shot) => s.x + (s.vx * (SHIP_Y - s.y)) / s.vy;

describe('layout', () => {
  it('has four veins, then the heart: the parts of the model', () => {
    const boss = createBoss('hiveHeart', counter());
    expect(boss.parts.map((p) => p.kind)).toEqual(['vein', 'vein', 'vein', 'vein', 'core']);
    expect(boss.parts.every((p) => p.hp === p.maxHp && p.hp > 0 && p.flash === 0)).toBe(true);
    expect(new Set(boss.parts.map((p) => p.id)).size).toBe(5);
    expect(heartOf(boss)).toMatchObject({ dx: 0, dy: 0, halfWidth: 14, halfHeight: 12, hp: HEART_HP });
    expect(veins(boss).every((p) => p.hp === HEART_VEIN_HP)).toBe(true);
    // vein_0 upper left, vein_1 upper right, vein_2 lower left, vein_3 lower right.
    expect(veins(boss).map((p) => [Math.sign(p.dx), Math.sign(p.dy)])).toEqual([[-1, 1], [1, 1], [-1, -1], [1, -1]]);
    expect(boss.parts[0].dx).toBe(-boss.parts[1].dx);
    expect(boss.parts[0].dy).toBe(boss.parts[1].dy);
    expect(HEART_PARTS).toHaveLength(5);
  });

  it('keeps every part inside the 108-pixel wide model, and inside the field', () => {
    const boss = landed();
    for (const box of bossBoxes(boss)) {
      expect(box.x - box.halfWidth).toBeGreaterThanOrEqual(-54);
      expect(box.x + box.halfWidth).toBeLessThanOrEqual(54);
      expect(box.x + box.halfWidth).toBeLessThan(FIELD_WIDTH / 2);
      expect(box.y + box.halfHeight).toBeLessThan(FIELD_HEIGHT / 2);
    }
  });

  it('starts above the field, centred, in phase 1, ready to beat', () => {
    const boss = createBoss('hiveHeart', counter());
    expect(boss).toMatchObject({ kind: 'hiveHeart', x: 0, y: HEART_START_Y, phase: 1, stun: 0, beatTimer: 0, beats: 0 });
    for (const box of bossBoxes(boss)) expect(box.y - box.halfHeight).toBeGreaterThan(FIELD_HEIGHT / 2);
    expect(bossEntering(boss)).toBe(true);
    expect(bossEntering(landed())).toBe(false);
    expect(HEART_Y).toBe(100);
  });

  it('gives box positions in field coordinates for the standing parts only', () => {
    const boss = landed();
    expect(bossBoxes(boss)).toHaveLength(5);
    expect(partBox(boss, boss.parts[3])).toEqual({ x: boss.parts[3].dx, y: HEART_Y + boss.parts[3].dy, halfWidth: boss.parts[3].halfWidth, halfHeight: boss.parts[3].halfHeight });
    boss.parts[0].hp = 0;
    expect(bossBoxes(boss)).toHaveLength(4);
  });

  it('keeps the music contract: a 1 second beat, 0.75 of it in phases 2 and 3', () => {
    expect(HEART_BEAT_SECONDS).toBe(1);
    expect(HEART_FAST_BEAT_FACTOR).toBe(0.75);
    expect(HEART_BEAT_INTERVAL).toEqual({ 1: 1, 2: 0.75, 3: 0.75 });
  });

  it('is the toughest boss: it takes more hit points than the others', () => {
    const total = (kind: 'broodMother' | 'hiveMind' | 'hiveHeart') => createBoss(kind, counter()).parts.reduce((n, p) => n + p.hp, 0);
    expect(total('hiveHeart')).toBeGreaterThan(total('hiveMind'));
    expect(total('hiveHeart')).toBeGreaterThan(total('broodMother'));
  });
});

describe('descent', () => {
  it('is untouchable while it descends', () => {
    const boss = createBoss('hiveHeart', counter());
    boss.y = HEART_Y + 1;
    expect(hitBoss(boss, shotAt(0, boss.y), 1)).toBeNull();
    expect(beamHitBoss(boss, 0, -100)).toBeNull();
    expect(damageBossFixed(boss, 50)).toEqual([]);
  });

  it('descends to its landing height without attacking, then beats the moment it lands', () => {
    const boss = createBoss('hiveHeart', counter());
    const early = step(boss, [shipAt(0)], 1);
    expect(boss.y).toBeLessThan(HEART_START_Y);
    expect(early.shots).toHaveLength(0);
    const rest = step(boss, [shipAt(0)], 4);
    expect(boss.y).toBe(HEART_Y);
    expect(bossEntering(boss)).toBe(false);
    const beats = rest.timed.filter((e) => e.event.type === 'heartBeat');
    expect(beats.length).toBeGreaterThan(0);
    // The first beat is right at the landing, which takes (195 - 100) / 45 s after the first second.
    expect(beats[0].t - 1).toBeLessThan((HEART_START_Y - HEART_Y) / 45 + 0.05);
    expect(boss.beats).toBe(beats.length);
  });

  it('beats within a step of landing', () => {
    const boss = createBoss('hiveHeart', counter());
    const rng = createRng(1);
    const newId = counter();
    let landedStep = -1;
    let beatStep = -1;
    for (let i = 0; i < 600 && beatStep < 0; i++) {
      const r = stepBoss(boss, { players: [shipAt(0)], rng, dt: DT, newId });
      if (landedStep < 0 && !bossEntering(boss)) landedStep = i;
      if (r.events.some((e) => e.type === 'heartBeat')) beatStep = i;
    }
    expect(beatStep - landedStep).toBeLessThanOrEqual(1);
  });
});

describe('the veins shield the heart', () => {
  it('stops a shot at the heart without damage while a vein stands', () => {
    const boss = landed();
    const hit = fly(boss, 0);
    expect(hit?.part).toBe(heartOf(boss));
    expect(hit).toMatchObject({ destroyed: false, blocked: true });
    expect(heartOf(boss).hp).toBe(HEART_HP);
    expect(heartOf(boss).flash).toBe(0);
  });

  it('hits the lower vein before the upper one above it, flashing it', () => {
    const boss = landed();
    const hit = fly(boss, -30);
    expect(hit?.part).toBe(boss.parts[2]);
    expect(boss.parts[2].hp).toBe(HEART_VEIN_HP - 1);
    expect(boss.parts[2].flash).toBe(HIT_FLASH_SECONDS);
    expect(boss.parts[0].hp).toBe(HEART_VEIN_HP);
    boss.parts[2].hp = 0;
    expect(fly(boss, -30)?.part).toBe(boss.parts[0]);
  });

  it('reports the hit that cuts a vein, and passes through it afterwards', () => {
    const boss = landed();
    const v = boss.parts[3];
    v.hp = 1;
    const box = partBox(boss, v);
    expect(hitBoss(boss, shotAt(box.x, box.y), 1)).toEqual({ part: v, destroyed: true });
    expect(v.hp).toBe(0);
    expect(hitBoss(boss, shotAt(box.x, box.y), 1)).toBeNull();
  });

  it('misses the empty space beside and between the parts', () => {
    const boss = landed();
    expect(hitBoss(boss, shotAt(80, boss.y), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(-30, boss.y - 2), 1)).toBeNull(); // between the lower and upper vein
    expect(hitBoss(boss, shotAt(0, boss.y + 60), 1)).toBeNull();
    expect(hitBoss(boss, shotAt(0, boss.y), 0)).toBeNull(); // no damage, no hit
  });

  it('exposes the heart once every vein is cut', () => {
    const boss = landed();
    for (const v of veins(boss).slice(0, 3)) v.hp = 0;
    expect(fly(boss, 0)).toMatchObject({ blocked: true });
    boss.parts[3].hp = 0;
    const hit = fly(boss, 0);
    expect(hit?.part).toBe(heartOf(boss));
    expect(hit?.blocked).toBeUndefined();
    expect(heartOf(boss).hp).toBe(HEART_HP - 1);
  });

  it('stops a beam at the lowest part in its column, and says when the heart blocks it', () => {
    const boss = landed();
    const lower = beamHitBoss(boss, -31, -100);
    expect(lower?.part).toBe(boss.parts[2]);
    expect(lower?.blocked).toBe(false);
    expect(lower?.y).toBe(boss.y + boss.parts[2].dy - boss.parts[2].halfHeight);
    const centre = beamHitBoss(boss, 0, -100);
    expect(centre?.part).toBe(heartOf(boss));
    expect(centre?.blocked).toBe(true);
    expect(beamHitBoss(boss, 80, -100)).toBeNull();
    for (const v of veins(boss)) v.hp = 0;
    expect(beamHitBoss(boss, 0, -100)?.blocked).toBe(false);
    expect(beamHitBoss(boss, -31, -100)?.part).not.toBe(boss.parts[2]);
  });

  it('agrees with a shot rising up the same column', () => {
    const boss = landed();
    for (const x of [-40, -31, -12, 0, 8, 25, 44]) {
      const beam = beamHitBoss(boss, x, -100);
      const hit = fly(boss, x);
      expect(hit?.part).toBe(beam?.part);
      expect(hit?.blocked ?? false).toBe(beam?.blocked);
    }
  });
});

describe('damageBossFixed', () => {
  it('shares the damage over the standing veins first, leaving the heart alone', () => {
    const boss = landed();
    const hits = damageBossFixed(boss, 40);
    expect(hits).toHaveLength(4);
    expect(veins(boss).every((v) => v.hp === HEART_VEIN_HP - 10)).toBe(true);
    expect(heartOf(boss).hp).toBe(HEART_HP);
    expect(hits.every((h) => !h.destroyed)).toBe(true);
  });

  it('goes on to the heart once the veins are cut', () => {
    const boss = landed();
    const total = HEART_VEIN_COUNT * HEART_VEIN_HP + 25;
    const hits = damageBossFixed(boss, total);
    expect(veins(boss).every((v) => v.hp === 0)).toBe(true);
    expect(heartOf(boss).hp).toBe(HEART_HP - 25);
    expect(hits).toHaveLength(5);
    expect(hits.filter((h) => h.destroyed)).toHaveLength(4);
  });

  it('lets what a weak vein cannot take spill over to the others', () => {
    const boss = landed();
    boss.parts[0].hp = 2;
    damageBossFixed(boss, 40);
    expect(boss.parts[0].hp).toBe(0);
    expect(boss.parts.slice(1, 4).reduce((n, v) => n + v.hp, 0)).toBe(3 * HEART_VEIN_HP - 38);
    expect(heartOf(boss).hp).toBe(HEART_HP);
  });
});

describe('health', () => {
  it('follows the heart alone: the veins are the way in, not the goal', () => {
    const boss = landed();
    expect(heartHealth(boss)).toBe(1);
    expect(bossHealth(boss)).toBe(1);
    for (const v of veins(boss)) v.hp = 0;
    expect(bossHealth(boss)).toBe(1);
    heartOf(boss).hp = HEART_HP / 2;
    expect(bossHealth(boss)).toBeCloseTo(0.5, 10);
    heartOf(boss).hp = 0;
    expect(bossHealth(boss)).toBe(0);
    expect(bossDefeated(boss)).toBe(true);
  });
});

describe('beats and rings (phase 1)', () => {
  it('beats once a second, in a steady rhythm, announcing each beat', () => {
    const boss = landed();
    const { timed } = step(boss, [shipAt(0)], 10.2);
    const beats = timed.filter((e) => e.event.type === 'heartBeat');
    expect(beats).toHaveLength(11);
    for (let i = 1; i < beats.length; i++) expect(beats[i].t - beats[i - 1].t).toBeCloseTo(HEART_BEAT_SECONDS, 1);
    // No drift: the 11th beat is 10 seconds after the first, within a step.
    expect(beats[10].t - beats[0].t).toBeCloseTo(10, 1);
    expect(boss.beats).toBe(11);
    expect(beats[0].event).toMatchObject({ type: 'heartBeat', x: 0, y: HEART_Y, phase: 1 });
    expect(timed.filter((e) => e.event.type === 'bossFired')).toHaveLength(11);
  });

  it('fires a full ring minus the gap, radiating from the heart at the phase speed', () => {
    const boss = landed();
    const { shots } = step(boss, [shipAt(0)], DT * 2);
    expect(shots).toHaveLength(HEART_RING_SHOTS - HEART_GAP_SHOTS);
    expect(new Set(shots.map((s) => s.id)).size).toBe(shots.length);
    for (const s of shots) {
      expect(s).toMatchObject({ owner: 'alien', kind: 'enemy', playerId: null, damage: 1 });
      expect(Math.hypot(s.x - boss.x, s.y - boss.y)).toBeCloseTo(HEART_RADIUS, 6);
      expect(Math.hypot(s.vx, s.vy)).toBeCloseTo(HEART_RING_SPEED[1], 6);
      // Straight out from the centre.
      expect(Math.atan2(s.vy, s.vx)).toBeCloseTo(Math.atan2(s.y - boss.y, s.x - boss.x), 6);
    }
  });

  it('leaves a gap of three spacings, centred on the announced gap angle', () => {
    const boss = landed();
    const { shots, events } = step(boss, [shipAt(0)], DT * 2);
    const gap = (events.find((e) => e.type === 'heartBeat') as Extract<RunEvent, { type: 'heartBeat' }>).gapAngle;
    expect(HEART_GAP_WIDTH).toBeCloseTo(3 * HEART_RING_SPACING, 10);
    const rel = (s: Shot) => {
      let d = Math.atan2(s.vy, s.vx) - gap;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    };
    const near = Math.min(...shots.map((s) => Math.abs(rel(s))));
    expect(near).toBeCloseTo(HEART_GAP_WIDTH / 2, 6);
    const sorted = shots.map(rel).sort((a, b) => a - b);
    const gaps = sorted.map((a, i) => (i === 0 ? sorted[0] + Math.PI * 2 - sorted[sorted.length - 1] : a - sorted[i - 1]));
    expect(gaps.filter((g) => g > HEART_RING_SPACING * 1.5)).toHaveLength(1);
  });

  it('aims the gap near, but not at, the ship, so the ship has to move into it', () => {
    for (const x of [-70, -30, 0, 30, 70]) {
      for (let seed = 1; seed <= 8; seed++) {
        const boss = landed();
        const { events } = step(boss, [shipAt(x)], DT * 2, seed);
        const gap = (events.find((e) => e.type === 'heartBeat') as Extract<RunEvent, { type: 'heartBeat' }>).gapAngle;
        const aim = Math.atan2(SHIP_Y - boss.y, x - boss.x);
        const off = Math.abs(gap - aim);
        expect(off).toBeGreaterThanOrEqual(HEART_AIM_OFFSET.min - 1e-9);
        expect(off).toBeLessThanOrEqual(HEART_AIM_OFFSET.max + 1e-9);
        // The ship's direction is inside the gap, with room to spare.
        expect(HEART_GAP_WIDTH / 2 - off).toBeGreaterThan(0.05);
      }
    }
  });

  it('leaves a gap at the ship row wide enough for the ship, and the ship inside it', () => {
    for (const x of [-76, -40, 0, 40, 76]) {
      for (let seed = 1; seed <= 8; seed++) {
        const boss = landed();
        const { shots } = step(boss, [shipAt(x)], DT * 2, seed);
        const xs = shots.filter((s) => s.vy < 0).map(rowX).sort((a, b) => a - b);
        // The ring's shots on either side of the ship's x at the row: the ship fits between them.
        const left = Math.max(...xs.filter((v) => v <= x), -Infinity);
        const right = Math.min(...xs.filter((v) => v > x), Infinity);
        expect(x - left).toBeGreaterThan(SHIP_HALF_WIDTH + 2);
        expect(right - x).toBeGreaterThan(SHIP_HALF_WIDTH + 2);
        expect(right - left).toBeGreaterThan(2 * SHIP_HALF_WIDTH + 8);
      }
    }
  });

  it('only fills the gap the ship can use: the other shots do not leave it open', () => {
    const boss = landed();
    const { shots } = step(boss, [shipAt(0)], DT * 2);
    // Away from the gap, neighbours at the ship row are a few ship widths apart at most.
    const xs = shots.filter((s) => s.vy < 0).map(rowX).sort((a, b) => a - b);
    const inField = xs.filter((v) => Math.abs(v) < FIELD_WIDTH / 2);
    expect(inField.length).toBeGreaterThanOrEqual(3);
  });

  it('does not fire at nobody, but still counts the beat', () => {
    const boss = landed();
    const { shots, events } = step(boss, [], 3);
    expect(shots).toHaveLength(0);
    expect(events.filter((e) => e.type === 'heartBeat')).toHaveLength(0);
    expect(boss.beats).toBeGreaterThanOrEqual(3);
  });

  it('does not launch in phase 1', () => {
    expect(step(landed(), [shipAt(0)], 12).launched).toHaveLength(0);
  });
});

describe('phase 2: the heart is exposed', () => {
  it('begins on the step the last vein falls, once, whatever knocked it off', () => {
    const boss = landed();
    const ship = [shipAt(0)];
    for (const v of veins(boss).slice(0, 3)) v.hp = 0;
    expect(step(boss, ship, 1).events.some((e) => e.type === 'bossPhase')).toBe(false);
    expect(boss.phase).toBe(1);
    boss.parts[3].hp = 0;
    const out = step(boss, ship, 3);
    expect(out.events.filter((e) => e.type === 'bossPhase')).toEqual([{ type: 'bossPhase', phase: 2 }]);
    expect(boss.phase).toBe(2);
    const first = out.timed.find((e) => e.event.type === 'bossPhase');
    expect(first?.t).toBeLessThanOrEqual(DT * 1.5);
  });

  it('also goes to phase 2 when a Pulse Bomb strips the veins', () => {
    const boss = landed();
    damageBossFixed(boss, HEART_VEIN_COUNT * HEART_VEIN_HP);
    expect(step(boss, [shipAt(0)], 0.1).events).toContainEqual({ type: 'bossPhase', phase: 2 });
  });

  it('beats 25% faster, at 0.75 s', () => {
    const boss = inPhase2();
    boss.beatTimer = HEART_BEAT_INTERVAL[2];
    const { timed } = step(boss, [shipAt(0)], 9.1);
    const beats = timed.filter((e) => e.event.type === 'heartBeat');
    expect(beats).toHaveLength(12);
    for (let i = 1; i < beats.length; i++) expect(beats[i].t - beats[i - 1].t).toBeCloseTo(0.75, 1);
    expect(beats[0].event).toMatchObject({ phase: 2 });
  });

  it('brings the next beat forward if it was further off than a fast beat', () => {
    const boss = landed();
    boss.beatTimer = 0.95;
    for (const v of veins(boss)) v.hp = 0;
    stepBoss(boss, { players: [shipAt(0)], rng: createRng(1), dt: DT, newId: counter() });
    expect(boss.beatTimer).toBeLessThanOrEqual(0.75);
  });

  it('sends the rings a little faster', () => {
    const boss = inPhase2();
    boss.beatTimer = 0;
    const { shots } = step(boss, [shipAt(0)], DT * 2);
    expect(shots).toHaveLength(HEART_RING_SHOTS - HEART_GAP_SHOTS);
    expect(Math.hypot(shots[0].vx, shots[0].vy)).toBeCloseTo(HEART_RING_SPEED[2], 6);
    expect(HEART_RING_SPEED[2]).toBeGreaterThan(HEART_RING_SPEED[1]);
  });

  it('launches free aliens heading down, first soon and then every few seconds, mostly Drones', () => {
    const boss = inPhase2();
    const { launched, timed } = step(boss, [shipAt(0)], 40);
    expect(launched.length).toBeGreaterThanOrEqual(10);
    expect(launched.length % 2).toBe(0);
    for (const a of launched) {
      expect(a.mode).toBe('free');
      expect(a.vy).toBeLessThan(0);
      expect(['drone', 'warper']).toContain(a.kind);
      expect(a.y).toBeLessThan(boss.y);
    }
    const kinds = new Set(launched.map((a) => a.kind));
    expect(kinds.has('drone') && kinds.has('warper')).toBe(true);
    expect(launched.filter((a) => a.kind === 'drone').length).toBeGreaterThan(launched.filter((a) => a.kind === 'warper').length);
    // Left and right of the heart.
    expect(launched.some((a) => a.x < boss.x) && launched.some((a) => a.x > boss.x)).toBe(true);
    const launches = timed.filter((e) => e.event.type === 'bossLaunched');
    expect(launches).toHaveLength(launched.length);
    expect(launches[0].t).toBeLessThan(2.5);
    expect(new Set(launched.map((a) => a.id)).size).toBe(launched.length);
    const pairs = launches.length / 2;
    expect(40 / pairs).toBeGreaterThan(HEART_LAUNCH_INTERVAL[2] * 0.8);
    expect(40 / pairs).toBeLessThan(HEART_LAUNCH_INTERVAL[2] * 1.3);
  });

  it('launched aliens fly down and are free aliens like the other bosses', () => {
    const boss = inPhase2();
    const { launched } = step(boss, [shipAt(0)], 3);
    const alien = launched[0];
    const y0 = alien.y;
    for (let i = 0; i < 120; i++) stepFreeAlien(alien, 0, DT);
    expect(alien.y).toBeLessThan(y0 - 30);
  });
});

describe('phase 3: below a third of its health', () => {
  it('begins once, after phase 2, when the heart reaches a third', () => {
    const boss = inPhase2();
    heartOf(boss).hp = AT_3 + 1;
    expect(step(boss, [shipAt(0)], 0.5).events.some((e) => e.type === 'bossPhase')).toBe(false);
    heartOf(boss).hp = AT_3;
    const out = step(boss, [shipAt(0)], 3);
    expect(out.events.filter((e) => e.type === 'bossPhase')).toEqual([{ type: 'bossPhase', phase: 3 }]);
    expect(boss.phase).toBe(3);
  });

  it('follows the heart exactly at a third (integer maths)', () => {
    expect(AT_3 * 3).toBeLessThanOrEqual(HEART_HP);
    expect((AT_3 + 1) * 3).toBeGreaterThan(HEART_HP);
  });

  it('sends a second ring after each beat, a short time later, with a shifted but overlapping gap', () => {
    const boss = inPhase3();
    boss.beatTimer = 0.0001;
    const rng = createRng(4);
    const newId = counter();
    const ship = [shipAt(0)];
    const rings: { t: number; shots: Shot[] }[] = [];
    let beatAt = -1;
    for (let i = 0; i < 150; i++) {
      const r = stepBoss(boss, { players: ship, rng, dt: DT, newId });
      if (r.events.some((e) => e.type === 'heartBeat')) beatAt = i * DT;
      if (r.shots.length > 0) rings.push({ t: i * DT, shots: r.shots });
    }
    // Beats at 0 and 0.75 each with an echo 0.25 s later: four rings in a second.
    expect(rings).toHaveLength(4);
    expect(rings[1].t - rings[0].t).toBeCloseTo(HEART_ECHO_DELAY, 1);
    expect(rings[2].t - rings[0].t).toBeCloseTo(0.75, 1);
    expect(beatAt).toBeGreaterThan(0);
    for (const r of rings) expect(r.shots).toHaveLength(HEART_RING_SHOTS - HEART_GAP_SHOTS);
    expect(Math.hypot(rings[0].shots[0].vx, rings[0].shots[0].vy)).toBeCloseTo(HEART_RING_SPEED[3], 6);
  });

  it('keeps a passable gap through both rings of a pair', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const x = ((seed * 37) % 140) - 70;
      const boss = inPhase3();
      boss.beatTimer = 0.0001;
      const rng = createRng(seed);
      const newId = counter();
      const rings: Shot[][] = [];
      for (let i = 0; i < 60; i++) {
        const r = stepBoss(boss, { players: [shipAt(x)], rng, dt: DT, newId });
        if (r.shots.length > 0) rings.push(r.shots);
      }
      const [a, b] = rings;
      // The open stretch at the ship's row: between the two shots either side of the gap in the ring's order.
      const gapOf = (shots: Shot[]): [number, number] => {
        const ang = (s: Shot) => Math.atan2(s.vy, s.vx);
        for (let i = 0; i < shots.length; i++) {
          const next = shots[(i + 1) % shots.length];
          let d = ang(next) - ang(shots[i]);
          while (d < 0) d += Math.PI * 2;
          if (d > HEART_RING_SPACING * 1.5) return [Math.min(rowX(shots[i]), rowX(next)), Math.max(rowX(shots[i]), rowX(next))];
        }
        throw new Error('no gap');
      };
      const [al, ah] = gapOf(a);
      const [bl, bh] = gapOf(b);
      expect(ah - al).toBeGreaterThan(2 * SHIP_HALF_WIDTH + 8);
      expect(x).toBeGreaterThan(al + SHIP_HALF_WIDTH);
      expect(x).toBeLessThan(ah - SHIP_HALF_WIDTH);
      // The two gaps overlap by at least a ship's width, so the ship need not cross a ring to get from one to the other.
      expect(Math.min(ah, bh) - Math.max(al, bl)).toBeGreaterThan(2 * SHIP_HALF_WIDTH + 4);
    }
    expect(HEART_ECHO_SHIFT.max).toBeLessThan(HEART_GAP_WIDTH / 2);
  });

  it('sinks to a lower height over a few seconds, and stays there', () => {
    const boss = inPhase3();
    expect(boss.y).toBeLessThan(HEART_Y);
    step(boss, [shipAt(0)], 1);
    const y1 = boss.y;
    expect(y1).toBeLessThan(HEART_Y - 5);
    step(boss, [shipAt(0)], 6);
    expect(boss.y).toBe(HEART_Y - HEART_SINK);
    step(boss, [shipAt(0)], 3);
    expect(boss.y).toBe(HEART_Y - HEART_SINK);
    expect(bossEntering(boss)).toBe(false);
    // Hits follow it down.
    expect(hitBoss(boss, shotAt(0, boss.y), 1)?.part).toBe(heartOf(boss));
  });

  it('keeps launching, less often', () => {
    const boss = inPhase3();
    const { launched } = step(boss, [shipAt(0)], 40);
    expect(launched.length).toBeGreaterThanOrEqual(8);
    expect(launched.length / 2).toBeLessThan(40 / HEART_LAUNCH_INTERVAL[2]);
  });

  it('beats at the fast tempo too', () => {
    const boss = inPhase3();
    const { timed } = step(boss, [shipAt(0)], 6.1);
    expect(timed.filter((e) => e.event.type === 'heartBeat').length).toBeGreaterThanOrEqual(8);
    expect(timed.filter((e) => e.event.type === 'heartBeat').every((e) => (e.event as { phase: number }).phase === 3)).toBe(true);
  });

  it('goes through both phases in order if the veins and the heart fall at once', () => {
    const boss = landed();
    for (const v of veins(boss)) v.hp = 0;
    heartOf(boss).hp = AT_3;
    const phases = step(boss, [shipAt(0)], 0.1).events.filter((e) => e.type === 'bossPhase');
    expect(phases).toEqual([{ type: 'bossPhase', phase: 2 }, { type: 'bossPhase', phase: 3 }]);
  });
});

describe('stun and time', () => {
  it('stops everything while stunned, then resumes; the stun counts down', () => {
    const boss = landed();
    boss.stun = 2;
    boss.beatTimer = 0;
    const stunned = step(boss, [shipAt(0)], 1.9);
    expect(stunned.shots).toHaveLength(0);
    expect(stunned.events).toHaveLength(0);
    expect(boss.beats).toBe(0);
    expect(boss.stun).toBeGreaterThan(0);
    const after = step(boss, [shipAt(0)], 1.2);
    expect(boss.stun).toBe(0);
    expect(after.shots.length).toBeGreaterThan(0);
  });

  it('holds the descent and the launches and the sink while stunned', () => {
    const rising = createBoss('hiveHeart', counter());
    rising.stun = 1;
    step(rising, [shipAt(0)], 0.9);
    expect(rising.y).toBe(HEART_START_Y);
    const boss = inPhase3();
    const y = boss.y;
    boss.stun = 1;
    boss.launchTimer = 0;
    const out = step(boss, [shipAt(0)], 0.9);
    expect(boss.y).toBe(y);
    expect(out.launched).toHaveLength(0);
  });

  it('still announces a phase change while stunned, and still lets flashes fade', () => {
    const boss = landed();
    boss.stun = 1;
    boss.parts[0].flash = HIT_FLASH_SECONDS;
    for (const v of veins(boss)) v.hp = 0;
    const out = step(boss, [shipAt(0)], 0.5);
    expect(out.events).toEqual([{ type: 'bossPhase', phase: 2 }]);
    expect(boss.parts[0].flash).toBe(0);
  });

  it('does nothing with a zero step but lets nothing change', () => {
    const boss = landed();
    const before = JSON.stringify(boss);
    const out = stepBoss(boss, { players: [shipAt(0)], rng: createRng(1), dt: 0, newId: counter() });
    expect(out).toEqual({ launched: [], shots: [], events: [], shattered: [] });
    expect(JSON.stringify(boss)).toBe(before);
  });

  it('does half as much in half the time', () => {
    const a = landed();
    const b = landed();
    for (const boss of [a, b]) boss.beatTimer = 1;
    step(a, [shipAt(0)], 2.1);
    const rng = createRng(1);
    for (let i = 0; i < 250; i++) stepBoss(b, { players: [shipAt(0)], rng, dt: DT / 2, newId: counter() });
    expect(a.beats).toBe(2);
    expect(b.beats).toBe(1);
  });

  it('stops attacking once the heart is destroyed', () => {
    const boss = landed();
    heartOf(boss).hp = 0;
    const out = step(boss, [shipAt(0)], 3);
    expect(out.shots).toHaveLength(0);
    expect(out.events).toHaveLength(0);
  });
});

describe('determinism', () => {
  it('plays the same for the same seed and inputs, and differently for another', () => {
    const run = (seed: number) => {
      const boss = createBoss('hiveHeart', counter());
      const out = step(boss, [shipAt(25)], 8, seed);
      for (const v of veins(boss)) v.hp = 0;
      const more = step(boss, [shipAt(-25)], 8, seed);
      return JSON.stringify({ boss, out, more });
    };
    expect(run(9)).toBe(run(9));
    expect(run(9)).not.toBe(run(10));
  });
});

describe('points', () => {
  it('pays 200 for a vein and 2000 for the heart', () => {
    expect(BOSS_POINTS.vein).toBe(200);
    expect(BOSS_POINTS.core).toBeGreaterThan(BOSS_POINTS.vein);
    expect(standingParts(landed(), 'vein')).toHaveLength(4);
  });
});

/**
 * A scripted shooter under the Heart: it steers beneath the nearest standing vein (the heart
 * when they're all down) and holds fire. Shots that hit are spent; enemy shots are ignored (the
 * ship can't be hurt). Returns how long the fight took from landing, in seconds.
 */
function fight(opts: { fireInterval: number; shotsPerVolley: number; damage?: number; maxSeconds: number }) {
  const rng = createRng(11);
  const newId = counter();
  const boss = createBoss('hiveHeart', newId);
  const player = createPlayer(0);
  player.stats = { ...BASE_STATS, fireInterval: opts.fireInterval, shotsPerVolley: opts.shotsPerVolley, damage: opts.damage ?? 1 };
  let shots: Shot[] = [];
  let landedAt: number | null = null;
  const phases: number[] = [];
  const phaseTimes: number[] = [0];

  for (let t = 0; t < opts.maxSeconds; t += DT) {
    if (landedAt === null && !bossEntering(boss)) landedAt = t;
    const standing = standingParts(boss, 'vein');
    const goal = standing.length > 0 ? standing : standingParts(boss, 'core');
    let aimX = player.x;
    if (goal.length > 0) {
      let best = goal[0];
      for (const p of goal) if (Math.abs(boss.x + p.dx - player.x) < Math.abs(boss.x + best.dx - player.x)) best = p;
      aimX = boss.x + best.dx;
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
    if (bossDefeated(boss)) return { seconds: t - (landedAt ?? 0), boss, phases, phaseTimes };
  }
  return { seconds: Infinity, boss, phases, phaseTimes };
}

describe('a simulated fight', () => {
  it('lasts about a minute for a perfect shooter with a couple of upgrades, through all three phases', () => {
    // Rapid fire (x0.65 interval) and a second shot per volley.
    const { seconds, phases, phaseTimes, boss } = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 300 });
    expect(bossDefeated(boss)).toBe(true);
    expect(phases).toEqual([2, 3]);
    expect(phaseTimes[1]).toBeGreaterThan(8);
    expect(phaseTimes[2]).toBeGreaterThan(phaseTimes[1] + 10);
    expect(seconds).toBeGreaterThan(phaseTimes[2] + 8);
    // The Hive Mind takes about 33 s for the same shooter; the Heart is the longest fight.
    expect(seconds).toBeGreaterThan(45);
    expect(seconds).toBeLessThan(80);
  });

  it('is slower, but still beatable, for an unupgraded ship', () => {
    const base = fight({ fireInterval: BASE_STATS.fireInterval, shotsPerVolley: 1, maxSeconds: 600 });
    const upgraded = fight({ fireInterval: 0.32 * 0.65, shotsPerVolley: 2, maxSeconds: 600 });
    expect(base.seconds).toBeLessThan(400);
    expect(base.seconds).toBeGreaterThan(upgraded.seconds * 1.3);
  });
});

describe('inside a run', () => {
  /** Under the nearest standing vein, then the heart; holds fire; never dodges. */
  function input(run: ReturnType<typeof createRun>) {
    const ship = run.players[0];
    const boss = run.boss;
    let target = 0;
    if (boss) {
      const parts = standingParts(boss, 'vein').length > 0 ? standingParts(boss, 'vein') : standingParts(boss, 'core');
      let best = Infinity;
      for (const p of parts) if (Math.abs(boss.x + p.dx - ship.x) < best) { best = Math.abs(boss.x + p.dx - ship.x); target = boss.x + p.dx; }
    }
    return { ...NO_INPUT, move: Math.max(-1, Math.min(1, (target - ship.x) / 6)), fire: true };
  }

  it('is the last wave, a Hive Heart', () => {
    const run = createRun(1, 1, WAVE_COUNT - 1);
    expect(run.wave).toBe(14);
    chooseSpecial(run, 'pulseBomb');
    expect(run.boss?.kind).toBe('hiveHeart');
  });

  it('can be shot down in a run: veins, heart, bossKilled, waveClear and a win', () => {
    const run = createRun(3, 1, 14);
    chooseSpecial(run, 'pulseBomb');
    run.players[0].lives = 99;
    // Short work of it: the structure of the fight, not its length, is under test.
    for (const p of run.boss!.parts) p.hp = p.maxHp = p.kind === 'vein' ? 3 : 12;
    const events: RunEvent[] = [];
    for (let n = 0; run.phase !== 'won' && run.phase !== 'lost' && n < 120 * 120; n++) events.push(...stepRun(run, [input(run)], DT));
    expect(run.phase).toBe('won');
    expect(events.filter((e) => e.type === 'bossPhase')).toEqual([2, 3].map((phase) => ({ type: 'bossPhase', phase })));
    expect(events.filter((e) => e.type === 'bossPartDestroyed' && e.part === 'vein')).toHaveLength(4);
    expect(events.filter((e) => e.type === 'heartBeat').length).toBeGreaterThan(2);
    expect(events.filter((e) => e.type === 'bossKilled')).toEqual([expect.objectContaining({ kind: 'hiveHeart', points: BOSS_POINTS.core })]);
    expect(events.filter((e) => e.type === 'waveClear')).toEqual([{ type: 'waveClear', wave: 14 }]);
    expect(events.at(-1)).toEqual({ type: 'won' });
    expect(run.aliens.filter((a) => a.mode === 'free')).toEqual([]);
    expect(run.shots).toEqual([]);
  });

  it('blocks shots at the heart while a vein stands, in a run', () => {
    const run = createRun(2, 1, 14);
    chooseSpecial(run, 'pulseBomb');
    run.players[0].lives = 99;
    const events: RunEvent[] = [];
    for (let n = 0; n < Math.ceil(7 / DT); n++) events.push(...stepRun(run, [{ ...NO_INPUT, fire: true }], DT));
    expect(events.filter((e) => e.type === 'coreBlocked').length).toBeGreaterThan(5);
    expect(heartOf(run.boss!).hp).toBe(HEART_HP);
  });

  it('puts its rings into the run as enemy shots, scaled like other boss shots', () => {
    const run = createRun(5, 1, 14);
    chooseSpecial(run, 'pulseBomb');
    run.players[0].lives = 99;
    run.players[0].stats = { ...run.players[0].stats, enemyShotSpeed: 0.5 };
    const steps = Math.ceil((WAVE_INTRO_SECONDS + 3) / DT);
    for (let n = 0; n < steps; n++) stepRun(run, [NO_INPUT], DT);
    expect(run.phase).toBe('playing');
    expect(run.boss!.beats).toBeGreaterThan(0);
    const ring = run.shots.filter((s) => s.owner === 'alien');
    expect(ring.length).toBeGreaterThan(HEART_RING_SHOTS - HEART_GAP_SHOTS - 1);
  });
});
