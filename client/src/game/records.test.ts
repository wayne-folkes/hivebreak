import { describe, expect, it } from 'vitest';
import { MAX_RECORDS, RECORDS_KEY, addRecord, bestScore, loadRecords } from './records';
import type { RunRecord, StorageLike } from './records';

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

const rec = (score: number, date = '2026-10-29T10:00:00.000Z'): RunRecord => ({ score, wave: 3, bestCombo: 4, won: false, date });

describe('loadRecords', () => {
  it('is empty with nothing saved', () => {
    expect(loadRecords(fakeStorage())).toEqual([]);
    expect(bestScore(fakeStorage())).toBe(0);
  });

  it('survives corrupt data', () => {
    for (const bad of ['not json', '{"a":1}', '42', 'null']) {
      expect(loadRecords(fakeStorage({ [RECORDS_KEY]: bad }))).toEqual([]);
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
    expect(loadRecords(broken)).toEqual([]);
    expect(addRecord(broken, rec(10)).records).toEqual([rec(10)]);
  });

  it('drops entries that are the wrong shape and keeps the good ones, best first', () => {
    const s = fakeStorage({ [RECORDS_KEY]: JSON.stringify([rec(5), { score: 'x' }, null, rec(50)]) });
    expect(loadRecords(s).map((r) => r.score)).toEqual([50, 5]);
  });
});

describe('addRecord', () => {
  it('saves and returns runs best first, with the new run\'s rank', () => {
    const s = fakeStorage();
    expect(addRecord(s, rec(100)).rank).toBe(0);
    expect(addRecord(s, rec(300)).rank).toBe(0);
    const { records, rank } = addRecord(s, rec(200));
    expect(rank).toBe(1);
    expect(records.map((r) => r.score)).toEqual([300, 200, 100]);
    expect(loadRecords(s)).toEqual(records);
    expect(bestScore(s)).toBe(300);
  });

  it('puts the newest run first among equal scores', () => {
    const s = fakeStorage();
    addRecord(s, rec(100, 'old'));
    const { records, rank } = addRecord(s, rec(100, 'new'));
    expect(rank).toBe(0);
    expect(records.map((r) => r.date)).toEqual(['new', 'old']);
  });

  it('keeps only the top ten', () => {
    const s = fakeStorage();
    for (let i = 1; i <= 12; i++) addRecord(s, rec(i * 10));
    const records = loadRecords(s);
    expect(records).toHaveLength(MAX_RECORDS);
    expect(records[0].score).toBe(120);
    expect(records[9].score).toBe(30);
  });

  it('reports -1 for a run too low to make the list', () => {
    const s = fakeStorage();
    for (let i = 1; i <= 10; i++) addRecord(s, rec(i * 10));
    const result = addRecord(s, rec(5));
    expect(result.rank).toBe(-1);
    expect(result.records).toHaveLength(MAX_RECORDS);
    expect(result.records.some((r) => r.score === 5)).toBe(false);
  });

  it('stores under the versioned key', () => {
    const s = fakeStorage();
    addRecord(s, rec(1));
    expect(Object.keys(s.data)).toEqual(['hivebreak.records.v1']);
  });
});
