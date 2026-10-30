import { byId, MenuCard } from './card';

// How to play: the controls for each device and a short paragraph each on waves and combo, the Special,
// power-ups, rare upgrades and synergies.
// It's static text in index.html, so the card only wires up Back.
//
// main.ts: `new HowToCard(onBack)`; `show()`; `handle(controls)` each frame while on top.

export class HowToCard extends MenuCard {
  private readonly back = byId<HTMLButtonElement>('howto-back');

  constructor(onBack: () => void) {
    super('howto');
    this.back.addEventListener('click', onBack);
  }

  show(): void {
    this.reveal();
  }

  protected override primary(): HTMLElement {
    return this.back;
  }
}
