import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileStorage, savePath } from './filestore';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hivebreak-save-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('fileStorage', () => {
  it('moves a corrupt save aside before overwriting it', () => {
    const path = join(dir, 'save.json');
    writeFileSync(path, '{"broken');
    fileStorage(path).setItem('k', 'v');
    expect(readFileSync(`${path}.bak`, 'utf8')).toBe('{"broken');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ k: 'v' });
  });

  it("keeps another game's keys when two save to the same file", () => {
    const path = join(dir, 'save.json');
    const a = fileStorage(path);
    const b = fileStorage(path);
    a.setItem('progress', 'from a');
    b.setItem('records', 'from b');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ progress: 'from a', records: 'from b' });
  });

  it('returns null for a missing file', () => {
    expect(fileStorage(join(dir, 'save.json')).getItem('k')).toBeNull();
  });

  it('gets back what was set', () => {
    const store = fileStorage(join(dir, 'save.json'));
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
  });

  it('keeps values for a new storage on the same path', () => {
    const path = join(dir, 'save.json');
    fileStorage(path).setItem('k', 'v');
    expect(fileStorage(path).getItem('k')).toBe('v');
  });

  it('writes the whole object as JSON and leaves no temp file behind', () => {
    const path = join(dir, 'save.json');
    const store = fileStorage(path);
    store.setItem('a', '1');
    store.setItem('b', '2');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ a: '1', b: '2' });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('starts empty from a corrupt file, and a set still saves', () => {
    const path = join(dir, 'save.json');
    writeFileSync(path, '{not json');
    const store = fileStorage(path);
    expect(store.getItem('k')).toBeNull();
    store.setItem('k', 'v');
    expect(store.getItem('k')).toBe('v');
    expect(fileStorage(path).getItem('k')).toBe('v');
  });

  it('ignores values that are not strings', () => {
    const path = join(dir, 'save.json');
    writeFileSync(path, JSON.stringify({ a: '1', b: 2, c: null, d: { x: 1 } }));
    const store = fileStorage(path);
    expect(store.getItem('a')).toBe('1');
    expect(store.getItem('b')).toBeNull();
    expect(store.getItem('c')).toBeNull();
    expect(store.getItem('d')).toBeNull();
  });

  it('treats a file that holds an array as empty', () => {
    const path = join(dir, 'save.json');
    writeFileSync(path, '["x"]');
    expect(fileStorage(path).getItem('0')).toBeNull();
  });

  it('creates the directory when saving', () => {
    const path = join(dir, 'nested', 'deeper', 'save.json');
    fileStorage(path).setItem('k', 'v');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ k: 'v' });
  });

  it('never throws when the save cannot be written, and keeps the value for the session', () => {
    // A file where the save's directory should be makes the mkdir fail.
    writeFileSync(join(dir, 'blocker'), '');
    const store = fileStorage(join(dir, 'blocker', 'save.json'));
    expect(() => store.setItem('k', 'v')).not.toThrow();
    expect(store.getItem('k')).toBe('v');
  });
});

describe('savePath', () => {
  it('uses HIVEBREAK_HOME when it is set', () => {
    expect(savePath({ HIVEBREAK_HOME: '/games/hb' }, '/home/me')).toBe(join('/games/hb', 'save.json'));
  });

  it('otherwise uses ~/.hivebreak', () => {
    expect(savePath({}, '/home/me')).toBe(join('/home/me', '.hivebreak', 'save.json'));
  });
});
