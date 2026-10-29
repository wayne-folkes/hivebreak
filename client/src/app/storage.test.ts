import { describe, expect, it } from 'vitest';
import { safeStorage } from './storage';

function fake(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  } as unknown as Storage;
}

describe('safeStorage', () => {
  it('reads and writes through to the real storage', () => {
    const backing = fake();
    const s = safeStorage(() => backing);
    expect(s.getItem('a')).toBeNull();
    s.setItem('a', '1');
    expect(s.getItem('a')).toBe('1');
  });

  it('swallows a storage that cannot be reached at all', () => {
    const s = safeStorage(() => {
      throw new Error('SecurityError');
    });
    expect(s.getItem('a')).toBeNull();
    expect(() => s.setItem('a', '1')).not.toThrow();
  });

  it('swallows a full or blocked setItem and a throwing getItem', () => {
    const broken = {
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    const s = safeStorage(() => broken);
    expect(s.getItem('a')).toBeNull();
    expect(() => s.setItem('a', '1')).not.toThrow();
  });
});
