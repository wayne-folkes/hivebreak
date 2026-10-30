import type { Action, InputSource } from './controls';
import type { ShipInput } from './types';

// On-screen controls for touch screens. The ship is steered by dragging anywhere in the lower
// half of the screen: it moves by how far the thumb has travelled, so the thumb never covers
// the ship. Fire is automatic while a thumb is down. Pause sits small in the top-right corner.
// The Special button is for the second thumb: bottom right, in the strip under the field when the
// screen leaves room for one (never over the field if it can help it). Pressing it is a tap, not
// a drag, so it doesn't steer or start fire. Every pointer is tracked by its id, so several
// thumbs can be down at once. The overlay only shows on touch devices.
//
// main.ts: `touch.layout(view.fit)` on start and on every resize (places the Special button),
// `touch.setSpecial(player.special === null ? null : player.specialCharge)` once per frame (null
// hides the button before a Special is chosen), and read the press with
// `controls.pressed('special')` like any other action; the sim ignores it while the meter is
// not full.

type Tap = Extract<Action, 'pause' | 'special'>;

/** How far the ship moves per art pixel of thumb travel, so a short drag still reaches across the field. */
export const DRAG_GAIN = 1.2;

/**
 * Art pixels the ship moves for a thumb that moved `dxCss` CSS pixels, given how many CSS pixels
 * one art pixel covers on screen.
 */
export function dragToArt(dxCss: number, cssPerArtPixel: number): number {
  if (!(cssPerArtPixel > 0)) return 0;
  return (dxCss / cssPerArtPixel) * DRAG_GAIN;
}

/** A pointer going down at this height starts a drag: anywhere in the lower half of the viewport. */
export function startsDrag(clientY: number, viewportHeight: number): boolean {
  return clientY >= viewportHeight / 2;
}

// --- The Special button -----------------------------------------------------------------------

/** Smallest and largest the Special button gets, CSS pixels (a thumb target, so never tiny). */
export const SPECIAL_SIZE_MIN = 56;
export const SPECIAL_SIZE_MAX = 88;
/** Gap between the Special button and the screen edge and the field, CSS pixels. */
export const SPECIAL_MARGIN = 16;

export interface SpecialPlacement {
  /**
   * `strip`: in the spare room under the field. `gutter`: beside the field, in the letterbox.
   * `over`: no room anywhere, so a small button sits over the field's bottom-right corner.
   */
  zone: 'strip' | 'gutter' | 'over';
  /** Side of the square button, CSS pixels. */
  size: number;
  /** Distance from the right and bottom edges of the viewport, CSS pixels (before safe-area insets). */
  right: number;
  bottom: number;
}

/**
 * Where the Special button goes for a playfield placed by `fitPlayfield` in a viewport this big.
 * It prefers the strip under the field, right-aligned with the field so the second thumb finds it;
 * failing that the side letterbox; only as a last resort the corner of the field itself.
 */
export function specialPlacement(
  fit: { left: number; top: number; width: number; height: number },
  viewWidth: number,
  viewHeight: number,
): SpecialPlacement {
  const strip = viewHeight - (fit.top + fit.height);
  const fieldRight = Math.max(0, viewWidth - (fit.left + fit.width));
  const roomNeeded = SPECIAL_SIZE_MIN + 2 * SPECIAL_MARGIN;
  if (strip >= roomNeeded) {
    const size = Math.min(SPECIAL_SIZE_MAX, strip - 2 * SPECIAL_MARGIN);
    return { zone: 'strip', size, right: fieldRight + SPECIAL_MARGIN, bottom: SPECIAL_MARGIN };
  }
  if (fieldRight >= roomNeeded) {
    return { zone: 'gutter', size: Math.min(SPECIAL_SIZE_MAX, fieldRight - 2 * SPECIAL_MARGIN), right: SPECIAL_MARGIN, bottom: SPECIAL_MARGIN };
  }
  return { zone: 'over', size: SPECIAL_SIZE_MIN, right: fieldRight + SPECIAL_MARGIN, bottom: SPECIAL_MARGIN };
}

