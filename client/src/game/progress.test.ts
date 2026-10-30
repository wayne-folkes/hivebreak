import { describe, expect, it } from 'vitest';
import {
  HIVE_MIND_WAVE,
  MILESTONES,
  PROGRESS_KEY,
  SECTOR_2_WAVE,
  STARTING_SHIPS,
  STARTING_SPECIALS,
  STARTING_UPGRADES,
  completeRun,
  emptyProgress,
  exportCode,
  importCode,
  isUnlocked,
  loadProgress,
  milestoneFor,
  newSummary,
  nextGoals,
  recordEvents,
  saveProgress,
  unlockedShips,
  unlockedSpecials,
  unlockedUpgrades,
} from './progress';
import type { MilestoneId, Progress, RunSummary, Totals } from './progress';
import type { StorageLike } from './records';
import { SHIP_IDS } from './ships';
import { SPECIAL_IDS } from './special';
import type { RunEvent, RunState, ShipId } from './types';
import { UPGRADES } from './upgrades';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const runWith = (bestCombo = 1): RunState => ({ bestCombo }) as RunState;
const fold = (summary: RunSummary, events: RunEvent[], bestCombo = 1): void => recordEvents(summary, events, runWith(bestCombo));
const fresh = () => newSummary('breaker', 'pulseBomb');
const progressWith = (p: Omit<Partial<Progress>, 'totals'> & { totals?: Partial<Totals> }): Progress => {
  const base = emptyProgress();
  return { ...base, ...p, totals: { ...base.totals, ...p.totals } } as Progress;
};

const waveStart = (wave: number): RunEvent => ({ type: 'waveStart', wave });
const waveClear = (wave: number): RunEvent => ({ type: 'waveClear', wave });
const comboBroken: RunEvent = { type: 'comboBroken', combo: 3 };
const playerHit: RunEvent = { type: 'playerHit', playerId: 0, livesLeft: 2 };
const bossKilled = (kind: 'broodMother' | 'hiveMind'): RunEvent => ({ type: 'bossKilled', kind, x: 0, y: 0, points: 500 });
const alienKilled: RunEvent = { type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo: 1 };

describe('newSummary', () => {
  it('starts empty for the chosen ship and Special', () => {
    const s = newSummary('lancer', 'timeStop');
    expect(s).toMatchObject({ ship: 'lancer', special: 'timeStop', finished: false, won: false, reachedWave: 0, kills: 0 });
    expect(s.bossesKilled).toEqual([]);
  });
});

