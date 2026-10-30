import { emptyProgress, type Progress } from '../game/progress';
import type { SpecialId } from '../game/types';
import { byId, MenuCard } from './card';
import { h } from './dom';
import { pickReady } from './format';
import { specialEntries, type SpecialEntry } from './unlockview';

// The Special choice before wave 1: one card per Special in SPECIAL_IDS (Pulse Bomb, Shield Burst,
// Time Stop, Missile Swarm, Gravity Well), built each time it opens. Unlocked ones can be picked;
// locked ones are dimmed and disabled (focus skips them) and say which milestone unlocks them.
// Keys, the d-pad and taps work as on the upgrade pick, and confirm and clicks are ignored for the
// first 0.4 s after it opens so a stray fire press can't choose for you. On a phone the cards
// are a compact list; with room they sit in a grid.
//
// main.ts: `new SpecialCard(special => takeSpecial(special))`; show it when `run.phase` is
// `chooseSpecial` (after the ship choice, before the wave intro) with `specialCard.show(progress)`,
// where `progress` is the current saved Progress (`show()` with no argument shows only the
// starting pool). `handle(controls)` each frame while on top; `hide()` after a pick. It has no
// Back: Esc and pause are main's call.

export class SpecialCard extends MenuCard {
  private readonly list = byId('special-cards');
  private progress: Progress = emptyProgress();
  private openedAt = -Infinity;

  constructor(
    private readonly onPick: (special: SpecialId) => void,
    /** The clock for the 0.4 s guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('special', { horizontal: true });
    this.list.addEventListener('click', (e) => {
      const button = (e.target as Element).closest<HTMLButtonElement>('button[data-special]');
      if (!button || button.disabled || !this.visible || !pickReady(this.openedAt, this.now())) return;
      this.onPick(button.dataset.special as SpecialId);
    });
  }

  show(progress: Progress = emptyProgress()): void {
    this.progress = progress;
    this.openedAt = this.now();
    this.reveal();
  }

  protected override refresh(): void {
    this.list.replaceChildren(...specialEntries(this.progress).map(card));
  }
}

function card(entry: SpecialEntry): HTMLButtonElement {
  const button = h('button', `pick-card special-card${entry.unlocked ? '' : ' is-locked'}`);
  button.type = 'button';
  button.dataset.special = entry.id;
  button.disabled = !entry.unlocked;
  button.append(h('span', 'pick-name', entry.name));
  if (entry.unlocked) button.append(h('span', 'pick-what', entry.description));
  else button.append(h('span', 'pick-lock', `\u{1F512} ${entry.hint ?? 'Locked'}`));
  return button;
}
