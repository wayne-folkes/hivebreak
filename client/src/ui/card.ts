import type { Controls } from '../game/controls';

// The base for every card that sits over the game: the title screen, the menus, the upgrade pick
// and the end-of-run card. Markup lives in index.html; each class wires up its buttons.
//
// How main.ts drives a card: show it (each card has its own `show(...)`), call `handle(controls)`
// once per frame while it is the one on top, and call `dismiss()` when Esc or pause is pressed
// (it closes an in-card confirmation and returns true, or returns false if there was none, in
// which case main goes back a card). `hide()` takes it away.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

/** What a card can move focus between. */
const FOCUSABLE = 'button, a[href], input[type="range"], input[type="text"]';

/** How far a left or right press moves a focused slider (percent). */
const SLIDER_NUDGE = 5;

export interface MenuCardOptions {
  /** The buttons sit side by side, so left and right move focus as well as up and down. */
  horizontal?: boolean;
}

export abstract class MenuCard {
  readonly root: HTMLElement;
  private readonly horizontal: boolean;

  constructor(rootId: string, options: MenuCardOptions = {}) {
    this.root = byId(rootId);
    this.horizontal = options.horizontal ?? false;
    // Confirm comes through Controls (Enter, or the gamepad's A) in handle(), so a button must not
    // also click itself on the same key press. Space is fire, and must not press a button either.
    for (const type of ['keydown', 'keyup'] as const) {
      this.root.addEventListener(type, (e) => {
        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
      });
    }
    // A mouse or touch user doesn't need the keyboard focus ring.
    this.root.addEventListener('pointerdown', () => this.clearRing());
    this.guardTextFields();
  }

  /**
   * A text field (the progress code in Settings) must take its keys: the game listens on the window
   * and would read P as pause, M as mute, A and D as steering (and cancel their typing). So a
   * field keeps every key to itself, except Up and Down, which still move focus on to the next
   * control. Escape leaves the field (`fieldEscaped`) and Enter submits it (`fieldSubmitted`).
   */
  private guardTextFields(): void {
    for (const input of this.root.querySelectorAll<HTMLInputElement>('input[type="text"]')) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') return;
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          this.fieldEscaped(input);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          this.fieldSubmitted(input);
        }
      });
      input.addEventListener('keyup', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') e.stopPropagation();
      });
    }
  }

  /** Escape pressed inside a text field: by default, back to the card's primary control. */
  protected fieldEscaped(_input: HTMLInputElement): void {
    this.focusPrimary();
  }

  /** Enter pressed inside a text field. */
  protected fieldSubmitted(_input: HTMLInputElement): void {}

  get visible(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.hidden = true;
    this.clearRing();
  }

  /** Esc or pause: closes a confirmation the card is showing and returns true, otherwise false. */
  dismiss(): boolean {
    return false;
  }

  /** Called as the card opens, so it can show current values. */
  protected refresh(): void {}

  /** The button focus lands on when the card opens, and that confirm presses if nothing has focus. */
  protected primary(): HTMLElement | null {
    return this.items()[0] ?? null;
  }

  /** Shows the card and focuses its primary button. Each subclass's `show(...)` calls this. */
  protected reveal(): void {
    this.refresh();
    this.root.hidden = false;
    this.focusPrimary();
    // A tall card (How to play) opens at its top, even when its button is below the fold.
    this.panel().scrollTop = 0;
  }

  protected focusPrimary(): void {
    const el = this.primary();
    if (el) this.focusItem(el, false);
  }

  private panel(): HTMLElement {
    return this.root.querySelector<HTMLElement>('.panel') ?? this.root;
  }

  /** The buttons, links and sliders showing now, in order. Anything inside a hidden block is skipped. */
  items(): HTMLElement[] {
    return [...this.root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !(el as HTMLButtonElement | HTMLInputElement).disabled && !el.closest('[hidden]'),
    );
  }

  /** Moves focus and the ring to a control. Gamepad and touch players don't trigger :focus-visible, so it's marked too. */
  protected focusItem(el: HTMLElement, scroll = true): void {
    this.clearRing();
    el.classList.add('is-menu-focus');
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  private clearRing(): void {
    for (const el of this.root.querySelectorAll('.is-menu-focus')) el.classList.remove('is-menu-focus');
  }

  /**
   * Arrows, d-pad or stick move focus round the card; confirm presses the focused control, or the
   * primary one if nothing is focused. A focused slider takes left and right to change its value.
   * Every confirm calls holdFireUntilReleased(), so a menu press never also fires a shot. Each
   * press is read once per frame, so Enter can't act twice.
   */
  handle(controls: Controls): void {
    if (!this.visible) return;
    const items = this.items();
    if (items.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    const focused = active && items.includes(active) ? active : null;
    const slider = focused instanceof HTMLInputElement && focused.type === 'range' ? focused : null;

    if (slider) {
      const direction = (controls.pressed('right') ? 1 : 0) - (controls.pressed('left') ? 1 : 0);
      if (direction !== 0) this.nudge(slider, direction);
    }
    const across = this.horizontal && !slider;
    const forward = controls.pressed('down') || (across && controls.pressed('right'));
    const back = controls.pressed('up') || (across && controls.pressed('left'));
    if (forward !== back) {
      const primary = this.primary();
      const index = focused ? items.indexOf(focused) : Math.max(0, primary ? items.indexOf(primary) : 0);
      this.focusItem(items[(index + (forward ? 1 : -1) + items.length) % items.length]);
    }

    if (controls.pressed('confirm')) {
      controls.holdFireUntilReleased();
      (focused ?? this.primary())?.click();
    }
  }

  /** Moves a slider a step left or right, the same as a drag would. */
  private nudge(slider: HTMLInputElement, direction: number): void {
    const next = Number(slider.value) + direction * SLIDER_NUDGE;
    slider.value = String(Math.min(Number(slider.max) || 100, Math.max(Number(slider.min) || 0, next)));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
