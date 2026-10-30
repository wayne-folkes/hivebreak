import { unlockedShips } from '../game/progress';
import type { Progress } from '../game/progress';
import type { StorageLike } from '../game/records';
import type { ShipId } from '../game/types';

// The ship chosen last time, remembered so the ship card opens with it focused.

export const LAST_SHIP_KEY = 'hivebreak.lastShip.v1';

/** The ship chosen last, if it is still one the player has unlocked. */
export function loadLastShip(storage: StorageLike, progress: Progress): ShipId | null {
  const raw = storage.getItem(LAST_SHIP_KEY);
  const unlocked: readonly string[] = unlockedShips(progress);
  return raw !== null && unlocked.includes(raw) ? (raw as ShipId) : null;
}

export function saveLastShip(storage: StorageLike, ship: ShipId): void {
  storage.setItem(LAST_SHIP_KEY, ship);
}
