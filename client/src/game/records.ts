// Local high scores: the best runs on this device, kept in localStorage (or anything shaped
// like it). Missing, corrupt or unwritable storage never throws; it just means no records.

export const RECORDS_KEY = 'hivebreak.records.v1';
/** The length of a run before `waves` was recorded, when a won run was wave 5. */
export const LEGACY_RECORD_WAVES = 5;
/** How many runs are kept. */
export const MAX_RECORDS = 10;

/** The part of localStorage the records use, so tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunRecord {
  score: number;
  /** The wave reached, counting from 1. */
  wave: number;
  /** How many waves that run had. Missing on records from the 5-wave game (see LEGACY_RECORD_WAVES). */
  waves?: number;
  bestCombo: number;
  won: boolean;
  /** When the run ended, as an ISO 8601 string. */
  date: string;
}

function isRecord(value: unknown): value is RunRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.score === 'number' &&
    Number.isFinite(r.score) &&
    typeof r.wave === 'number' &&
    Number.isFinite(r.wave) &&
    (r.waves === undefined || (typeof r.waves === 'number' && Number.isInteger(r.waves) && r.waves >= 1 && r.waves >= r.wave)) &&
    typeof r.bestCombo === 'number' &&
    Number.isFinite(r.bestCombo) &&
    typeof r.won === 'boolean' &&
    typeof r.date === 'string'
  );
}

/** The saved records, best first. Anything unreadable gives an empty list. */
export function loadRecords(storage: StorageLike): RunRecord[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RECORDS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecord)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

/**
 * Adds a finished run and saves the top MAX_RECORDS by score. A new run goes above older ones
 * with the same score. Returns the updated list and the new run's place in it (0 is the best),
 * or -1 if it didn't make the list.
 */
export function addRecord(storage: StorageLike, record: RunRecord): { records: RunRecord[]; rank: number } {
  const old = loadRecords(storage);
  const index = old.findIndex((r) => r.score <= record.score);
  const rank = index < 0 ? old.length : index;
  const records = [...old.slice(0, rank), record, ...old.slice(rank)].slice(0, MAX_RECORDS);
  try {
    storage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {
    // Storage full or blocked: the list still comes back for this session's screen.
  }
  return { records, rank: rank < MAX_RECORDS ? rank : -1 };
}

/** The best score saved, or 0 if there are none. */
export function bestScore(storage: StorageLike): number {
  return loadRecords(storage)[0]?.score ?? 0;
}