describe('recordEvents', () => {
  it('tracks the highest wave started', () => {
    const s = fresh();
    fold(s, [waveStart(0), waveStart(1)]);
    fold(s, [waveStart(3)]);
    fold(s, [waveStart(2)]);
    expect(s.reachedWave).toBe(3);
  });

  it('counts waves cleared', () => {
    const s = fresh();
    fold(s, [waveStart(0), waveClear(0), waveStart(1)]);
    fold(s, [waveClear(1)]);
    expect(s.wavesCleared).toBe(2);
  });

  it('counts a clean wave only if no combo broke since its start, and resets per wave', () => {
    const s = fresh();
    fold(s, [waveStart(0), comboBroken, waveClear(0)]);
    expect(s.cleanWaves).toBe(0);
    fold(s, [waveStart(1)]);
    fold(s, [waveClear(1)]);
    expect(s.cleanWaves).toBe(1);
    fold(s, [waveStart(2), comboBroken]);
    fold(s, [waveClear(2)]);
    expect(s.cleanWaves).toBe(1);
    fold(s, [waveStart(3), waveClear(3)]);
    expect(s.cleanWaves).toBe(2);
    expect(s.wavesCleared).toBe(4);
  });

  it('records bosses and flawless bosses', () => {
    const s = fresh();
    fold(s, [waveStart(4), bossKilled('broodMother')]);
    expect(s.bossesKilled).toEqual(['broodMother']);
    expect(s.flawlessBosses).toEqual(['broodMother']);
  });

  it('a life lost during the boss wave spoils flawless; a shield hit does not', () => {
    const spoiled = fresh();
    fold(spoiled, [waveStart(4)]);
    fold(spoiled, [playerHit]);
    fold(spoiled, [bossKilled('broodMother')]);
    expect(spoiled.bossesKilled).toEqual(['broodMother']);
    expect(spoiled.flawlessBosses).toEqual([]);

    const shielded = fresh();
    fold(shielded, [waveStart(4), { type: 'shieldHit', playerId: 0 }, bossKilled('broodMother')]);
    expect(shielded.flawlessBosses).toEqual(['broodMother']);
  });

  it('a life lost in an earlier wave does not spoil a later boss', () => {
    const s = fresh();
    fold(s, [waveStart(2), playerHit, waveClear(2), waveStart(4), bossKilled('broodMother')]);
    expect(s.flawlessBosses).toEqual(['broodMother']);
  });

  it('keeps the highest combo from the run', () => {
    const s = fresh();
    fold(s, [], 5);
    fold(s, [], 3);
    expect(s.bestCombo).toBe(5);
    fold(s, [], 8);
    expect(s.bestCombo).toBe(8);
  });

  it('counts synergies, pickups, specials and kills', () => {
    const s = fresh();
    fold(s, [
      { type: 'synergyUnlocked', playerId: 0, synergy: 'lance' },
      { type: 'pickupCollected', playerId: 0, pickupId: 1, kind: 'spread' },
      { type: 'pickupCollected', playerId: 0, pickupId: 2, kind: 'spread' },
      { type: 'specialFired', playerId: 0, special: 'pulseBomb', x: 0, y: 0 },
      alienKilled,
      alienKilled,
      alienKilled,
    ]);
    expect(s).toMatchObject({ synergies: 1, pickups: 2, specials: 1, kills: 3 });
  });

  it('won and lost finish the run; only won sets won', () => {
    const w = fresh();
    fold(w, [{ type: 'won' }]);
    expect(w).toMatchObject({ finished: true, won: true });
    const l = fresh();
    fold(l, [{ type: 'lost', reason: 'lives' }]);
    expect(l).toMatchObject({ finished: true, won: false });
    const q = fresh();
    fold(q, [alienKilled]);
    expect(q.finished).toBe(false);
  });

  it('keeps separate summaries separate', () => {
    const a = fresh();
    const b = fresh();
    fold(a, [waveStart(0), comboBroken]);
    fold(b, [waveStart(0), waveClear(0)]);
    expect(b.cleanWaves).toBe(1);
  });
});

