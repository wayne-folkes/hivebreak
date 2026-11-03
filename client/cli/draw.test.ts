import { describe, expect, it } from 'vitest';
import { FieldView } from './draw';
import type { HudInfo } from './draw';
import { MAX_PARTICLES } from './effects';
import { Frame } from './frame';
import type { Rgb } from './frame';
import { FIELD_COLS, FIELD_PX_H, FIELD_PX_W, computeLayout, toPixel } from './layout';
import type { Layout } from './layout';
import { ALIEN_COLOUR, SHIP_COLOUR } from './sprites';
import { SHIP_Y } from '../src/game/player';
import { chooseSpecial, createRun, stepRun } from '../src/game/run';
import type { RunEvent, RunState, ShipId, ShipInput } from '../src/game/types';
import { formatScore } from '../src/ui/format';

const HUD: HudInfo = { best: 4321, demo: false, autofire: false, keyMode: 'release' };
const MIN = computeLayout(62, 42) as Layout;
const WIDE = computeLayout(120, 50) as Layout;
const IDLE: ShipInput = { move: 0, drag: 0, fire: false, special: false };

/** A run that has left the Special choice and is in the wave's intro or play. */
function startedRun(wave = 0, ship: ShipId = 'breaker'): RunState {
  const run = createRun(11, 1, wave, { ships: [ship] });
  chooseSpecial(run, 'pulseBomb');
  return run;
}

function step(run: RunState, seconds: number, input: ShipInput = IDLE): RunEvent[] {
  const events: RunEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...stepRun(run, [input], 1 / 60));
  return events;
}

function render(view: FieldView, run: RunState, layout: Layout, hud: HudInfo = HUD, dt = 1 / 60): Frame {
  const frame = new Frame(layout.cols, layout.rows);
  view.draw(frame, layout, run, hud, dt);
  return frame;
}

/** The text on a row of cells (pixel cells read as spaces). */
function rowText(frame: Frame, row: number): string {
  let s = '';
  for (let c = 0; c < frame.cols; c++) {
    const ch = frame.chars[row * frame.cols + c];
    s += ch === '' ? ' ' : ch;
  }
  return s;
}

function allText(frame: Frame): string {
  const rows: string[] = [];
  for (let r = 0; r < frame.rows; r++) rows.push(rowText(frame, r));
  return rows.join('\n');
}

/** Does this colour appear in the field pixels within a box (inclusive), given in field pixels? */
function hasColour(frame: Frame, layout: Layout, colour: Rgb, x0: number, y0: number, x1: number, y1: number): boolean {
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(FIELD_PX_H - 1, Math.ceil(y1)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(FIELD_PX_W - 1, Math.ceil(x1)); x++) {
      if (frame.pixelAt(layout.fieldCol + x, layout.fieldRow * 2 + y) === colour) return true;
    }
  }
  return false;
}

