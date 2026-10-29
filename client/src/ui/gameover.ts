import { WAVE_COUNT } from '../game/waves';
import { byId, MenuCard } from './card';
import { comboLabel, endTitle, formatScore, pickReady, rankBadge } from './format';

// The end-of-run card, for a win and for both ways to lose: a heading ("HIVE BROKEN", "SHIP
// LOST" or "THE HIVE LANDED"), the score, the wave reached and the best combo, a rank badge when
// the run made the top 10 ("New best!" for first place), then Play again and Title.
//
// main.ts: `new GameOverCard({ playAgain, title })`; when the run ends, save it with `addRecord`
// and `show({ won, reason, score, wave, bestCombo, rank })` with its returned rank (wave counts
// from 1, the same as the saved record); `handle(controls)` each frame while on top.

export interface RunResult {
  won: boolean;
  /** Why the run was lost; ignored when it was won. */
  reason?: 'lives' | 'invaded';
  score: number;
  /** The wave reached, counting from 1. */
  wave: number;
  bestCombo: number;
  /** Place in the top 10 from addRecord: 0 is the best, -1 means it didn't make the list. */
  rank: number;
}

export interface GameOverActions {
  playAgain(): void;
  title(): void;
}

/** Seconds after the card opens during which confirm and clicks are ignored, so mashing fire can't skip it. */
export const OVER_GUARD_SECONDS = 0.6;

export class GameOverCard extends MenuCard {
  private readonly heading = byId('over-heading');
  private readonly score = byId('over-score');
  private readonly wave = byId('over-wave');
  private readonly combo = byId('over-combo');
  private readonly badge = byId('over-badge');
  private readonly again = byId<HTMLButtonElement>('over-again');

  private openedAt = -Infinity;

  constructor(
    actions: GameOverActions,
    /** The clock for the guard, in ms. Tests pass their own. */
    private readonly now: () => number = () => performance.now(),
  ) {
    super('over');
    const ready = () => this.visible && pickReady(this.openedAt, this.now(), OVER_GUARD_SECONDS);
    this.again.addEventListener('click', () => {
      if (ready()) actions.playAgain();
    });
    byId('over-title').addEventListener('click', () => {
      if (ready()) actions.title();
    });
  }

  show(result: RunResult): void {
    this.heading.textContent = endTitle(result.won, result.reason);
    this.root.dataset.outcome = result.won ? 'won' : 'lost';
    this.score.textContent = formatScore(result.score);
    this.wave.textContent = `${result.wave} / ${WAVE_COUNT}`;
    this.combo.textContent = comboLabel(result.bestCombo);
    const badge = rankBadge(result.rank);
    this.badge.hidden = badge === null;
    this.badge.textContent = badge ?? '';
    this.openedAt = this.now();
    this.reveal();
  }

  protected override primary(): HTMLElement {
    return this.again;
  }
}
