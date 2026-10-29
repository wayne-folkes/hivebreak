import type { UpgradeId } from '../game/types';
import { upgradeDef } from '../game/upgrades';
import { byId, MenuCard } from './card';
import { pickReady, stackLabel } from './format';

// The upgrade pick between waves: up to three cards from the run's offer, each with the upgrade's
// name, what it does, its rarity and how many stacks you have of it (e.g. 2/3). Confirm and
// clicks are ignored for the first 0.4 s after it opens, so a fire press as the last alien dies
// can't pick a card (the pure check is `pickReady` in format.ts).
//
// main.ts: `new UpgradeCard(index => pickUpgrade(run, index))`; when `run.phase` becomes
// `upgradePick`, `show(run.offer, run.wave + 1, id => stackCount(player, id))` (the wave number
// counts from 1); `handle(controls)` each frame while on top; after a pick, `hide()` it.

const SLOTS = 3;

export class UpgradeCard extends MenuCard {
  private readonly waveText = byId('pick-wave');
  private readonly slots = Array.from({ length: SLOTS }, (_, i) => ({
    button: byId<HTMLButtonElement>(`pick-${i}`),
    name: byId(`pick-${i}-name`),
    what: byId(`pick-${i}-what`),
    rarity: byId(`pick-${i}-rarity`),
    stacks: byId(`pick-${i}-stacks`),
  }));
  private openedAt = -Infinity;

  constructor(
    private readonly onPick: (index: number) => void,
    /** The clock for the 0.4 s guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('pick', { horizontal: true });
    this.slots.forEach((slot, i) => {
      slot.button.addEventListener('click', () => {
        if (!this.visible || !pickReady(this.openedAt, this.now())) return;
        this.onPick(i);
      });
    });
  }

  /**
   * @param offer the upgrades on offer (run.offer).
   * @param wave the wave just cleared, counting from 1.
   * @param stacks how many times the player already has an upgrade.
   */
  show(offer: readonly UpgradeId[], wave: number, stacks: (id: UpgradeId) => number): void {
    this.waveText.textContent = `WAVE ${wave} CLEAR`;
    this.slots.forEach((slot, i) => {
      const id = offer[i];
      slot.button.hidden = id === undefined;
      if (id === undefined) return;
      const def = upgradeDef(id);
      const taken = stacks(id);
      slot.name.textContent = def.name;
      slot.what.textContent = def.description;
      slot.rarity.textContent = def.rarity;
      slot.rarity.dataset.rarity = def.rarity;
      slot.stacks.textContent = stackLabel(taken, def.maxStacks);
      slot.stacks.setAttribute('aria-label', `${taken} of ${def.maxStacks} taken`);
    });
    this.openedAt = this.now();
    this.reveal();
  }
}
