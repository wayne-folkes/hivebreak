import type { RunRecord } from '../game/records';
import { byId, MenuCard } from './card';
import { recordRowText } from './format';

// The Records card: the top runs on this device (score, wave reached, best combo, won or lost,
// date). It reads the list again each time it opens, so it is always current.
//
// main.ts: `new RecordsCard(() => loadRecords(localStorage), onBack)`; `show()`; `handle(controls)`
// each frame while on top.

export class RecordsCard extends MenuCard {
  private readonly list = byId('records-list');
  private readonly empty = byId('records-empty');
  private readonly back = byId<HTMLButtonElement>('records-back');

  constructor(
    private readonly getRecords: () => RunRecord[],
    onBack: () => void,
  ) {
    super('records');
    this.back.addEventListener('click', onBack);
  }

  show(): void {
    this.reveal();
  }

  protected override refresh(): void {
    const records = this.getRecords();
    this.empty.hidden = records.length > 0;
    this.list.hidden = records.length === 0;
    this.list.replaceChildren(...records.map((r, i) => row(i, r)));
  }

  protected override primary(): HTMLElement {
    return this.back;
  }
}

const CELLS = ['rank', 'score', 'wave', 'combo', 'result', 'date'] as const;

function row(index: number, record: RunRecord): HTMLLIElement {
  const text = recordRowText(index, record);
  const li = document.createElement('li');
  li.className = `record-row${record.won ? ' is-won' : ''}`;
  for (const key of CELLS) {
    const cell = document.createElement('span');
    cell.className = `record-${key}`;
    cell.textContent = text[key];
    li.append(cell);
  }
  return li;
}
