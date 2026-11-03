import type { StorageLike } from './records';

// Boss Rush's own high scores: the best rushes on this device, kept apart from the normal runs'
// records. Missing, corrupt or unwritable storage never throws; it just means no records.
//
// TODO(4b Boss Rush worker): implement, mirroring records.ts.

export const RUSH_RECORDS_KEY = 'hivebreak.bossRush.v1';

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

/** The kept rushes, best first (by score). */
export function loadRushRecords(_storage: StorageLike): RushRecord[] {
  return [];
}

/** Adds a rush; returns the kept list and its place in it (0 is best, -1 if it missed the list). */
export function addRushRecord(_storage: StorageLike, record: RushRecord): { records: RushRecord[]; rank: number } {
  return { records: [record], rank: 0 };
}

export function bestRushScore(_storage: StorageLike): number {
  return 0;
}
