import type { StorageLike } from '../game/records';

// localStorage that never throws. Private modes and locked-down browsers can throw on reading
// `window.localStorage` itself, on getItem, or on setItem when full; all of those just mean
// nothing is remembered.

/** @param getStorage how to reach the real storage; called on every use, since even that can throw. */
export function safeStorage(getStorage: () => Storage = () => window.localStorage): StorageLike {
  return {
    getItem(key) {
      try {
        return getStorage().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      try {
        getStorage().setItem(key, value);
      } catch {
        // Blocked or full: this visit goes on without saving.
      }
    },
  };
}
