import type { SynergyId, UpgradeId } from '../game/types';
import { upgradeDef } from '../game/upgrades';
import { byId, MenuCard } from './card';
import { pickReady, pickTags, stackLabel, waveClearHeading } from './format';

// The upgrade pick between waves: up to three cards from the run's offer, each with the upgrade's
// name, what it does, its rarity (a rare gets a gold border), a "completes LANCE" hint when taking
// it would finish a synergy, and how many stacks you have of it (e.g. 2/3). Confirm and clicks
// are ignored for the first 0.4 s after it opens, so a fire press as the last alien dies can't
// pick a card (the pure check is `pickReady` in format.ts).
//
// main.ts: `new UpgradeCard(index => pickUpgrade(run, index))`; when `run.phase` becomes
// `upgradePick`, `show(run.offer, run.wave + 1, id => stackCount(player, id), { completes: id =>
// completesSynergy(player, id) })` (the wave number counts from 1). After a boss, also pass
// `heading: bossDownHeading(kind)` ("BROOD MOTHER DOWN"). In Boss Rush the starting picks pass
// `heading: RUSH_HEADING` ("BOSS RUSH") and `ask: rushPickAsk(run.rush.picksLeft, RUSH_START_PICKS)`
// ("PICK 1 OF 3"), and the pick after a boss also passes `bonus: timeBonusLabel(points)` when the
// boss was beaten under par ("+1,250 TIME BONUS"). `handle(controls)` each frame while on top;
// after a pick, `hide()` it.

const SLOTS = 3;
const DEFAULT_ASK = 'PICK ONE';

export interface UpgradeShowOptions {
  /** The heading's first line. Defaults to "WAVE n CLEAR"; after a boss pass bossDownHeading(kind). */
  heading?: string;
  /** The heading's second line. Defaults to "PICK ONE"; a rush's starting picks say "PICK 1 OF 3". */
  ask?: string;
  /** A line under the heading, such as the Boss Rush time bonus. Left out, no line shows. */
  bonus?: string;
  /** The synergy taking an upgrade would complete, if any (completesSynergy(player, id)). */
  completes?: (id: UpgradeId) => SynergyId | null;
}

export class UpgradeCard extends MenuCard {
  private readonly waveText = byId('pick-wave');
  private readonly askText = byId('pick-ask');
  private readonly bonusText = byId('pick-bonus');
  private readonly slots = Array.from({ length: SLOTS }, (_, i) => ({
    button: byId<HTMLButtonElement>(`pick-${i}`),
    name: byId(`pick-${i}-name`),
    what: byId(`pick-${i}-what`),
    rarity: byId(`pick-${i}-rarity`),
    synergy: byId(`pick-${i}-synergy`),
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
  show(offer: readonly UpgradeId[], wave: number, stacks: (id: UpgradeId) => number, options: UpgradeShowOptions = {}): void {
    this.waveText.textContent = options.heading ?? waveClearHeading(wave);
    this.askText.textContent = options.ask ?? DEFAULT_ASK;
    this.bonusText.textContent = options.bonus ?? '';
    this.bonusText.hidden = options.bonus === undefined;
    this.slots.forEach((slot, i) => {
      const id = offer[i];
      slot.button.hidden = id === undefined;
      if (id === undefined) return;
      const def = upgradeDef(id);
      const taken = stacks(id);
      const tags = pickTags(def.rarity, options.completes?.(id) ?? null);
      slot.button.dataset.rarity = def.rarity;
      slot.name.textContent = def.name;
      slot.what.textContent = def.description;
      slot.rarity.textContent = tags.rarity ?? '';
      slot.rarity.dataset.rarity = def.rarity;
      slot.rarity.hidden = tags.rarity === null;
      slot.synergy.textContent = tags.synergy ?? '';
      slot.synergy.hidden = tags.synergy === null;
      slot.stacks.textContent = stackLabel(taken, def.maxStacks);
      slot.stacks.setAttribute('aria-label', `${taken} of ${def.maxStacks} taken`);
    });
    this.openedAt = this.now();
    this.reveal();
  }
}