export interface SpecialView {
  /** The meter, 0 to 1, as a CSS percentage for the fill. */
  fill: number;
  ready: boolean;
  /** Text on the button. */
  label: string;
  /** For screen readers. */
  aria: string;
}

/** What the Special button shows for a meter at `charge` (0 to 1). */
export function specialView(charge: number): SpecialView {
  const c = Math.min(1, Math.max(0, Number.isFinite(charge) ? charge : 0));
  const ready = c >= 1;
  const percent = Math.floor(c * 100);
  return {
    fill: ready ? 100 : percent,
    ready,
    label: ready ? 'READY' : 'SPECIAL',
    aria: ready ? 'Special, ready' : `Special, ${percent}% charged`,
  };
}

const MARKUP = `
<div class="touch-utility">
  <button type="button" class="touch-mini" data-tap="pause" aria-label="Pause" title="Pause">⏸</button>
</div>
<button type="button" class="touch-special" data-tap="special" data-state="charging" aria-label="Special" hidden>
  <span class="touch-special-label">SPECIAL</span>
</button>
`;

export class TouchControls implements InputSource {
  readonly kind = 'touch';
  private readonly overlay: HTMLElement;
  /** Buttons held down, by pointer id. */
  private readonly presses = new Map<number, HTMLElement>();
  /**
   * Pointers dragging the ship, by id, with the x each was last at. The first one still down
   * steers; the others only keep fire on.
   */
  private readonly drags = new Map<number, number>();
  /** Ship movement from drags since the last shipInput(), in art pixels. */
  private drag = 0;
  /** Taps since the last endFrame(). */
  private readonly tapped = new Set<Tap>();
  private used = false;
  /** The last Special display drawn, so setSpecial() can skip the DOM when nothing changed. */
  private shownSpecial = '';
  /** True once a touch has been seen, or the device reports a coarse pointer. */
  private enabled: boolean;
  /** Whether the game wants the overlay up (it hides behind menu cards). */
  private wanted = true;

  /**
   * @param root the element the overlay is added to.
   * @param cssPerArtPixel how many CSS pixels one art pixel covers on screen right now.
   */
  constructor(root: HTMLElement, private readonly cssPerArtPixel: () => number) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'touch-controls';
    this.overlay.hidden = true;
    this.overlay.innerHTML = MARKUP;
    root.append(this.overlay);

