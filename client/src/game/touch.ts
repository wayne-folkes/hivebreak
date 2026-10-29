import type { Action, InputSource } from './controls';
import type { ShipInput } from './types';

// On-screen controls for touch screens. The ship is steered by dragging anywhere in the lower
// half of the screen: it moves by how far the thumb has travelled, so the thumb never covers
// the ship. Fire is automatic while a thumb is down. Pause sits small in the top-right corner.
// Every pointer is tracked by its id, so several thumbs can be down at once. The overlay only
// shows on touch devices.

type Tap = Extract<Action, 'pause'>;

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

const MARKUP = `
<div class="touch-utility">
  <button type="button" class="touch-mini" data-tap="pause" aria-label="Pause" title="Pause">⏸</button>
</div>
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

    this.enabled = window.matchMedia?.('(pointer: coarse)').matches ?? false;
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
    return { move: 0, drag, fire: this.drags.size > 0 };
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
    const target = e.target as Element;
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
