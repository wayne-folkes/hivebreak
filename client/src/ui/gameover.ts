import { WAVE_COUNT } from '../game/waves';
import { byId, MenuCard } from './card';
import { comboLabel, endTitle, formatClock, formatScore, pickReady, rankBadge, rushEndTitle, rushTimeLabel } from './format';

// The end-of-run card, for a win and for both ways to lose: a heading ("HIVE BROKEN", "SHIP
// LOST" or "THE HIVE LANDED"), the score, the wave reached and the best combo, a rank badge when
// the run made the top 10 ("New best!" for first place), then Play again and Title.
//
// A Boss Rush ("RUSH CLEARED" or the ways to lose) shows the score, the clear time (or the time
// survived), the bosses beaten out of the total and the best combo in place of the wave reached;
// its rank is on the Boss Rush table.
//
// main.ts: `new GameOverCard({ playAgain, title })`; when the run ends, save it with `addRecord`
// (`addRushRecord` for a rush) and `show({ won, reason, score, wave, bestCombo, rank })` with its
// returned rank (wave counts from 1, the same as the saved record); for a rush also pass
// `rush: { time, bosses, total }`. `handle(controls)` each frame while on top.

export interface RunResult {
  won: boolean;
  /** Why the run was lost; ignored when it was won. */
  reason?: 'lives' | 'invaded';
  score: number;
  /** The wave reached, counting from 1. */
  wave: number;
  bestCombo: number;
  /** Place in the top 10 from addRecord (addRushRecord for a rush): 0 is the best, -1 means it didn't make the list. */
  rank: number;
  /** Set for a Boss Rush: seconds it took (or lasted), the bosses beaten and how many there are. */
  rush?: { time: number; bosses: number; total: number };
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
  private readonly waveRow = byId('over-wave-row');
  private readonly timeRow = byId('over-time-row');
  private readonly timeLabel = byId('over-time-label');
  private readonly time = byId('over-time');
  private readonly bossesRow = byId('over-bosses-row');
  private readonly bosses = byId('over-bosses');
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
    const rush = result.rush;
    this.heading.textContent = rush ? rushEndTitle(result.won, result.reason) : endTitle(result.won, result.reason);
    this.root.dataset.outcome = result.won ? 'won' : 'lost';
    this.score.textContent = formatScore(result.score);
    this.wave.textContent = `${result.wave} / ${WAVE_COUNT}`;
    this.waveRow.hidden = rush !== undefined;
    this.timeRow.hidden = this.bossesRow.hidden = rush === undefined;
    if (rush) {
      this.timeLabel.textContent = rushTimeLabel(result.won);
      this.time.textContent = formatClock(rush.time);
      this.bosses.textContent = `${rush.bosses} / ${rush.total}`;
    }
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
