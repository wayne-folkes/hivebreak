import { describe, expect, it } from 'vitest';
import { emptyProgress } from '../game/progress';
import type { Progress } from '../game/progress';
import { LAST_SHIP_KEY, loadLastShip, saveLastShip } from './lastship';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const withInterceptor: Progress = { ...emptyProgress(), milestones: ['deepSpace'] };

describe('last ship', () => {
  it('is null before anything is saved', () => {
    expect(loadLastShip(memory(), emptyProgress())).toBeNull();
  });

  it('comes back when it is unlocked', () => {
    const s = memory();
    saveLastShip(s, 'interceptor');
    expect(loadLastShip(s, withInterceptor)).toBe('interceptor');
    expect(loadLastShip(s, emptyProgress())).toBeNull();
  });

  it('ignores a value that is not a ship', () => {
    const s = memory();
    s.setItem(LAST_SHIP_KEY, 'nope');
    expect(loadLastShip(s, withInterceptor)).toBeNull();
  });
});
