import { SPECIAL_IDS, SPECIALS } from '../game/special';
import type { SpecialId } from '../game/types';
import { byId, MenuCard } from './card';
import { pickReady } from './format';

// The Special choice before wave 1: three cards from SPECIALS (Pulse Bomb, Shield Burst, Time
// Stop). Keys, the d-pad and taps work as on the upgrade pick, and confirm and clicks are ignored
// for the first 0.4 s after it opens so a stray fire press can't choose for you.
//
// main.ts: `new SpecialCard(special => chooseSpecial(run, special))`; show it when `run.phase` is
// `chooseSpecial` (right after a run is created, before the wave intro); `handle(controls)` each
// frame while it is on top; `hide()` after a pick. It has no Back: Esc and pause are main's call.

export class SpecialCard extends MenuCard {
  private readonly slots = SPECIAL_IDS.map((id, i) => ({
    id,
    button: byId<HTMLButtonElement>(`special-${i}`),
    name: byId(`special-${i}-name`),
    what: byId(`special-${i}-what`),
  }));
  private openedAt = -Infinity;

  constructor(
    private readonly onPick: (special: SpecialId) => void,
    /** The clock for the 0.4 s guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('special', { horizontal: true });
    for (const slot of this.slots) {
      const def = SPECIALS[slot.id];
      slot.name.textContent = def.name;
      slot.what.textContent = def.description;
      slot.button.addEventListener('click', () => {
        if (!this.visible || !pickReady(this.openedAt, this.now())) return;
        this.onPick(slot.id);
      });
    }
  }

  show(): void {
    this.openedAt = this.now();
    this.reveal();
  }
}
