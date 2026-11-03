import type { Controls } from '../game/controls';
import type { RunRecord } from '../game/records';
import type { RushRecord } from '../game/rushrecords';
import { byId, MenuCard } from './card';
import { recordRowText, rushRecordRowText } from './format';

// The Records card: the top runs on this device, in two tabs. Normal shows score, wave reached,
// best combo, won or lost and date; Boss Rush shows score, time, bosses beaten (2/3) and date.
// Left and right (arrows, d-pad, stick) switch tabs, wherever focus is; so does a click or tap on
// one. Up and down move focus as on any card. It opens on Normal and reads both lists again each
// time it opens, so they are always current.
//
// main.ts: `new RecordsCard({ normal: () => loadRecords(storage), rush: () => loadRushRecords(storage),
// rushOpen: () => bossRushUnlocked(progress) }, onBack)`; `show()`; `handle(controls)` each frame
// while on top.

export type RecordsTab = 'normal' | 'rush';

export interface RecordSources {
  normal(): RunRecord[];
  rush(): RushRecord[];
  /** Whether Boss Rush is unlocked, for what an empty Boss Rush list says. */
  rushOpen(): boolean;
}

const TABS: readonly RecordsTab[] = ['normal', 'rush'];

export class RecordsCard extends MenuCard {
  private readonly list = byId('records-list');
  private readonly empty = byId('records-empty');
  private readonly panelBox = byId('records-panel');
  private readonly back = byId<HTMLButtonElement>('records-back');
  private readonly tabs: Record<RecordsTab, HTMLButtonElement> = {
    normal: byId<HTMLButtonElement>('records-tab-normal'),
    rush: byId<HTMLButtonElement>('records-tab-rush'),
  };
  private tab: RecordsTab = 'normal';

  constructor(
    private readonly sources: RecordSources,
    onBack: () => void,
  ) {
    super('records');
    this.back.addEventListener('click', onBack);
    for (const tab of TABS) this.tabs[tab].addEventListener('click', () => this.select(tab));
  }

  /** Opens on the Normal tab. */
  show(): void {
    this.tab = 'normal';
    this.reveal();
  }

  /** The tab showing now. */
  get current(): RecordsTab {
    return this.tab;
  }

  override handle(controls: Controls): void {
    if (!this.visible) return;
    const step = (controls.pressed('right') ? 1 : 0) - (controls.pressed('left') ? 1 : 0);
    if (step !== 0) this.select(TABS[Math.min(TABS.length - 1, Math.max(0, TABS.indexOf(this.tab) + step))]);
    super.handle(controls);
  }

  /** Shows a tab's list. */
  select(tab: RecordsTab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.refresh();
  }

  protected override refresh(): void {
    for (const tab of TABS) {
      const on = tab === this.tab;
      this.tabs[tab].setAttribute('aria-selected', String(on));
      this.tabs[tab].classList.toggle('is-active', on);
      if (on) this.panelBox.setAttribute('aria-labelledby', this.tabs[tab].id);
    }
    const rows: HTMLLIElement[] = [];
    if (this.tab === 'normal') {
      this.empty.textContent = 'No runs yet. Finish one and it lands here.';
      this.sources.normal().forEach((r, i) => rows.push(row(recordRowText(i, r), NORMAL_CELLS, r.won)));
    } else {
      this.empty.textContent = this.sources.rushOpen()
        ? 'No Boss Rush runs yet. Finish one and it lands here.'
        : 'Boss Rush is locked. Win a run to open it.';
      this.sources.rush().forEach((r, i) => rows.push(row(rushRecordRowText(i, r), RUSH_CELLS, r.won, 'is-rush')));
    }
    this.empty.hidden = rows.length > 0;
    this.list.hidden = rows.length === 0;
    this.list.setAttribute('aria-label', this.tab === 'normal' ? 'Top 10 runs' : 'Top 10 Boss Rush runs');
    this.list.replaceChildren(...rows);
  }

  protected override primary(): HTMLElement {
    return this.back;
  }
}

const NORMAL_CELLS = ['rank', 'score', 'wave', 'combo', 'result', 'date'] as const;
const RUSH_CELLS = ['rank', 'score', 'time', 'bosses', 'date'] as const;

function row<T extends Record<K, string>, K extends string>(text: T, cells: readonly K[], won: boolean, extra = ''): HTMLLIElement {
  const li = document.createElement('li');
  li.className = ['record-row', extra, won ? 'is-won' : ''].filter(Boolean).join(' ');
  for (const key of cells) {
    const cell = document.createElement('span');
    cell.className = `record-${key}`;
    cell.textContent = text[key];
    li.append(cell);
  }
  return li;
}
