import { describe, expect, it } from 'vitest';
import { IdleFade, TITLE_IDLE_SECONDS } from './idle';

describe('IdleFade', () => {
  it('fades after the idle time, once', () => {
    const changes: boolean[] = [];
    const idle = new IdleFade((f) => changes.push(f), 10);
    for (let i = 0; i < 99; i++) idle.update(0.1, false);
    expect(idle.isFaded).toBe(false);
    idle.update(0.11, false);
    expect(idle.isFaded).toBe(true);
    for (let i = 0; i < 50; i++) idle.update(0.1, false);
    expect(changes).toEqual([true]);
  });

  it('input restarts the count, and wakes a faded title, saying so once', () => {
    const changes: boolean[] = [];
    const idle = new IdleFade((f) => changes.push(f), 10);
    idle.update(9, false);
    expect(idle.update(0.1, true)).toBe(false);
    idle.update(9, false);
    expect(idle.isFaded).toBe(false);
    idle.update(1.1, false);
    expect(idle.isFaded).toBe(true);
    expect(idle.update(0.1, true)).toBe(true);
    expect(idle.update(0.1, true)).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('wake() brings it back and restarts the count', () => {
    const idle = new IdleFade(() => {}, 10);
    idle.update(11, false);
    expect(idle.wake()).toBe(true);
    expect(idle.isFaded).toBe(false);
    expect(idle.wake()).toBe(false);
    idle.update(9, false);
    expect(idle.isFaded).toBe(false);
  });

  it('waits long enough to read the title first', () => {
    expect(TITLE_IDLE_SECONDS).toBeGreaterThanOrEqual(10);
  });
});