describe('completeRun', () => {
  it('adds a finished run to the totals', () => {
    const s = { ...fresh(), finished: true, kills: 40, specials: 3 };
    const { progress } = completeRun(emptyProgress(), s);
    expect(progress.totals).toEqual({ runs: 1, kills: 40, specials: 3, winningShips: [] });
  });

  it('a quit adds kills and specials but not a run', () => {
    const s = { ...fresh(), finished: false, kills: 40, specials: 3 };
    const { progress } = completeRun(progress1(), s);
    expect(progress.totals).toEqual({ runs: 2, kills: 50, specials: 4, winningShips: [] });
  });

  it('adds the ship to winningShips on a win, once, in order', () => {
    let p = emptyProgress();
    p = completeRun(p, { ...newSummary('breaker', 'pulseBomb'), finished: true, won: true }).progress;
    p = completeRun(p, { ...newSummary('breaker', 'pulseBomb'), finished: true, won: true }).progress;
    p = completeRun(p, { ...newSummary('lancer', 'pulseBomb'), finished: true, won: true }).progress;
    expect(p.totals.winningShips).toEqual(['breaker', 'lancer']);
    const lost = completeRun(p, { ...newSummary('bastion', 'pulseBomb'), finished: true, won: false }).progress;
    expect(lost.totals.winningShips).toEqual(['breaker', 'lancer']);
  });

  it('returns met milestones in MILESTONES order and appends them to the progress', () => {
    const s = { ...fresh(), wavesCleared: 3, cleanWaves: 1, synergies: 1, bestCombo: 8, reachedWave: SECTOR_2_WAVE };
    const { progress, met } = completeRun(emptyProgress(), s);
    expect(met.map((m) => m.id)).toEqual(['firstSteps', 'unbroken', 'synergist', 'comboMaster', 'deepSpace']);
    expect(progress.milestones).toEqual(met.map((m) => m.id));
  });

  it('appends new milestones after the ones already met', () => {
    const start = progressWith({ milestones: ['deepSpace'] });
    const { progress, met } = completeRun(start, { ...fresh(), wavesCleared: 3 });
    expect(met.map((m) => m.id)).toEqual(['firstSteps']);
    expect(progress.milestones).toEqual(['deepSpace', 'firstSteps']);
  });

  it('does not meet a milestone twice', () => {
    const s = { ...fresh(), wavesCleared: 3 };
    const first = completeRun(emptyProgress(), s);
    const second = completeRun(first.progress, s);
    expect(second.met).toEqual([]);
    expect(second.progress.milestones).toEqual(['firstSteps']);
  });

  it('checks milestones on a quit too', () => {
    const { met } = completeRun(emptyProgress(), { ...fresh(), finished: false, wavesCleared: 3 });
    expect(met.map((m) => m.id)).toEqual(['firstSteps']);
  });

  it('does not change the progress passed in', () => {
    const start = progressWith({ milestones: ['firstSteps'], totals: { runs: 1, winningShips: ['breaker'] } });
    const frozen = JSON.stringify(start);
    const s = { ...fresh(), finished: true, won: true, kills: 5, wavesCleared: 3 };
    const out = completeRun(start, s);
    expect(JSON.stringify(start)).toBe(frozen);
    expect(out.progress).not.toBe(start);
    expect(out.progress.totals.winningShips).not.toBe(start.totals.winningShips);
  });

  it('checks the totals with the run already added', () => {
    const start = progressWith({ totals: { kills: 290 } });
    const { met } = completeRun(start, { ...fresh(), kills: 10 });
    expect(met.map((m) => m.id)).toEqual(['exterminator']);
  });
});

function progress1(): Progress {
  return progressWith({ totals: { runs: 2, kills: 10, specials: 1 } });
}

// Each milestone, with a run (and the totals before it) that meets it.
const SCENARIOS: Record<MilestoneId, { run?: Partial<RunSummary>; before?: Partial<Totals> }> = {
  firstSteps: { run: { wavesCleared: 3 } },
  unbroken: { run: { cleanWaves: 1 } },
  synergist: { run: { synergies: 1 } },
  collector: { run: { pickups: 10 } },
  specialist: { run: { specials: 5 } },
  comboMaster: { run: { bestCombo: 8 } },
  deepSpace: { run: { reachedWave: SECTOR_2_WAVE } },
  broodSlayer: { run: { bossesKilled: ['broodMother'] } },
  untouched: { run: { bossesKilled: ['broodMother'], flawlessBosses: ['broodMother'] } },
  overdrive: { run: { specials: 2 }, before: { specials: 18 } },
  exterminator: { run: { kills: 50 }, before: { kills: 250 } },
  hiveReached: { run: { reachedWave: HIVE_MIND_WAVE } },
  veteran: { run: { finished: true }, before: { runs: 9 } },
  victor: { run: { finished: true, won: true } },
  frozenVictory: { run: { finished: true, won: true, special: 'timeStop' } },
  fleet: { run: { finished: true, won: true, ship: 'interceptor' }, before: { winningShips: ['breaker'] } },
};

