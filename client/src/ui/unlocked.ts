import type { MilestoneDef } from '../game/progress';
import { byId, MenuCard } from './card';
import { h, shipIcon } from './dom';
import { pickReady } from './format';
import { unlockedEntries } from './unlockview';

// The end-of-run "UNLOCKED" moment, shown before the game-over card when the run met milestones:
// a gold heading and, for each milestone met, the reward (a ship shows its icon), what kind it is,
// and "for: <what you did>". The items pop in one after another (CSS; still when the player
// prefers reduced motion), then Continue. Confirm and clicks are ignored for the first 0.6 s
// after it opens, so mashing fire as the run ends can't skip it.
//
// main.ts: `new UnlockedCard(onContinue)`. When a run ends (finishRun, and also a quit to the
// title if the player gets that far), call `completeRun(progress, summary)`, save the new
// progress, and if `met.length > 0` show this card before the game-over card: `enter` a screen
// whose `open` is `unlockedCard.show(met)`; play the fanfare as it opens. `onContinue` is `leave`
// (or `enter(overScreen)` in place of it). `handle(controls)` each frame while on top. It has
// no Back of its own; Esc is main's call (it can do what Continue does).

/** Seconds after the card opens during which confirm and clicks are ignored. */
export const UNLOCKED_GUARD_SECONDS = 0.6;

export class UnlockedCard extends MenuCard {
  private readonly list = byId('unlocked-list');
  private readonly next = byId<HTMLButtonElement>('unlocked-continue');
  private openedAt = -Infinity;

  constructor(
    onContinue: () => void,
    /** The clock for the guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('unlocked');
    this.next.addEventListener('click', () => {
      if (this.visible && pickReady(this.openedAt, this.now(), UNLOCKED_GUARD_SECONDS)) onContinue();
    });
  }

  /** @param met the milestones the run just met (completeRun's `met`). */
  show(met: readonly MilestoneDef[]): void {
    this.list.replaceChildren(
      ...unlockedEntries(met).map((entry, i) => {
        const li = h('li', `unlocked-item${entry.shipId ? ' has-ship' : ''}`);
        li.style.setProperty('--i', String(i));
        if (entry.shipId) li.append(shipIcon(entry.shipId, 'ship-icon unlocked-icon'));
        li.append(h('span', 'unlocked-kind', entry.kind), h('span', 'unlocked-name', entry.name), h('span', 'unlocked-for', entry.reason));
        return li;
      }),
    );
    this.openedAt = this.now();
    this.reveal();
  }

  protected override primary(): HTMLElement {
    return this.next;
  }
}
