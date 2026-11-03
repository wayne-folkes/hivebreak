import { mkdirSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FieldView } from './draw';
import { Frame } from './frame';
import { computeLayout } from './layout';
import { frameText, framePng } from './snapshot';
import { activatePowerUp, applyRunEffect } from '../src/game/powerups';
import { chooseSpecial, createRun, stepRun } from '../src/game/run';
import type { PowerUpKind, RunEvent, RunState, ShipId, SpecialId, UpgradeId } from '../src/game/types';

// A dev tool as much as a test: it plays a few scenes with the real simulation, draws them with
// the FieldView and, when HIVEBREAK_SHOTS names a directory, writes each as a PNG there so the
// drawing can be looked at. Without it, it only checks that the PNG encoder produces a PNG.

const DIR = process.env.HIVEBREAK_SHOTS;
const DT = 1 / 60;

interface Scene {
  name: string;
  wave: number;
  seconds: number;
  ship?: ShipId;
  special?: SpecialId;
  /** Edits the run once the wave has started. */
  setup?: (run: RunState) => void;
  /** Called every step with the run, to tweak it (keeps a scene looking busy). */
  tick?: (run: RunState, t: number) => void;
  /** Events to hand the view (as if the step produced them) at second `at` of the scene (default: just before the end, so the effect is still bright). */
  inject?: (run: RunState) => RunEvent[];
  at?: number;
}

function play(scene: Scene): { frame: Frame; view: FieldView; run: RunState } {
  const run = createRun(7, 1, scene.wave, { ships: [scene.ship ?? 'breaker'] });
  const view = new FieldView();
  const layout = computeLayout(120, 50)!;
  const frame = new Frame(layout.cols, layout.rows);
  let events: RunEvent[] = chooseSpecial(run, scene.special ?? 'pulseBomb');
  view.events(events, run);
  let setUp = false;
  let injected = false;
  const hud = { best: 12340, demo: false, autofire: true, keyMode: 'repeat' as const };
  const steps = Math.round(scene.seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t = i * DT;
    if (!setUp && run.phase === 'playing') {
      scene.setup?.(run);
      setUp = true;
    }
    if (scene.inject && !injected && t >= (scene.at ?? scene.seconds - 0.12)) {
      view.events(scene.inject(run), run);
      injected = true;
    }
    scene.tick?.(run, t);
    events = stepRun(run, [{ move: Math.sin(t * 1.3), drag: 0, fire: true, special: false }], DT);
    view.events(events, run);
    // Keep the frames light: draw every step only near the end, else just every 6th.
    if (i % 6 === 0 || i > steps - 3) {
      frame.clear();
      view.draw(frame, layout, run, hud, i > steps - 3 ? DT : DT * 6);
    }
  }
  frame.clear();
  view.draw(frame, layout, run, hud, DT);
  return { frame, view, run };
}

const upgrades = (run: RunState, ids: UpgradeId[]) => {
  const p = run.players[0];
  p.upgrades.push(...ids);
};

/** First alien of a kind that is in the formation. */
const firstOf = (run: RunState, kind: string) => run.aliens.find((a) => a.kind === kind);

