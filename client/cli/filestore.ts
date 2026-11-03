import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { StorageLike } from '../src/game/records';

// Saves for the terminal game: the same keys and values the web game keeps in localStorage
// (progress, records, last ship), kept in one JSON file so the HB1 backup codes move unlocks
// between the two.

/** The save file: $HIVEBREAK_HOME/save.json, else ~/.hivebreak/save.json. */
export function savePath(env: Record<string, string | undefined>, home: string): string {
  return env.HIVEBREAK_HOME ? join(env.HIVEBREAK_HOME, 'save.json') : join(home, '.hivebreak', 'save.json');
}

/**
 * A StorageLike over a JSON file of string values. Reads it once; every setItem writes it back
 * (atomically). Never throws. A save that exists but can't be parsed is moved to `save.json.bak`
 * before anything overwrites it, so a hand edit gone wrong isn't lost.
 */
export function fileStorage(path: string): StorageLike {
  // Reads once and serves getItem from memory, so the game never waits on the disk to look something up.
  const read = readValues(path);
  if (read.corrupt) {
    try {
      renameSync(path, `${path}.bak`);
    } catch {
      // Can't move it: it gets overwritten like an empty save would.
    }
  }
  const values = read.values;
  /** Keys this game has written, which win over the file's when it is written back. */
  const own = new Set<string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      // The value is kept even if the write fails, so this session still sees its own progress.
      values.set(key, value);
      own.add(key);
      // Another game may have saved since this one started (two terminals): keep its other keys.
      const latest = readValues(path).values;
      for (const key of own) latest.set(key, values.get(key)!);
      writeValues(path, latest);
    },
  };
}

/** The string values in the file. A missing or unreadable file gives none; a corrupt one says so. */
function readValues(path: string): { values: Map<string, string>; corrupt: boolean } {
  const values = new Map<string, string>();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    // No save yet, or one that can't be read: start from nothing.
    return { values, corrupt: false };
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { values, corrupt: true };
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') values.set(key, value);
    }
    return { values, corrupt: false };
  } catch {
    return { values, corrupt: existsSync(path) };
  }
}

/** Writes a temp file and renames it over the save, so a crash mid-write can't leave half a save. */
function writeValues(path: string, values: Map<string, string>): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    // Per process, so two games saving at once don't write the same temp file.
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(values)));
    renameSync(tmp, path);
  } catch {
    // Unwritable disk: the game keeps running and simply doesn't save.
  }
}
