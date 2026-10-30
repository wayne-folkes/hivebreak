import { describe, expect, it } from 'vitest';
import { emptyProgress, MILESTONES, STARTING_SHIPS, type Progress } from '../game/progress';
import { SHIP_IDS, SHIPS } from '../game/ships';
import { SPECIAL_IDS } from '../game/special';
import { UPGRADES } from '../game/upgrades';
import {
  progressPercent,
  progressText,
  shipStatPips,
  STAT_PIPS,
  statPips,
  unlockedCountLabel,
  unlockKindLabel,
  unlockLabel,
  unlockName,
} from './format';
import { focusEntry, metCount, shipEntries, shipIconUrl, specialEntries, unlockedEntries, unlockHint, unlocksOverview } from './unlockview';

function withMilestones(...ids: Progress['milestones']): Progress {
  return { ...emptyProgress(), milestones: ids };
}

describe('unlock names', () => {
  it('labels kind and name', () => {
    expect(unlockKindLabel('ship')).toBe('Ship');
    expect(unlockName({ kind: 'ship', id: 'lancer' })).toBe(SHIPS.lancer.name);
    expect(unlockLabel({ kind: 'ship', id: 'lancer' })).toBe(`Ship · ${SHIPS.lancer.name}`);
    expect(unlockLabel({ kind: 'special', id: 'missileSwarm' })).toBe('Special · Missile Swarm');
    expect(unlockLabel({ kind: 'upgrade', id: 'chainSpark' })).toBe('Upgrade · Chain spark');
  });

  it('writes the count', () => {
    expect(unlockedCountLabel(7, 16)).toBe('7 / 16 unlocked');
  });
});

describe('progress text', () => {
  it('clamps to the target', () => {
    expect(progressText({ value: 120, target: 300 })).toBe('120 / 300');
    expect(progressText({ value: 400, target: 300 })).toBe('300 / 300');
    expect(progressText({ value: -1, target: 10 })).toBe('0 / 10');
    expect(progressPercent({ value: 150, target: 300 })).toBe(50);
    expect(progressPercent({ value: 999, target: 300 })).toBe(100);
    expect(progressPercent({ value: 1, target: 0 })).toBe(0);
  });
});

describe('stat pips', () => {
  it('scales against the best, between 1 and 5', () => {
    expect(statPips(10, 10)).toBe(STAT_PIPS);
    expect(statPips(5, 10)).toBe(3);
    expect(statPips(0.01, 10)).toBe(1);
    expect(statPips(0, 10)).toBe(1);
    expect(statPips(5, 0)).toBe(1);
  });

  it('gives the best ship in each stat a full meter', () => {
    const all = SHIP_IDS.map((id) => SHIPS[id]);
    const pips = all.map((s) => shipStatPips(s, all));
    for (const key of ['speed', 'fireRate', 'lives'] as const) {
      expect(Math.max(...pips.map((p) => p[key]))).toBe(STAT_PIPS);
      for (const p of pips) {
        expect(p[key]).toBeGreaterThanOrEqual(1);
        expect(p[key]).toBeLessThanOrEqual(STAT_PIPS);
      }
    }
  });
});

describe('ship entries', () => {
  it('lists every ship, with only the starting one unlocked at first', () => {
    const entries = shipEntries(emptyProgress());
    expect(entries.map((e) => e.id)).toEqual([...SHIP_IDS]);
    expect(entries.filter((e) => e.unlocked).map((e) => e.id)).toEqual([...STARTING_SHIPS]);
    for (const e of entries) {
      expect(e.hint === null).toBe(e.unlocked);
    }
  });

  it('opens a ship once its milestone is met', () => {
    const entries = shipEntries(withMilestones('deepSpace'));
    expect(entries.find((e) => e.id === 'interceptor')?.unlocked).toBe(true);
    expect(entries.find((e) => e.id === 'lancer')?.hint).toBe('Defeat the Brood Mother');
  });

  it('focuses the last ship if it is unlocked, else the first unlocked', () => {
    const entries = shipEntries(withMilestones('deepSpace'));
    expect(focusEntry(entries, 'interceptor')?.id).toBe('interceptor');
    expect(focusEntry(entries, 'lancer')?.id).toBe('breaker');
    expect(focusEntry(entries, undefined)?.id).toBe('breaker');
    expect(focusEntry([], 'breaker')).toBeNull();
  });

  it('serves icons from /ships', () => {
    expect(shipIconUrl('bastion')).toBe('/ships/bastion.png');
  });
});

