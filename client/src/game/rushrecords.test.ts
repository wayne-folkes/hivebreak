import { describe, expect, it } from 'vitest';
import type { StorageLike } from './records';
import { MAX_RUSH_RECORDS, RUSH_RECORDS_KEY, addRushRecord, bestRushScore, loadRushRecords } from './rushrecords';
import type { RushRecord } from './rushrecords';

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

const rec = (score: number, time = 200, date = '2026-11-03T10:00:00.000Z'): RushRecord => ({ score, time, bosses: 2, won: false, date });

describe('loadRushRecords', () => {
  it('is empty with nothing saved', () => {
    expect(loadRushRecords(fakeStorage())).toEqual([]);
    expect(bestRushScore(fakeStorage())).toBe(0);
  });

  it('survives corrupt data', () => {
    for (const bad of ['not json', '{"a":1}', '42', 'null']) {
      expect(loadRushRecords(fakeStorage({ [RUSH_RECORDS_KEY]: bad }))).toEqual([]);
    }
  });

  it('survives storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadRushRecords(broken)).toEqual([]);
    expect(addRushRecord(broken, rec(10)).records).toEqual([rec(10)]);
  });

  it('drops entries that are the wrong shape and keeps the good ones, best first', () => {
    const r = rec(5);
    const bad = [
      { score: 'x' },
      null,
      { ...r, time: -1 },
      { ...r, time: Number.NaN },
      { ...r, bosses: 4 },
      { ...r, bosses: -1 },
      { ...r, bosses: 1.5 },
      { ...r, won: 'yes' },
      { ...r, date: 5 },
      { score: 5, time: 10, bosses: 1 },
    ];
    const s = fakeStorage({ [RUSH_RECORDS_KEY]: JSON.stringify([rec(5), ...bad, rec(50)]) });
    expect(loadRushRecords(s).map((x) => x.score)).toEqual([50, 5]);
  });

  it('sorts by score, then the faster time, and keeps at most ten', () => {
    const list = [rec(100, 300), rec(200, 400), rec(100, 250), rec(200, 350)];
    for (let i = 0; i < 10; i++) list.push(rec(1 + i));
    const loaded = loadRushRecords(fakeStorage({ [RUSH_RECORDS_KEY]: JSON.stringify(list) }));
    expect(loaded).toHaveLength(MAX_RUSH_RECORDS);
    expect(loaded.slice(0, 4).map((r) => [r.score, r.time])).toEqual([
      [200, 350],
      [200, 400],
      [100, 250],
      [100, 300],
    ]);
  });
});

describe('addRushRecord', () => {
  it("saves and returns rushes best first, with the new rush's rank", () => {
    const s = fakeStorage();
    expect(addRushRecord(s, rec(100)).rank).toBe(0);
    expect(addRushRecord(s, rec(300)).rank).toBe(0);
    const { records, rank } = addRushRecord(s, rec(200));
    expect(rank).toBe(1);
    expect(records.map((r) => r.score)).toEqual([300, 200, 100]);
    expect(loadRushRecords(s)).toEqual(records);
    expect(bestRushScore(s)).toBe(300);
  });

  it('ranks the faster time above an equal score, and the newest above an exact tie', () => {
    const s = fakeStorage();
    addRushRecord(s, rec(100, 300, 'a'));
    expect(addRushRecord(s, rec(100, 250, 'b')).rank).toBe(0);
    expect(addRushRecord(s, rec(100, 400, 'c')).rank).toBe(2);
    const { records, rank } = addRushRecord(s, rec(100, 300, 'd'));
    expect(rank).toBe(1);
    expect(records.map((r) => r.date)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('keeps only the top ten', () => {
    const s = fakeStorage();
    for (let i = 1; i <= 12; i++) addRushRecord(s, rec(i * 10));
    const records = loadRushRecords(s);
    expect(records).toHaveLength(MAX_RUSH_RECORDS);
    expect(records[0].score).toBe(120);
    expect(records[9].score).toBe(30);
  });

  it('reports -1 for a rush too low to make the list', () => {
    const s = fakeStorage();
    for (let i = 1; i <= 10; i++) addRushRecord(s, rec(i * 10));
    const result = addRushRecord(s, rec(5));
    expect(result.rank).toBe(-1);
    expect(result.records).toHaveLength(MAX_RUSH_RECORDS);
    expect(result.records.some((r) => r.score === 5)).toBe(false);
    expect(loadRushRecords(s).some((r) => r.score === 5)).toBe(false);
  });

  it('stores under the versioned key, apart from the normal records', () => {
    const s = fakeStorage();
    addRushRecord(s, rec(1));
    expect(Object.keys(s.data)).toEqual(['hivebreak.bossRush.v1']);
  });
});