describe('milestones', () => {
  it('has a scenario for every milestone, with ids that are unique', () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(SCENARIOS).sort()).toEqual([...ids].sort());
  });

  it('none is met by a run that did nothing', () => {
    const { met } = completeRun(emptyProgress(), fresh());
    expect(met).toEqual([]);
  });

  it('every reward is unique, and none is in the starting pool', () => {
    const keys = MILESTONES.map((m) => `${m.reward.kind}:${m.reward.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of MILESTONES) expect(isUnlocked(emptyProgress(), m.reward)).toBe(false);
  });

  for (const m of MILESTONES) {
    it(`${m.id}: met by a crafted run, and its reward is then unlocked`, () => {
      const sc = SCENARIOS[m.id];
      const before = progressWith({ totals: sc.before });
      const run = { ...fresh(), ...sc.run };
      const { progress, met } = completeRun(before, run);
      expect(met.map((x) => x.id)).toContain(m.id);
      expect(progress.milestones).toContain(m.id);
      expect(isUnlocked(progress, m.reward)).toBe(true);
      expect(isUnlocked(before, m.reward)).toBe(false);
    });

    it(`${m.id}: not met just short of the mark`, () => {
      const sc = SCENARIOS[m.id];
      // The same scenario with nothing from the run and the totals untouched can't meet it.
      const { met } = completeRun(progressWith({ totals: sc.before }), fresh());
      expect(met.map((x) => x.id)).not.toContain(m.id);
    });
  }

  it('progress meters read from the totals', () => {
    const totals: Totals = { runs: 4, kills: 120, specials: 7, winningShips: ['breaker'] };
    const byId = Object.fromEntries(MILESTONES.map((m) => [m.id, m.progress?.(totals)]));
    expect(byId.veteran).toEqual({ value: 4, target: 10 });
    expect(byId.exterminator).toEqual({ value: 120, target: 300 });
    expect(byId.overdrive).toEqual({ value: 7, target: 20 });
    expect(byId.fleet).toEqual({ value: 1, target: 2 });
  });

  it('a full chain through real events meets Untouched and Brood slayer', () => {
    const s = fresh();
    fold(s, [waveStart(0), waveClear(0), waveStart(4), bossKilled('broodMother'), waveClear(4), { type: 'won' }], 8);
    const { met } = completeRun(emptyProgress(), s);
    expect(met.map((m) => m.id)).toEqual(expect.arrayContaining(['broodSlayer', 'untouched', 'comboMaster', 'victor']));
  });
});

describe('unlock queries', () => {
  it('a new player has the starting pool', () => {
    const p = emptyProgress();
    expect(unlockedShips(p)).toEqual([...STARTING_SHIPS]);
    expect(unlockedSpecials(p)).toEqual([...STARTING_SPECIALS]);
    for (const id of STARTING_UPGRADES) expect(isUnlocked(p, { kind: 'upgrade', id })).toBe(true);
    expect(unlockedUpgrades(p).sort()).toEqual(
      UPGRADES.map((u) => u.id)
        .filter((id) => (STARTING_UPGRADES as readonly string[]).includes(id))
        .sort(),
    );
    expect(isUnlocked(p, { kind: 'ship', id: 'lancer' })).toBe(false);
    expect(isUnlocked(p, { kind: 'special', id: 'timeStop' })).toBe(false);
  });

  it('adds the rewards of met milestones, in catalogue order', () => {
    const p = progressWith({ milestones: ['broodSlayer', 'deepSpace', 'exterminator', 'hiveReached', 'specialist', 'victor'] });
    expect(unlockedShips(p)).toEqual([...SHIP_IDS]);
    expect(unlockedSpecials(p)).toEqual([...SPECIAL_IDS]);
    expect(isUnlocked(p, { kind: 'ship', id: 'bastion' })).toBe(true);
  });

  it('keeps ships in SHIP_IDS order whatever order milestones were met', () => {
    const p = progressWith({ milestones: ['exterminator', 'broodSlayer'] });
    expect(unlockedShips(p)).toEqual(['breaker', 'lancer', 'bastion']);
  });

  it('keeps upgrades in UPGRADES order', () => {
    const p = progressWith({ milestones: ['comboMaster', 'firstSteps'] });
    const got = unlockedUpgrades(p);
    const order = UPGRADES.map((u) => u.id);
    expect(got).toEqual(order.filter((id) => got.includes(id)));
    expect(got).toContain('ricochet');
    expect(got).toContain('overcharge');
    expect(got).not.toContain('bombOnKill');
  });

  it('milestoneFor finds the milestone, or null for the starting pool', () => {
    expect(milestoneFor({ kind: 'ship', id: 'lancer' })?.id).toBe('broodSlayer');
    expect(milestoneFor({ kind: 'special', id: 'timeStop' })?.id).toBe('specialist');
    expect(milestoneFor({ kind: 'upgrade', id: 'ricochet' })?.id).toBe('firstSteps');
    expect(milestoneFor({ kind: 'ship', id: 'breaker' })).toBeNull();
    expect(milestoneFor({ kind: 'upgrade', id: 'twinShot' })).toBeNull();
    for (const m of MILESTONES) expect(milestoneFor(m.reward)).toBe(m);
  });
});

describe('nextGoals', () => {
  it('is the first unmet milestones in table order', () => {
    expect(nextGoals(emptyProgress()).map((m) => m.id)).toEqual(MILESTONES.slice(0, 3).map((m) => m.id));
    const p = progressWith({ milestones: [MILESTONES[0].id, MILESTONES[2].id] });
    expect(nextGoals(p, 2).map((m) => m.id)).toEqual([MILESTONES[1].id, MILESTONES[3].id]);
  });

  it('is shorter when few are left, and empty when all are met', () => {
    const all = progressWith({ milestones: MILESTONES.map((m) => m.id) });
    expect(nextGoals(all)).toEqual([]);
    const nearly = progressWith({ milestones: MILESTONES.slice(0, -1).map((m) => m.id) });
    expect(nextGoals(nearly, 5).map((m) => m.id)).toEqual([MILESTONES[MILESTONES.length - 1].id]);
    expect(nextGoals(emptyProgress(), 0)).toEqual([]);
  });
});

const sample = (): Progress => ({
  version: 1,
  milestones: ['firstSteps', 'victor', 'fleet'],
  totals: { runs: 12, kills: 345, specials: 21, winningShips: ['breaker', 'lancer'] },
});

describe('save and load', () => {
  it('is empty with nothing saved', () => {
    expect(loadProgress(fakeStorage())).toEqual(emptyProgress());
  });

  it('round-trips', () => {
    const s = fakeStorage();
    saveProgress(s, sample());
    expect(s.data[PROGRESS_KEY]).toBeDefined();
    expect(loadProgress(s)).toEqual(sample());
  });

  it('survives corrupt data', () => {
    for (const bad of ['not json', '[]', '42', 'null', '"x"', '{}', '']) {
      expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: bad }))).toEqual(emptyProgress());
    }
  });

  it('rejects the wrong version', () => {
    for (const version of [0, 2, '1', null]) {
      expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify({ ...sample(), version }) }))).toEqual(emptyProgress());
    }
    const noVersion: Partial<Progress> = sample();
    delete noVersion.version;
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(noVersion) }))).toEqual(emptyProgress());
  });

  it('drops unknown and repeated milestones but keeps the rest', () => {
    const raw = { ...sample(), milestones: ['victor', 'bogus', 'firstSteps', 'victor', 7, null] };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(raw) })).milestones).toEqual(['victor', 'firstSteps']);
  });

  it('treats bad totals as 0', () => {
    const raw = { ...sample(), totals: { runs: -1, kills: 3.5, specials: '9', winningShips: ['breaker'] } };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(raw) })).totals).toEqual({
      runs: 0,
      kills: 0,
      specials: 0,
      winningShips: ['breaker'],
    });
    const huge = { ...sample(), totals: { runs: 1e400, kills: null, specials: 5 } };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(huge) })).totals).toMatchObject({ runs: 0, kills: 0, specials: 5 });
  });

  it('filters winningShips to known ships, without repeats', () => {
    const raw = { ...sample(), totals: { ...sample().totals, winningShips: ['lancer', 'tank', 'lancer', 3, 'breaker'] } };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(raw) })).totals.winningShips).toEqual(['lancer', 'breaker']);
  });

  it('copes with missing parts', () => {
    const noTotals = { version: 1, milestones: ['victor'] };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(noTotals) }))).toEqual({
      ...emptyProgress(),
      milestones: ['victor'],
    });
    const noMilestones = { version: 1, totals: sample().totals };
    expect(loadProgress(fakeStorage({ [PROGRESS_KEY]: JSON.stringify(noMilestones) }))).toEqual(emptyProgress());
  });

  it('never throws on storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadProgress(broken)).toEqual(emptyProgress());
    expect(() => saveProgress(broken, sample())).not.toThrow();
  });
});

describe('export and import codes', () => {
  it('starts with HB1- and round-trips', () => {
    const code = exportCode(sample());
    expect(code.startsWith('HB1-')).toBe(true);
    expect(code).toMatch(/^HB1-[A-Za-z0-9_-]+-[0-9a-f]{4}$/);
    expect(importCode(code)).toEqual(sample());
  });

  it('round-trips an empty progress', () => {
    expect(importCode(exportCode(emptyProgress()))).toEqual(emptyProgress());
  });

  it('ignores whitespace around the code', () => {
    expect(importCode(`  \n${exportCode(sample())}\t `)).toEqual(sample());
  });

  it('rejects a mistyped code', () => {
    const code = exportCode(sample());
    const at = 10;
    const swapped = code[at] === 'A' ? 'B' : 'A';
    expect(importCode(code.slice(0, at) + swapped + code.slice(at + 1))).toBeNull();
    expect(importCode(code.slice(0, -1))).toBeNull();
    expect(importCode(code.slice(0, 8) + code.slice(9))).toBeNull();
    const sum = code.slice(-4);
    const otherSum = sum === '0000' ? '0001' : '0000';
    expect(importCode(code.slice(0, -4) + otherSum)).toBeNull();
  });

  it('rejects a payload that was edited with its checksum recomputed wrongly', () => {
    const forged = 'HB1-' + btoa(JSON.stringify({ ...sample(), milestones: ['victor'] })).replace(/=+$/, '') + '-0000';
    expect(importCode(forged)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const bad of ['', 'HB1-', 'HB1--', 'HB1-abcd', 'HB2-abc-0000', 'hello world', '{"version":1}', 'HB1-!!!!-0000', exportCode(sample()).replace('HB1-', 'hb1-')]) {
      expect(importCode(bad)).toBeNull();
    }
  });

  it('rejects a well-formed code for something that is not progress', () => {
    // Build a code whose checksum is right but whose payload is not valid progress, by exporting then re-wrapping.
    const wrap = (value: unknown): string => {
      const payload = btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      // Borrow the checksum function through a real code: find a suffix by brute force is silly, so compute FNV here.
      let h = 0x811c9dc5;
      for (let i = 0; i < payload.length; i++) {
        h ^= payload.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return `HB1-${payload}-${(((h >>> 16) ^ h) & 0xffff).toString(16).padStart(4, '0')}`;
    };
    expect(importCode(wrap(sample()))).toEqual(sample());
    expect(importCode(wrap({ ...sample(), version: 2 }))).toBeNull();
    expect(importCode(wrap([1, 2, 3]))).toBeNull();
    expect(importCode(wrap('text'))).toBeNull();
  });

  it('validates like load: unknown milestones dropped', () => {
    const wrapped = importCode(exportCode({ ...sample(), milestones: ['victor', 'nonsense' as MilestoneId] }));
    expect(wrapped?.milestones).toEqual(['victor']);
  });

  it('every ship id round-trips through winningShips', () => {
    const p: Progress = { ...emptyProgress(), totals: { runs: 1, kills: 1, specials: 1, winningShips: [...SHIP_IDS] as ShipId[] } };
    expect(importCode(exportCode(p))).toEqual(p);
  });
});
