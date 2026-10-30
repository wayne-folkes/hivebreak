import type { Controls } from '../game/controls';
import type { Progress } from '../game/progress';
import { byId, MenuCard } from './card';
import { h, progressBar } from './dom';
import { unlockLabel } from './format';
import { unlocksOverview, type GoalRow, type UnlockRow } from './unlockview';

// The Unlocks screen, from the title: how many milestones are met ("7 / 16 unlocked"), the next
// few goals with a progress bar where the milestone counts across runs, then every ship, Special
// and upgrade: unlocked ones by name, locked ones dimmed with the milestone that unlocks them.
// The list scrolls inside the panel (touch, wheel, or up and down on keys, d-pad and stick).
//
// main.ts: `new UnlocksCard(() => progress, leave)`; `enter` a screen whose `open` is
// `unlocksCard.show()` from the title's Unlocks button (`TitleActions.unlocks`); it reads the
// progress again each time it opens; `handle(controls)` each frame while on top. Esc backs out
// like the Records screen (`leave()`).

export class UnlocksCard extends MenuCard {
  private readonly count = byId('unlocks-count');
  private readonly scroller = byId('unlocks-scroll');
  private readonly body = byId('unlocks-body');
  private readonly back = byId<HTMLButtonElement>('unlocks-back');

  constructor(
    private readonly getProgress: () => Progress,
    onBack: () => void,
  ) {
    super('unlocks');
    this.back.addEventListener('click', onBack);
  }

  show(): void {
    this.reveal();
    this.scroller.scrollTop = 0;
  }

  /** The list has nothing to focus, so up and down scroll it. */
  override handle(controls: Controls): void {
    if (!this.visible) return;
    super.handle(controls);
    const direction = (controls.pressed('down') ? 1 : 0) - (controls.pressed('up') ? 1 : 0);
    if (direction !== 0) this.scroller.scrollBy({ top: direction * Math.max(80, this.scroller.clientHeight * 0.5) });
  }

  protected override refresh(): void {
    const overview = unlocksOverview(this.getProgress());
    this.count.textContent = overview.countText;
    const parts: HTMLElement[] = [];

    parts.push(h('h3', 'subheading', 'Next goals'));
    if (overview.goals.length === 0) parts.push(h('p', 'text', 'Everything is unlocked. Nicely done.'));
    else {
      const goals = h('ul', 'unlock-goals');
      for (const goal of overview.goals) goals.append(goalItem(goal));
      parts.push(goals);
    }

    for (const section of overview.sections) {
      parts.push(h('h3', 'subheading', section.title));
      const list = h('ul', 'unlock-list');
      for (const row of section.rows) list.append(rowItem(row));
      parts.push(list);
    }
    this.body.replaceChildren(...parts);
  }

  protected override primary(): HTMLElement {
    return this.back;
  }
}

function goalItem(goal: GoalRow): HTMLLIElement {
  const li = h('li', 'unlock-goal');
  li.append(h('span', 'unlock-reward', goal.reward), h('span', 'unlock-desc', goal.description));
  if (goal.progress) li.append(progressBar(goal.progress, goal.description));
  return li;
}

function rowItem(row: UnlockRow): HTMLLIElement {
  const li = h('li', `unlock-row ${row.unlocked ? 'is-open' : 'is-locked'}`);
  const name = h('span', 'unlock-name', row.name);
  li.append(name);
  if (row.unlocked) {
    li.append(h('span', 'unlock-state', row.starter ? 'Starter' : 'Unlocked'));
  } else {
    li.append(h('span', 'unlock-state', `\u{1F512} ${row.hint ?? 'Locked'}`));
    if (row.progress) li.append(progressBar(row.progress, `${unlockLabel(row.unlock)} progress`));
  }
  return li;
}