describe('special entries', () => {
  it('lists all Specials, locked ones with their hint', () => {
    const entries = specialEntries(emptyProgress());
    expect(entries.map((e) => e.id)).toEqual([...SPECIAL_IDS]);
    expect(entries.find((e) => e.id === 'pulseBomb')?.unlocked).toBe(true);
    const locked = entries.find((e) => e.id === 'gravityWell');
    expect(locked?.unlocked).toBe(false);
    expect(locked?.hint).toBe('Win a run');
  });
});

describe('unlocked entries', () => {
  it('describes each milestone met', () => {
    const lancer = MILESTONES.find((m) => m.id === 'broodSlayer')!;
    const spark = MILESTONES.find((m) => m.id === 'synergist')!;
    const [a, b] = unlockedEntries([lancer, spark]);
    expect(a).toMatchObject({ name: SHIPS.lancer.name, kind: 'Ship', reason: 'for: Defeat the Brood Mother', shipId: 'lancer' });
    expect(b).toMatchObject({ kind: 'Upgrade', reason: 'for: Unlock a synergy', shipId: null });
    expect(unlockedEntries([])).toEqual([]);
  });
});

describe('unlocks overview', () => {
  it('counts milestones and lists every item', () => {
    const o = unlocksOverview(emptyProgress());
    expect(o.met).toBe(0);
    expect(o.total).toBe(MILESTONES.length);
    expect(o.countText).toBe(`0 / ${MILESTONES.length} unlocked`);
    expect(o.sections.map((s) => s.title)).toEqual(['Ships', 'Specials', 'Upgrades']);
    expect(o.sections[0]!.rows).toHaveLength(SHIP_IDS.length);
    expect(o.sections[1]!.rows).toHaveLength(SPECIAL_IDS.length);
    expect(o.sections[2]!.rows).toHaveLength(UPGRADES.length);
  });

  it('shows the next goals, with progress where a milestone counts', () => {
    const p = emptyProgress();
    p.totals.kills = 150;
    const o = unlocksOverview(p, MILESTONES.length);
    const kills = o.goals.find((g) => g.id === 'exterminator');
    expect(kills?.progress).toEqual({ text: '150 / 300', percent: 50 });
    expect(o.goals.find((g) => g.id === 'firstSteps')?.progress).toBeNull();
    expect(unlocksOverview(p).goals).toHaveLength(3);
  });

  it('marks starters, unlocked and locked rows', () => {
    const p = withMilestones('deepSpace');
    const ships = unlocksOverview(p).sections[0]!.rows;
    expect(ships.find((r) => r.unlock.id === 'breaker')).toMatchObject({ unlocked: true, starter: true, hint: null });
    expect(ships.find((r) => r.unlock.id === 'interceptor')).toMatchObject({ unlocked: true, starter: false });
    const bastion = ships.find((r) => r.unlock.id === 'bastion')!;
    expect(bastion).toMatchObject({ unlocked: false, hint: 'Destroy 300 aliens in total' });
    expect(bastion.progress).toEqual({ text: '0 / 300', percent: 0 });
  });

  it('has no goals when everything is met', () => {
    const all = withMilestones(...MILESTONES.map((m) => m.id));
    expect(metCount(all)).toBe(MILESTONES.length);
    expect(unlocksOverview(all).goals).toEqual([]);
  });

  it('knows the hint for a locked item and none for a starter', () => {
    expect(unlockHint({ kind: 'ship', id: 'interceptor' })).toBe('Reach sector 2');
    expect(unlockHint({ kind: 'ship', id: 'breaker' })).toBeNull();
  });
});
