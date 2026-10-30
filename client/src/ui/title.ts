import { formatScore } from './format';
import { byId, MenuCard } from './card';

// The title screen: logo, tagline, the best score and the way into a run, the other screens
// (How to play, Settings, Records, Unlocks) and the GitHub page.
//
// main.ts: `new TitleCard({ start, howToPlay, settings, records, unlocks: () => enter(unlocksScreen) },
// () => bestScore)`; `show()` when the game starts and on Quit
// to title (it reads the best score again each time); `handle(controls)` each frame while it's on top.

export interface TitleActions {
  start(): void;
  howToPlay(): void;
  settings(): void;
  records(): void;
  /** Opens the Unlocks screen. Leave it out and the title hides its Unlocks button. */
  unlocks?(): void;
}

export class TitleCard extends MenuCard {
  private readonly best = byId('title-best');
  private readonly startButton = byId<HTMLButtonElement>('title-start');

  constructor(
    actions: TitleActions,
    /** The best score saved, or 0 when there is none. */
    private readonly getBest: () => number,
  ) {
    super('title');
    this.startButton.addEventListener('click', () => actions.start());
    byId('title-howto').addEventListener('click', () => actions.howToPlay());
    byId('title-settings').addEventListener('click', () => actions.settings());
    byId('title-records').addEventListener('click', () => actions.records());
    const unlocks = byId<HTMLButtonElement>('title-unlocks');
    unlocks.hidden = actions.unlocks === undefined;
    unlocks.addEventListener('click', () => actions.unlocks?.());
  }

  show(): void {
    this.reveal();
  }

  protected override refresh(): void {
    const best = this.getBest();
    this.best.hidden = !(best > 0);
    this.best.textContent = `BEST ${formatScore(best)}`;
  }

  protected override primary(): HTMLElement {
    return this.startButton;
  }
}