    const coarse = window.matchMedia?.('(pointer: coarse)');
    this.enabled = coarse?.matches ?? false;
    // Switching device (or the browser's device emulation) changes the pointer type under us.
    coarse?.addEventListener?.('change', (e) => {
      this.enabled = e.matches;
      if (!this.enabled) this.releaseAll();
      this.updateVisibility();
    });
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' && !this.enabled) {
          this.enabled = true;
          this.updateVisibility();
        }
      },
      { capture: true, passive: true },
    );
    this.updateVisibility();

    // Read on the window, not the overlay: a drag can start anywhere in the lower half, where
    // the overlay takes no pointer events at all.
    window.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    for (const type of ['pointerup', 'pointercancel']) {
      window.addEventListener(type, (e) => this.release((e as PointerEvent).pointerId));
    }
    // A long press on the touch controls would otherwise bring up the browser's context menu.
    // Right-clicks on a desktop page are left alone.
    document.addEventListener('contextmenu', (e) => {
      if (this.live()) e.preventDefault();
    });
    // iOS Safari zooms on a pinch whatever the viewport says, and the game uses two thumbs at once.
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
    }
    // Switching away never sends pointerup, so let go of everything.
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** True on a touch device, where the overlay is (or will be) shown. */
  get touchDevice(): boolean {
    return this.enabled;
  }

  /** Places the Special button for the playfield's fit; call on start and on every resize. */
  layout(fit: { left: number; top: number; width: number; height: number }): void {
    const button = this.special();
    if (!button) return;
    const p = specialPlacement(fit, window.innerWidth, window.innerHeight);
    button.dataset.zone = p.zone;
    button.style.setProperty('--special-size', `${p.size}px`);
    button.style.setProperty('--special-right', `${p.right}px`);
    button.style.setProperty('--special-bottom', `${p.bottom}px`);
  }

  /**
   * Shows the Special's meter on its button: `charge` 0 to 1, or null before a Special is chosen
   * (the button is hidden). Call it every frame; it only touches the DOM when the display changes.
   */
  setSpecial(charge: number | null): void {
    const button = this.special();
    if (!button) return;
    if (charge === null) {
      if (this.shownSpecial !== 'none') {
        this.shownSpecial = 'none';
        button.hidden = true;
      }
      return;
    }
    const view = specialView(charge);
    const key = `${view.fill}|${view.ready}`;
    if (key === this.shownSpecial) return;
    this.shownSpecial = key;
    button.hidden = false;
    button.dataset.state = view.ready ? 'ready' : 'charging';
    button.style.setProperty('--charge', `${view.fill}%`);
    button.setAttribute('aria-label', view.aria);
    const label = button.querySelector('.touch-special-label');
    if (label) label.textContent = view.label;
  }

  private special(): HTMLElement | null {
    return this.overlay.querySelector<HTMLElement>('.touch-special');
  }

  /** Hides the overlay, and stops drags, while a menu card is open. */
  setVisible(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (!on) this.releaseAll();
    this.updateVisibility();
  }

  shipInput(): ShipInput {
    const drag = this.drag;
    this.drag = 0;
    return { move: 0, drag, fire: this.drags.size > 0, special: false };
  }

  /** True once per tap; cleared by endFrame(). */
  pressed(action: Action): boolean {
    return this.tapped.has(action as Tap);
  }

  active(): boolean {
    return this.used;
  }

  endFrame(): void {
    this.tapped.clear();
    this.used = false;
  }

  /** The overlay is up, so touches count as controls. */
  private live(): boolean {
    return this.enabled && this.wanted;
  }

  private updateVisibility(): void {
    this.overlay.hidden = !this.live();
  }

  private onDown(e: PointerEvent): void {
    if (!this.live()) return;
    // Not every event target is an element (a pointer can land on the document or window).
    const target = e.target as Element | null;
    if (typeof target?.closest !== 'function') return;
    const tap = target.closest<HTMLElement>('[data-tap]');
    if (tap) {
      e.preventDefault();
      this.presses.set(e.pointerId, tap);
      this.tapped.add(tap.dataset.tap as Tap);
      this.used = true;
      this.paint();
      return;
    }
    // Other buttons (menus) are left alone; anywhere else in the lower half starts a drag.
    if (target.closest('button') || !startsDrag(e.clientY, window.innerHeight)) return;
    e.preventDefault();
    this.drags.set(e.pointerId, e.clientX);
    this.used = true;
  }

  private onMove(e: PointerEvent): void {
    const lastX = this.drags.get(e.pointerId);
    if (lastX === undefined) return;
    this.drags.set(e.pointerId, e.clientX);
    // Only the first dragging pointer still down steers.
    if (this.drags.keys().next().value === e.pointerId) {
      this.drag += dragToArt(e.clientX - lastX, this.cssPerArtPixel());
    }
  }

  private release(pointerId: number): void {
    this.drags.delete(pointerId);
    if (this.presses.delete(pointerId)) this.paint();
  }

  private releaseAll(): void {
    // A drag left over from before a pause or menu must not move the ship on resume.
    this.drag = 0;
    if (this.presses.size === 0 && this.drags.size === 0) return;
    this.presses.clear();
    this.drags.clear();
    this.paint();
  }

  /** Shows each button as pressed while a pointer is on it. */
  private paint(): void {
    const held = new Set(this.presses.values());
    for (const el of this.overlay.querySelectorAll<HTMLElement>('[data-tap]')) {
      el.classList.toggle('is-pressed', held.has(el));
    }
  }
}