const SCENES: Scene[] = [
  { name: 'sector3-intro', wave: 10, seconds: 0.6 },
  { name: 'sector3-w11', wave: 10, seconds: 7 },
  {
    name: 'sector3-w11-warp',
    wave: 10,
    seconds: 7,
    setup: (run) => {
      const w = firstOf(run, 'warper');
      if (w) w.warp = 0.3;
    },
    tick: (run) => {
      const w = firstOf(run, 'warper');
      if (w && w.warp !== undefined && w.warp > 0.01) w.warp = 0.3 - ((run.time * 2) % 0.28) + 0.01;
    },
    inject: (run) => {
      const w = firstOf(run, 'warper');
      return w ? [{ type: 'alienWarped', alienId: w.id, fromX: w.x + 70, fromY: w.y + 20, toX: w.x, toY: w.y }] : [];
    },
  },
  {
    name: 'sector3-w12-mend',
    wave: 11,
    seconds: 8,
    setup: (run) => {
      for (const a of run.aliens) if (a.kind !== 'mender' && a.hp > 1 && a.id % 2 === 0) a.hp -= 1;
    },
    inject: (run) => {
      const m = firstOf(run, 'mender');
      if (!m) return [];
      const near = run.aliens.filter((a) => a !== m && Math.hypot(a.x - m.x, a.y - m.y) < 40).slice(0, 4);
      return [{ type: 'mendPulse', alienId: m.id, x: m.x, y: m.y, healed: near.map((a) => ({ x: a.x, y: a.y })) }];
    },
  },
  {
    name: 'sector3-w13-mines',
    wave: 12,
    seconds: 8,
    setup: (run) => {
      run.mines.push({ id: 9001, x: -50, y: 70, vx: 0, vy: 0 }, { id: 9002, x: 40, y: -20, vx: 0, vy: 0 }, { id: 9003, x: 0, y: 150, vx: 0, vy: 0 });
    },
    tick: (run) => {
      for (const m of run.mines) if (m.id >= 9000) m.vy = 0;
    },
    inject: () => [
      { type: 'mineBurst', mineId: 9100, x: 60, y: 60, radius: 26, cause: 'shot' },
      { type: 'mineBurst', mineId: 9101, x: -60, y: -90, radius: 8, cause: 'bunker' },
      { type: 'mineBurst', mineId: 9102, x: 0, y: -150, radius: 16, cause: 'ground' },
    ],
  },
  {
    name: 'sector3-w14-acid',
    wave: 13,
    seconds: 7,
    setup: (run) => {
      run.acid.push(
        { id: 9201, x: -70, y: 0, halfWidth: 7, state: 'warn', timeLeft: 5 } as RunState['acid'][number],
        { id: 9202, x: 20, y: 0, halfWidth: 7, state: 'rain', timeLeft: 5 } as RunState['acid'][number],
        { id: 9203, x: 80, y: 0, halfWidth: 7, state: 'warn', timeLeft: 5 } as RunState['acid'][number],
      );
    },
    tick: (run) => {
      for (const c of run.acid) if (c.id >= 9200) c.timeLeft = 5;
    },
  },
  { name: 'wave1', wave: 0, seconds: 4 },
  { name: 'wave1-intro', wave: 0, seconds: 0.3 },
  { name: 'sector2', wave: 5, seconds: 7 },
  { name: 'brood', wave: 4, seconds: 14 },
  {
    name: 'brood-hurt',
    wave: 4,
    seconds: 12,
    setup: (run) => {
      const parts = run.boss!.parts;
      parts[0].hp = 0;
      parts[1].hp = 0;
      parts[2].hp = 3;
      parts[3].flash = 5;
      parts[5].hp = 6;
      run.boss!.phase = 2;
    },
  },
  {
    name: 'hive-phase1',
    wave: 9,
    seconds: 9,
  },
  {
    name: 'hive-phase2',
    wave: 9,
    seconds: 14,
    setup: (run) => {
      const core = run.boss!.parts[8];
      core.hp = Math.floor(core.maxHp * 0.6);
    },
  },
  {
    name: 'hive-phase3',
    wave: 9,
    seconds: 14,
    setup: (run) => {
      const core = run.boss!.parts[8];
      core.hp = Math.floor(core.maxHp * 0.3);
    },
  },
  {
    name: 'loaded',
    wave: 3,
    seconds: 6,
    ship: 'bastion',
    setup: (run) => {
      const p = run.players[0];
      upgrades(run, ['rapidFire', 'rapidFire', 'twinShot', 'piercing', 'wingman', 'chainSpark', 'overcharge', 'doubleTap']);
      p.synergies.push('lance', 'storm');
      p.stats.wingmen = 1;
      p.stats.shieldPerWave = 2;
      p.shield = 2;
      p.stats.shotsPerVolley = 2;
      p.stats.spreadAngle = 0.12;
      p.stats.overchargeEvery = 3;
      activatePowerUp(p, 'laser' as PowerUpKind);
      activatePowerUp(p, 'helper' as PowerUpKind);
      activatePowerUp(p, 'spread' as PowerUpKind);
      p.specialCharge = 1;
    },
  },
  {
    name: 'frozen-well',
    wave: 6,
    seconds: 5,
    ship: 'lancer',
    special: 'gravityWell',
    setup: (run) => {
      run.freeze = 5;
      applyRunEffect(run, 'slow');
      run.players[0].specialCharge = 0.6;
    },
    tick: (run) => {
      run.well = { x: 0, y: 0, timeLeft: 2, playerId: 0 };
    },
  },
  { name: 'interceptor', wave: 1, seconds: 3, ship: 'interceptor', special: 'shieldBurst' },
];

describe('framePng', () => {
  it('writes a PNG of the right size', () => {
    const frame = new Frame(4, 2);
    frame.pixel(0, 0, 0xff0000);
    frame.text(1, 1, 'A', 0x00ff00, 0x0000ff);
    const png = framePng(frame);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it('plays the scenes and writes them when HIVEBREAK_SHOTS is set', () => {
    if (DIR) mkdirSync(DIR, { recursive: true });
    for (const scene of SCENES) {
      if (!DIR && scene.name !== 'wave1') continue;
      const { frame } = play(scene);
      if (DIR) {
        writeFileSync(`${DIR}/${scene.name}.png`, framePng(frame, 2));
        writeFileSync(`${DIR}/${scene.name}.txt`, frameText(frame).join('\n'));
      }
    }
  });
});
