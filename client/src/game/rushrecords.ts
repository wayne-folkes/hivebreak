import type { StorageLike } from './records';

// Boss Rush's own high scores: the best rushes on this device, kept apart from the normal runs'
// records. Missing, corrupt or unwritable storage never throws; it just means no records.

export const RUSH_RECORDS_KEY = 'hivebreak.bossRush.v1';
/** How many rushes are kept. */
export const MAX_RUSH_RECORDS = 10;
/** The most bosses a rush can beat. */
const MAX_BOSSES = 3;

export interface RushRecord {
  score: number;
  /** Seconds the rush took (its clear time, or how long it lasted). */
  time: number;
  /** Bosses beaten, 0 to 3. */
  bosses: number;
  /** All three beaten. */
  won: boolean;
  /** When it was played, ISO 8601. */
  date: string;
}

function isRushRecord(value: unknown): value is RushRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.score === 'number' &&
    Number.isFinite(r.score) &&
    typeof r.time === 'number' &&
    Number.isFinite(r.time) &&
    r.time >= 0 &&
    typeof r.bosses === 'number' &&
    Number.isInteger(r.bosses) &&
    r.bosses >= 0 &&
    r.bosses <= MAX_BOSSES &&
    typeof r.won === 'boolean' &&
    typeof r.date === 'string'
  );
}

/** Whether `a` ranks strictly above `b`: a higher score, or the same score in less time. */
function ranksAbove(a: RushRecord, b: RushRecord): boolean {
  return a.score > b.score || (a.score === b.score && a.time < b.time);
}

function order(a: RushRecord, b: RushRecord): number {
  return b.score - a.score || a.time - b.time;
}

/** The kept rushes, best first (by score, then the faster time). Anything unreadable gives an empty list. */
export function loadRushRecords(storage: StorageLike): RushRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RUSH_RECORDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRushRecord).sort(order).slice(0, MAX_RUSH_RECORDS);
  } catch {
    return [];
  }
}

/**
 * Adds a rush and saves the top MAX_RUSH_RECORDS. A new rush goes above older ones that tie it on
 * score and time. Returns the kept list and the new rush's place in it (0 is best, -1 if it missed
 * the list).
 */
export function addRushRecord(storage: StorageLike, record: RushRecord): { records: RushRecord[]; rank: number } {
  const old = loadRushRecords(storage);
  const index = old.findIndex((r) => !ranksAbove(r, record));
  const rank = index < 0 ? old.length : index;
  const records = [...old.slice(0, rank), record, ...old.slice(rank)].slice(0, MAX_RUSH_RECORDS);
  try {
    storage.setItem(RUSH_RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Storage full or blocked: the list still comes back for this session's screen.
  }
  return { records, rank: rank < MAX_RUSH_RECORDS ? rank : -1 };
}

/** The best score saved, or 0 if there are none. */
export function bestRushScore(storage: StorageLike): number {
  return loadRushRecords(storage)[0]?.score ?? 0;
}