describe('FieldView', () => {
  it('draws a fresh run without throwing, at the smallest layout and a wide one', () => {
    for (const layout of [MIN, WIDE]) {
      const view = new FieldView();
      const run = createRun(1);
      expect(() => render(view, run, layout)).not.toThrow();
      chooseSpecial(run, 'timeStop');
      expect(() => render(view, run, layout)).not.toThrow();
    }
  });

  it('draws the ship in its colour near the bottom at its x', () => {
    for (const ship of ['breaker', 'interceptor', 'lancer', 'bastion'] as const) {
      const run = startedRun(0, ship);
      run.players[0].x = -50;
      const { px, py } = toPixel(-50, SHIP_Y);
      const frame = render(new FieldView(), run, MIN);
      expect(hasColour(frame, MIN, SHIP_COLOUR[ship], px - 4, py - 4, px + 4, py + 4), ship).toBe(true);
      expect(py).toBeGreaterThan(FIELD_PX_H - 14);
    }
  });

  it('blinks the ship while it cannot be hurt, but still draws it', () => {
    const run = startedRun();
    run.players[0].invulnerable = 1;
    const { px, py } = toPixel(0, SHIP_Y);
    let bright = 0;
    for (let i = 0; i < 12; i++) {
      run.time = i / 24;
      const frame = render(new FieldView(), run, MIN, HUD, 0);
      if (hasColour(frame, MIN, SHIP_COLOUR.breaker, px - 4, py - 4, px + 4, py + 4)) bright++;
    }
    expect(bright).toBeGreaterThan(0);
    expect(bright).toBeLessThan(12);
  });

  it('draws an alien in its kind colour at its position', () => {
    const run = startedRun(1);
    step(run, 2);
    expect(run.aliens.length).toBeGreaterThan(0);
    const frame = render(new FieldView(), run, MIN);
    for (const a of run.aliens.filter((x) => x.mode === 'formation').slice(0, 6)) {
      const { px, py } = toPixel(a.x, a.y);
      const near = (c: Rgb) => hasColour(frame, MIN, c, px - 4, py - 3, px + 4, py + 3);
      // Body or highlight: the highlight is a lighter shade of the same hue.
      expect(near(ALIEN_COLOUR[a.kind]) || near(0xffffff), a.kind).toBe(true);
    }
  });

  it('draws the bunkers, and shows them eroded', () => {
    const run = startedRun();
    expect(run.bunkers.length).toBeGreaterThan(0);
    const b = run.bunkers[0];
    const { px, py } = toPixel(b.x + b.width / 2, b.y + b.height / 2);
    const count = (frame: Frame) => {
      let n = 0;
      for (let y = py - 3; y <= py + 3; y++) {
        for (let x = px - 5; x <= px + 5; x++) {
          const c = frame.pixelAt(MIN.fieldCol + x, MIN.fieldRow * 2 + Math.floor(y));
          if (c === 0x3fd6a0 || c === 0x7af0c8 || c === 0x1f7a66) n++;
        }
      }
      return n;
    };
    const whole = count(render(new FieldView(), run, MIN));
    expect(whole).toBeGreaterThan(8);
    b.mask.fill(0);
    expect(count(render(new FieldView(), run, MIN))).toBe(0);
  });

  it('draws a shot anywhere inside the field, however fast it moves', () => {
    const run = startedRun();
    const base = { owner: 'player' as const, kind: 'normal' as const, playerId: 0, vx: 0, vy: 600, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: 1 };
    run.shots.push({ ...base, id: 900, x: 20, y: 40 });
    run.shots.push({ ...base, id: 901, x: -88, y: 150, kind: 'lance' });
    run.shots.push({ ...base, id: 902, x: 40, y: -60, owner: 'alien', kind: 'enemy', vy: -90 });
    const frame = render(new FieldView(), run, MIN);
    const a = toPixel(20, 40);
    expect(hasColour(frame, MIN, 0xffffff, a.px - 1, a.py - 2, a.px + 1, a.py + 2)).toBe(true);
    const l = toPixel(-88, 150);
    expect(hasColour(frame, MIN, 0xffffff, l.px - 1, l.py - 2, l.px + 1, l.py + 2)).toBe(true);
    const e = toPixel(40, -60);
    expect(hasColour(frame, MIN, 0xffb04f, e.px - 1, e.py - 2, e.px + 1, e.py + 2)).toBe(true);
  });

  it('draws both boss waves, with the boss bar', () => {
    for (const [wave, label] of [
      [4, 'BROOD MOTHER'],
      [9, 'HIVE MIND · PHASE 1'],
    ] as const) {
      const view = new FieldView();
      const run = startedRun(wave);
      const events: RunEvent[] = [];
      for (let i = 0; i < 12; i++) {
        events.push(...step(run, 1, { move: Math.sin(i), drag: 0, fire: true, special: false }));
        view.events(events.splice(0), run);
        expect(() => render(view, run, WIDE)).not.toThrow();
      }
      expect(run.boss).not.toBeNull();
      const frame = render(view, run, MIN);
      expect(rowText(frame, MIN.fieldRow)).toContain(label);
    }
  });

  it('draws the Hive Mind in its core colour and shows its beams', () => {
    const run = startedRun(9);
    step(run, 6);
    const boss = run.boss!;
    boss.y = 64;
    boss.beams = [
      { angle: -Math.PI / 2, sweep: 0, state: 'fire', timeLeft: 0.5 },
      { angle: -Math.PI / 2 - 0.4, sweep: 0, state: 'warn', timeLeft: 1 },
    ];
    run.time = 0; // blink phase on
    const frame = render(new FieldView(), run, MIN);
    const c = toPixel(boss.x, boss.y);
    // The core is pink to white; nothing else near it is.
    let pink = 0;
    for (let y = Math.floor(c.py) - 2; y <= Math.floor(c.py) + 2; y++) {
      for (let x = Math.floor(c.px) - 3; x <= Math.floor(c.px) + 3; x++) {
        const px = frame.pixelAt(MIN.fieldCol + x, MIN.fieldRow * 2 + y);
        if (((px >> 16) & 255) > 0xc0 && (px & 255) > 0x80) pink++;
      }
    }
    expect(pink).toBeGreaterThan(4);
    // The firing beam runs straight down from the core: a white column below it.
    expect(hasColour(frame, MIN, 0xffffff, c.px - 1, c.py + 10, c.px + 1, c.py + 14)).toBe(true);
  });

  it('shows a wave banner after a waveStart event, and not before', () => {
    const view = new FieldView();
    const run = startedRun();
    expect(allText(render(view, run, MIN))).not.toContain('W A V E');
    view.events([{ type: 'waveStart', wave: 2 }], run);
    const frame = render(view, run, MIN);
    expect(allText(frame)).toContain('W A V E   3');
    // It goes away once WAVE_INTRO_SECONDS have passed (a pause, dt 0, keeps it).
    expect(allText(render(view, run, MIN, HUD, 0))).toContain('W A V E');
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    render(view, run, MIN, HUD, 0.2);
    expect(allText(render(view, run, MIN, HUD, 0.2))).not.toContain('W A V E');
  });

  it('shows the sector banner instead when a sector starts, and boss, phase and synergy banners', () => {
    const view = new FieldView();
    const run = startedRun(5);
    view.events([{ type: 'sectorStart', sector: 2 }, { type: 'waveStart', wave: 5 }], run);
    const text = allText(render(view, run, MIN));
    expect(text).toContain('S E C T O R   2');
    expect(text).not.toContain('W A V E');

    const boss = startedRun(9);
    step(boss, 5);
    const v2 = new FieldView();
    v2.events([{ type: 'waveStart', wave: 9 }], boss);
    expect(allText(render(v2, boss, MIN))).toContain('BOSS: HIVE MIND');
    v2.events([{ type: 'bossPhase', phase: 2 }, { type: 'synergyUnlocked', playerId: 0, synergy: 'lance' }], boss);
    const t2 = allText(render(v2, boss, MIN));
    expect(t2).toContain('P H A S E   2');
    expect(t2).toContain('SYNERGY: LANCE');
  });

  it('writes the score, combo, wave and best in the top line', () => {
    const run = startedRun();
    run.score = 4250;
    run.combo = 3;
    const frame = render(new FieldView(), run, MIN);
    const top = rowText(frame, MIN.topRow);
    expect(top).toContain(formatScore(4250));
    expect(top).toContain('x3');
    expect(top).toContain('WAVE 1/10');
    expect(top).toContain(`BEST ${formatScore(4321)}`);
  });

  it('writes lives, the Special meter, READY, power-up chips and AUTO in the bottom line', () => {
    const run = startedRun();
    const p = run.players[0];
    p.shield = 1;
    p.specialCharge = 0.4;
    p.powerUps.push({ kind: 'laser', timeLeft: 5.2 });
    let bottom = rowText(render(new FieldView(), run, MIN, { ...HUD, autofire: true }), MIN.bottomRow);
    expect(bottom).toContain('♥♥♥');
    expect(bottom).toContain('SHIELD x1');
    expect(bottom).toContain('PULSE');
    expect(bottom).not.toContain('READY');
    expect(bottom).toContain('LASER 6s');
    expect(bottom).toContain('AUTO');
    p.specialCharge = 1;
    bottom = rowText(render(new FieldView(), run, MIN), MIN.bottomRow);
    expect(bottom).toContain('READY');
    expect(bottom).not.toContain('AUTO');
  });

  it('keeps the bottom line inside the field width when everything is showing', () => {
    const run = startedRun();
    const p = run.players[0];
    p.lives = 8;
    p.shield = 3;
    p.specialCharge = 1;
    p.powerUps.push({ kind: 'spread', timeLeft: 9 }, { kind: 'laser', timeLeft: 8 }, { kind: 'slow', timeLeft: 8 }, { kind: 'helper', timeLeft: 10 });
    const frame = render(new FieldView(), run, MIN, { ...HUD, autofire: true });
    expect(rowText(frame, MIN.bottomRow)).toContain('AUTO');
    expect(rowText(frame, MIN.bottomRow).length).toBe(MIN.cols);
  });

  it('draws the boss health bar only on boss waves', () => {
    const run = startedRun();
    const row = rowText(render(new FieldView(), run, MIN), MIN.fieldRow);
    expect(row.slice(MIN.fieldCol, MIN.fieldCol + FIELD_COLS).trim()).toBe('');
  });

  it('draws the walls and, in the wide layout, the panels', () => {
    const run = startedRun();
    run.players[0].upgrades.push('rapidFire', 'rapidFire', 'piercing', 'chainSpark');
    run.players[0].synergies.push('lance');
    const wide = render(new FieldView(), run, WIDE, { ...HUD, keyMode: 'repeat' });
    const text = allText(wide);
    expect(text).toContain('BREAKER');
    expect(text).toContain('Rapid fire x2');
    expect(text).toContain('Piercing shots');
    expect(text).toContain('Lance');
    expect(text).toContain('CONTROLS');
    expect(text).toContain('Esc');
    expect(text).toContain('report key releases');
    const row = WIDE.fieldRow + 5;
    expect(wide.chars[row * wide.cols + WIDE.fieldCol - 1]).toBe('│');
    expect(wide.chars[row * wide.cols + WIDE.fieldCol + FIELD_COLS]).toBe('│');

    const narrow = allText(render(new FieldView(), run, MIN, { ...HUD, keyMode: 'repeat' }));
    expect(narrow).not.toContain('CONTROLS');
    expect(narrow).not.toContain('BREAKER');
  });

  it('draws only the field in demo mode', () => {
    const run = startedRun();
    step(run, 2);
    const frame = render(new FieldView(), run, WIDE, { ...HUD, demo: true });
    for (const row of [WIDE.topRow, WIDE.bottomRow]) {
      for (let c = 0; c < frame.cols; c++) expect(frame.chars[row * frame.cols + c]).toBe('');
    }
    expect(allText(frame).trim()).toBe('');
    // ...and the field itself is there.
    const a = run.aliens[0];
    const { px, py } = toPixel(a.x, a.y);
    expect(hasColour(frame, WIDE, ALIEN_COLOUR.drone, px - 4, py - 3, px + 4, py + 3)).toBe(true);
    // Not even a banner.
    const view = new FieldView();
    view.events([{ type: 'waveStart', wave: 0 }], run);
    expect(allText(render(view, run, WIDE, { ...HUD, demo: true })).trim()).toBe('');
  });

  it('draws effects for events and ages them away', () => {
    const view = new FieldView();
    const run = startedRun(1);
    step(run, 2);
    const a = run.aliens[0];
    view.events([{ type: 'alienKilled', alienId: a.id, kind: a.kind, x: a.x, y: a.y, points: 10, combo: 1 }], run);
    expect(view.effectCount).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) render(view, run, MIN, HUD, 0.05);
    expect(view.effectCount).toBe(0);
  });

  it('does not age effects while paused (dt 0)', () => {
    const view = new FieldView();
    const run = startedRun();
    view.events([{ type: 'blast', x: 0, y: 0, radius: 30 }], run);
    const n = view.effectCount;
    for (let i = 0; i < 10; i++) render(view, run, MIN, HUD, 0);
    expect(view.effectCount).toBe(n);
  });

  it('caps how many effects pile up', () => {
    const view = new FieldView();
    const run = startedRun();
    const events: RunEvent[] = [];
    for (let i = 0; i < 400; i++) {
      events.push({ type: 'alienKilled', alienId: i, kind: 'carrier', x: (i % 17) * 8 - 64, y: 60, points: 60, combo: 1 });
      events.push({ type: 'bossKilled', kind: 'hiveMind', x: 0, y: 60, points: 1 });
      events.push({ type: 'chainSpark', fromX: 0, fromY: 0, toX: 40, toY: 40 });
    }
    view.events(events, run);
    expect(view.effectCount).toBeLessThanOrEqual(MAX_PARTICLES + 24 + 24);
    expect(() => render(view, run, MIN)).not.toThrow();
  });

  it('reacts to every kind of event without throwing', () => {
    const view = new FieldView();
    const run = startedRun();
    const p = { x: 10, y: 20 };
    const events: RunEvent[] = [
      { type: 'specialChosen', playerId: 0, special: 'pulseBomb' },
      { type: 'playerFired', playerId: 0, shots: 1 },
      { type: 'alienFired', ...p },
      { type: 'alienHit', alienId: 1, kind: 'drone', ...p },
      { type: 'diveStart', alienId: 1 },
      { type: 'comboBroken', combo: 3 },
      { type: 'comboGuarded', playerId: 0 },
      { type: 'shieldHit', playerId: 0 },
      { type: 'playerHit', playerId: 0, livesLeft: 2 },
      { type: 'playerHit', playerId: 0, livesLeft: 0 },
      { type: 'blast', ...p, radius: 28 },
      { type: 'pickupSpawned', pickupId: 1, kind: 'spread', ...p },
      { type: 'pickupCollected', playerId: 0, pickupId: 1, kind: 'laser' },
      { type: 'powerUpEnded', playerId: 0, kind: 'laser' },
      { type: 'specialReady', playerId: 0 },
      { type: 'specialFired', playerId: 0, special: 'pulseBomb', ...p },
      { type: 'specialFired', playerId: 0, special: 'shieldBurst', ...p },
      { type: 'specialFired', playerId: 0, special: 'timeStop', ...p },
      { type: 'specialFired', playerId: 0, special: 'missileSwarm', ...p },
      { type: 'specialFired', playerId: 0, special: 'gravityWell', ...p },
      { type: 'shotReflected', ...p },
      { type: 'bossLaunched', alienId: 1 },
      { type: 'bossFired', ...p },
      { type: 'bossPartHit', partId: 1, part: 'plate', ...p },
      { type: 'coreBlocked', ...p },
      { type: 'bossPartDestroyed', partId: 1, part: 'bay', ...p, points: 100 },
      { type: 'bossPhase', phase: 2 },
      { type: 'bossKilled', kind: 'broodMother', ...p, points: 2000 },
      { type: 'waveClear', wave: 0 },
      { type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' },
      { type: 'bunkerHit', bunkerId: 1, ...p },
      { type: 'alienSplit', alienId: 1, ...p },
      { type: 'formationSplit' },
      { type: 'formationRegroup' },
      { type: 'bossBeam', state: 'warn', angle: 1 },
      { type: 'chainSpark', fromX: 0, fromY: 0, toX: 30, toY: 30 },
      { type: 'wellConsumed', ...p },
      { type: 'won' },
      { type: 'lost', reason: 'lives' },
    ];
    expect(() => {
      view.events(events, run);
      for (let i = 0; i < 20; i++) render(view, run, WIDE, HUD, 0.03);
    }).not.toThrow();
    view.reset();
    expect(view.effectCount).toBe(0);
  });

  it('survives odd states: no players, won and lost phases, things off the field, Time Stop, slow, a well', () => {
    const view = new FieldView();
    const run = startedRun(5);
    step(run, 3);
    run.players = [];
    expect(() => render(view, run, MIN)).not.toThrow();
    expect(() => render(view, run, WIDE)).not.toThrow();

    const odd = startedRun(4);
    step(odd, 4);
    odd.phase = 'won';
    odd.freeze = 2;
    odd.slow = 2;
    odd.stun = 1;
    odd.well = { x: 400, y: -900, timeLeft: 1, playerId: 0 };
    odd.pickups.push({ id: 5, kind: 'slow', x: -400, y: 50 }, { id: 6, kind: 'helper', x: 0, y: 5000 });
    odd.shots.push({ id: 77, owner: 'alien', kind: 'enemy', playerId: null, x: Number.NaN, y: 10, vx: 0, vy: -50, pierceLeft: 0, damage: 1, homing: 0, bouncesLeft: 0, hits: 0, volley: 1 });
    odd.aliens.push({ id: 99, kind: 'mini', hp: 1, col: -1, row: -1, x: 9999, y: -9999, mode: 'free', modeTime: 0, flash: 1 });
    odd.beams.push({ playerId: 0, x: 500, topY: 9000 });
    odd.phase = 'lost';
    odd.players[0].lives = 0;
    expect(() => render(view, odd, MIN, HUD, Number.NaN)).not.toThrow();
    expect(() => render(view, odd, WIDE, HUD, 5)).not.toThrow();
  });

  it('draws the Time Stop, slow and Shield Burst looks', () => {
    const base = startedRun(1);
    step(base, 2);
    const normal = render(new FieldView(), base, MIN);
    const frozen = startedRun(1);
    step(frozen, 2);
    frozen.freeze = 2;
    const f = render(new FieldView(), frozen, MIN);
    // The sky itself changes colour.
    expect(f.pixelAt(MIN.fieldCol + 30, MIN.fieldRow * 2 + 40)).not.toBe(normal.pixelAt(MIN.fieldCol + 30, MIN.fieldRow * 2 + 40));
    const burst = startedRun();
    burst.players[0].burst = 2;
    burst.players[0].invulnerable = 2;
    const b = render(new FieldView(), burst, MIN);
    const { px, py } = toPixel(0, SHIP_Y);
    expect(hasColour(b, MIN, 0xffffff, px - 8, py - 8, px + 8, py + 8) || hasColour(b, MIN, 0x9dfafd, px - 8, py - 8, px + 8, py + 8)).toBe(true);
  });

  it('draws a laser column from the ship up to where it stops', () => {
    const run = startedRun();
    run.players[0].x = 0;
    run.beams.push({ playerId: 0, x: 0, topY: 60 });
    const frame = render(new FieldView(), run, MIN);
    const top = toPixel(0, 60);
    const x = Math.floor(top.px);
    let lit = 0;
    for (let y = Math.ceil(top.py); y < FIELD_PX_H - 12; y++) {
      const c = frame.pixelAt(MIN.fieldCol + x, MIN.fieldRow * 2 + y);
      if (c === 0xffffff || c === 0x9dfafd || c === 0x52ddeb) lit++;
    }
    expect(lit).toBeGreaterThan((FIELD_PX_H - 12 - top.py) * 0.9);
  });
});
