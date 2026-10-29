import { byId, MenuCard } from './card';

// The pause menu, shown over a frozen run: Resume, Settings, Quit to title.
//
// main.ts: `new PauseCard(actions)`; `show()` on Esc, P or the touch pause button; `handle(controls)`
// each frame while on top. Esc or pause again should resume, which is main's call (`dismiss()` is
// always false here). Resume should also call `controls.holdFireUntilReleased()` when it comes
// from a key or button other than the card's own confirm.

export interface PauseActions {
  resume(): void;
  settings(): void;
  quit(): void;
}

export class PauseCard extends MenuCard {
  private readonly resumeButton = byId<HTMLButtonElement>('pause-resume');

  constructor(actions: PauseActions) {
    super('pause');
    this.resumeButton.addEventListener('click', () => actions.resume());
    byId('pause-settings').addEventListener('click', () => actions.settings());
    byId('pause-quit').addEventListener('click', () => actions.quit());
  }

  show(): void {
    this.reveal();
  }

  protected override primary(): HTMLElement {
    return this.resumeButton;
  }
}
