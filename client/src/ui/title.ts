import { BOSS_RUSH_LOCK_HINT, formatScore } from './format';
import { byId, MenuCard } from './card';

// The title screen: logo, tagline, the best score and the way into a run, Boss Rush (dimmed, with
// "Win a run to unlock", until the first win; focus skips it while it is locked), the other screens
// (How to play, Settings, Records, Unlocks) and the GitHub page.
//
// main.ts: `new TitleCard({ start, rush, howToPlay, settings, records, unlocks: () => enter(unlocksScreen) },
// () => bestScore, () => bossRushUnlocked(progress))`; `show()` when the game starts and on Quit
// to title (it reads the best score and whether Boss Rush is open again each time);
// `handle(controls)` each frame while it's on top.

export interface TitleActions {
  start(): void;
  /** Starts a Boss Rush (only called while it is unlocked). Leave it out and the title hides its Boss Rush button. */
  rush?(): void;
  howToPlay(): void;
  settings(): void;
  records(): void;
  /** Opens the Unlocks screen. Leave it out and the title hides its Unlocks button. */
  unlocks?(): void;
}

export class TitleCard extends MenuCard {
  private readonly best = byId('title-best');
  private readonly startButton = byId<HTMLButtonElement>('title-start');
  private readonly rushButton = byId<HTMLButtonElement>('title-rush');
  private readonly rushLock = byId('title-rush-lock');

  constructor(
    actions: TitleActions,
    /** The best score saved, or 0 when there is none. */
    private readonly getBest: () => number,
    /** Whether Boss Rush is unlocked. */
    private readonly rushOpen: () => boolean = () => true,
  ) {
    super('title');
    this.startButton.addEventListener('click', () => actions.start());
    this.rushButton.hidden = actions.rush === undefined;
    this.rushLock.textContent = `\u{1F512} ${BOSS_RUSH_LOCK_HINT}`;
    this.rushButton.addEventListener('click', () => {
      if (!this.rushButton.disabled) actions.rush?.();
    });
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
    const open = this.rushOpen();
    this.rushButton.disabled = !open;
    this.rushButton.classList.toggle('is-locked', !open);
    this.rushLock.hidden = open;
  }

  protected override primary(): HTMLElement {
    return this.startButton;
  }
}
