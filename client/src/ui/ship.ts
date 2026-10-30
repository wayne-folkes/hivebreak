import type { Progress } from '../game/progress';
import { emptyProgress } from '../game/progress';
import type { ShipId } from '../game/types';
import { byId, MenuCard } from './card';
import { h, shipIcon } from './dom';
import { pickReady, STAT_PIPS } from './format';
import { focusEntry, shipEntries, type ShipEntry } from './unlockview';

// The ship choice before a run: one card per ship, each with its icon, name, what it trades off,
// three small meters (speed, fire rate and lives, each against the best ship) and, for a locked
// ship, the milestone that unlocks it. Locked cards are dimmed and disabled, so focus skips them
// and a tap does nothing. The card opens with the last ship chosen focused. Keys, the d-pad and
// taps work as on the upgrade pick, and confirm and clicks are ignored for the first 0.4 s after
// it opens so a stray fire press can't choose for you.
//
// main.ts: `new ShipCard(ship => takeShip(ship))`. When a run starts and `unlockedShips(progress)`
// has more than one ship, `enter` a screen whose `open` is `shipCard.show(progress, lastShip)`
// (`lastShip` is the ship chosen last time, or undefined; the card also remembers its own last
// pick while the page is open); with one ship unlocked skip the card and use the Breaker.
// `handle(controls)` each frame while on top. After a pick: remember the ship (so the next run
// pre-focuses it), then show the Special card. It has no Back; Esc is main's call (like the
// Special card's: back to the title).

const STAT_LABELS = [
  { key: 'speed', short: 'SPD', long: 'Speed' },
  { key: 'fireRate', short: 'FIRE', long: 'Fire rate' },
  { key: 'lives', short: 'LIVES', long: 'Lives' },
] as const;

export class ShipCard extends MenuCard {
  private readonly list = byId('ship-cards');
  private progress: Progress = emptyProgress();
  private last: ShipId | null = null;
  private focusId: ShipId | null = null;
  private openedAt = -Infinity;

  constructor(
    private readonly onPick: (ship: ShipId) => void,
    /** The clock for the 0.4 s guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('ship', { horizontal: true });
    this.list.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button[data-ship]');
      if (!button || button.disabled || !this.visible || !pickReady(this.openedAt, this.now())) return;
      const ship = button.dataset.ship as ShipId;
      this.last = ship;
      this.onPick(ship);
    });
  }

  /**
   * @param progress what is unlocked.
   * @param last the ship chosen last time, to focus first (falls back to the card's own memory,
   *   then to the first unlocked ship).
   */
  show(progress: Progress, last?: ShipId | null): void {
    this.progress = progress;
    this.focusId = last ?? this.last;
    this.openedAt = this.now();
    this.reveal();
  }

  protected override refresh(): void {
    const entries = shipEntries(this.progress);
    this.focusId = focusEntry(entries, this.focusId)?.id ?? null;
    this.list.replaceChildren(...entries.map((entry) => card(entry)));
  }

  protected override primary(): HTMLElement | null {
    const own = this.focusId && this.list.querySelector<HTMLElement>(`button[data-ship="${this.focusId}"]`);
    return own || super.primary();
  }
}

function card(entry: ShipEntry): HTMLButtonElement {
  const button = h('button', `pick-card ship-card${entry.unlocked ? '' : ' is-locked'}`);
  button.type = 'button';
  button.dataset.ship = entry.id;
  button.disabled = !entry.unlocked;

  const info = h('span', 'ship-info');
  info.append(h('span', 'pick-name', entry.name), h('span', 'pick-what', entry.description));

  const stats = h('span', 'ship-stats');
  for (const { key, short, long } of STAT_LABELS) {
    const lit = entry.pips[key];
    const stat = h('span', 'stat');
    const pips = h('span', 'pips');
    pips.setAttribute('role', 'img');
    pips.setAttribute('aria-label', `${long}: ${lit} of ${STAT_PIPS}`);
    for (let i = 0; i < STAT_PIPS; i++) pips.append(h('i', i < lit ? 'on' : ''));
    stat.append(h('span', 'stat-label', short), pips);
    stats.append(stat);
  }

  button.append(shipIcon(entry.id), info, stats);
  if (!entry.unlocked) button.append(h('span', 'pick-lock', `\u{1F512} ${entry.hint ?? 'Locked'}`));
  return button;
}
