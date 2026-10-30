import { afterEach, describe, expect, it } from 'vitest';
import {
  DRAG_GAIN,
  SPECIAL_MARGIN,
  SPECIAL_SIZE_MAX,
  SPECIAL_SIZE_MIN,
  TouchControls,
  dragToArt,
  specialPlacement,
  specialView,
  startsDrag,
} from './touch';
import { fitPlayfield } from './playfield';

describe('dragToArt', () => {
  it('turns a thumb movement in CSS pixels into art pixels, with the drag gain', () => {
    // Two CSS pixels per art pixel: 10 CSS pixels is 5 art pixels, times the gain.
    expect(dragToArt(10, 2)).toBeCloseTo(5 * DRAG_GAIN, 9);
    expect(DRAG_GAIN).toBe(1.2);
  });

  it('moves the other way for a thumb moving left', () => {
    expect(dragToArt(-6, 1)).toBeCloseTo(-6 * DRAG_GAIN, 9);
  });

  it('keeps the ship on the same screen distance as the thumb, however big the field is drawn', () => {
    // Each art pixel covers more CSS pixels on a bigger field, so fewer art pixels move the ship
    // the same distance on screen: art pixels times CSS pixels per art pixel stays put.
    const small = dragToArt(30, 1) * 1;
    const big = dragToArt(30, 3) * 3;
    expect(big).toBeCloseTo(small, 9);
  });

  it('does nothing with no usable scale yet', () => {
    expect(dragToArt(10, 0)).toBe(0);
    expect(dragToArt(10, -1)).toBe(0);
    expect(dragToArt(10, Number.NaN)).toBe(0);
  });

  it('does nothing when the thumb has not moved', () => {
    expect(dragToArt(0, 2)).toBe(0);
  });
});

describe('startsDrag', () => {
  it('starts a drag anywhere in the lower half of the viewport', () => {
    expect(startsDrag(500, 800)).toBe(true);
    expect(startsDrag(400, 800)).toBe(true); // exactly halfway down counts
    expect(startsDrag(799, 800)).toBe(true);
  });

  it('leaves the upper half alone', () => {
    expect(startsDrag(0, 800)).toBe(false);
    expect(startsDrag(399, 800)).toBe(false);
  });
});

// The tests run in Node, so TouchControls is given a stand-in window and document: just enough
// to listen for events, dispatch pointers into them, and read what it did.

type FakeEvent = { prevented: boolean; preventDefault(): void } & Record<string, unknown>;
type Listener = (e: FakeEvent) => void;

function fakeEvent(init: Record<string, unknown> = {}): FakeEvent {
  return {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    ...init,
  };
}

function fakeTarget() {
  const listeners = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    dispatch(type: string, e: FakeEvent) {
      for (const fn of listeners.get(type) ?? []) fn(e);
    },
  };
}

/** Something that is not a button or a tap target: the field under the overlay. */
const field = { closest: () => null };

/** Builds the controls on a fake window (innerHeight 800) and document, and returns handles to them. */
function setup({ coarse = true } = {}) {
  const mediaListeners: ((e: { matches: boolean }) => void)[] = [];
  const buttonProps = new Map<string, string>();
  const button = {
    hidden: true,
    dataset: {} as Record<string, string>,
    style: { setProperty: (k: string, v: string) => void buttonProps.set(k, v) },
    setAttribute: () => {},
    querySelector: () => label,
  };
  const label = { textContent: '' };
  const overlay = {
    className: '',
    hidden: false,
    innerHTML: '',
    classList: { toggle: () => false },
    querySelectorAll: () => [],
    querySelector: () => button,
  };
  const win = Object.assign(fakeTarget(), { innerHeight: 800, matchMedia: () => ({
      matches: coarse,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => mediaListeners.push(fn),
    }),
  });
  const doc = Object.assign(fakeTarget(), { createElement: () => overlay as unknown as HTMLElement });
  const g = globalThis as Record<string, unknown>;
  g.window = win;
  g.document = doc;

  const root = { append: () => {} } as unknown as HTMLElement;
  const touch = new TouchControls(root, () => 2);

  return {
    touch,
    button,
    buttonProps,
    label,
    win,
    doc,
    /** Fires the pointer-type media query's change event, as a device switch would. */
    switchPointer(matches: boolean) {
      for (const fn of mediaListeners) fn({ matches });
    },
    /** A press on the Special button, which sits in the lower half. */
    downOnSpecial(id: number, clientY = 700, clientX = 300) {
      const target = { closest: (sel: string) => (sel === '[data-tap]' ? { dataset: { tap: 'special' } } : null) };
      const e = fakeEvent({ pointerType: 'touch', pointerId: id, clientX, clientY, target });
      win.dispatch('pointerdown', e);
      return e;
    },
    down(id: number, clientY: number, clientX = 100) {
      const e = fakeEvent({ pointerType: 'touch', pointerId: id, clientX, clientY, target: field });
      win.dispatch('pointerdown', e);
      return e;
    },
    move(id: number, clientX: number) {
      win.dispatch('pointermove', fakeEvent({ pointerId: id, clientX }));
    },
    up(id: number) {
      win.dispatch('pointerup', fakeEvent({ pointerId: id }));
    },
  };
}

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.window;
  delete g.document;
});

describe('TouchControls drags', () => {
  it('steers by the thumb travel, and hands the drag out once per frame', () => {
    const { touch, down, move } = setup();
    down(1, 600, 100);
    move(1, 110); // 10 CSS pixels at 2 per art pixel
    expect(touch.shipInput().drag).toBeCloseTo(dragToArt(10, 2), 9);
    expect(touch.shipInput().drag).toBe(0);
  });

  it('fires while a thumb is down, and stops when it lifts', () => {
    const { touch, down, up } = setup();
    down(1, 600);
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: true, special: false });
    up(1);
    expect(touch.shipInput().fire).toBe(false);
  });

  it('ignores a thumb in the upper half', () => {
    const { touch, down, move } = setup();
    down(1, 300, 100);
    move(1, 150);
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: false, special: false });
  });

  it('only the first dragging thumb steers; the next one takes over when the first lifts', () => {
    const { touch, down, move, up } = setup();
    down(1, 600, 100);
    down(2, 650, 200);
    move(2, 210); // the second thumb keeps fire on but doesn't steer
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: true, special: false });
    move(1, 110); // the first thumb steers: 10 CSS pixels
    expect(touch.shipInput().drag).toBeCloseTo(dragToArt(10, 2), 9);
    up(1);
    move(2, 220); // now the second thumb steers, from where it was
    expect(touch.shipInput().drag).toBeCloseTo(dragToArt(10, 2), 9);
  });

  it('drops a drag not yet read when the window loses focus, so resuming does not jump the ship', () => {
    const { touch, down, move, win } = setup();
    down(1, 600, 100);
    move(1, 150); // accumulated, not yet read
    win.dispatch('blur', fakeEvent());
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: false, special: false });
  });

  it('drops a drag not yet read when a menu hides the overlay', () => {
    const { touch, down, move } = setup();
    down(1, 600, 100);
    move(1, 150);
    touch.setVisible(false);
    touch.setVisible(true);
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: false, special: false });
  });
});

describe('TouchControls on a changing device', () => {
  it('ignores a pointer whose target is not an element', () => {
    const { touch, win } = setup();
    const e = fakeEvent({ pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 600, target: {} });
    expect(() => win.dispatch('pointerdown', e)).not.toThrow();
    expect(touch.shipInput().fire).toBe(false);
  });

  it('turns the overlay on when the pointer type becomes coarse', () => {
    const { touch, switchPointer, doc } = setup({ coarse: false });
    expect(touch.touchDevice).toBe(false);
    switchPointer(true);
    expect(touch.touchDevice).toBe(true);
    const e = fakeEvent();
    doc.dispatch('contextmenu', e);
    expect(e.prevented).toBe(true);
  });

  it('turns it off again when the pointer type is no longer coarse', () => {
    const { touch, switchPointer } = setup();
    switchPointer(false);
    expect(touch.touchDevice).toBe(false);
  });
});

describe('TouchControls context menu', () => {
  it('blocks the context menu while the touch overlay is up', () => {
    const { doc } = setup();
    const e = fakeEvent();
    doc.dispatch('contextmenu', e);
    expect(e.prevented).toBe(true);
  });

  it('leaves a desktop right-click alone on a non-touch device', () => {
    const { doc } = setup({ coarse: false });
    const e = fakeEvent();
    doc.dispatch('contextmenu', e);
    expect(e.prevented).toBe(false);
  });

  it('leaves the context menu alone while a menu hides the overlay', () => {
    const { touch, doc } = setup();
    touch.setVisible(false);
    const e = fakeEvent();
    doc.dispatch('contextmenu', e);
    expect(e.prevented).toBe(false);
  });
});

describe('specialPlacement', () => {
  it('puts the button in the strip under the field on a tall phone, right-aligned with the field', () => {
    // 390 x 844: the field is 390 x 693 at the top, leaving a 151 px strip.
    const fit = fitPlayfield(390, 844, 1);
    const strip = 844 - (fit.top + fit.height);
    const p = specialPlacement(fit, 390, 844);
    expect(p.zone).toBe('strip');
    expect(p.size).toBe(Math.min(SPECIAL_SIZE_MAX, strip - 2 * SPECIAL_MARGIN));
    expect(p.right).toBe(SPECIAL_MARGIN + (390 - fit.left - fit.width));
    expect(p.bottom).toBe(SPECIAL_MARGIN);
  });

  it('never makes the button bigger than the strip allows', () => {
    const fit = { left: 0, top: 0, width: 400, height: 800 };
    const p = specialPlacement(fit, 400, 800 + SPECIAL_SIZE_MIN + 2 * SPECIAL_MARGIN);
    expect(p.zone).toBe('strip');
    expect(p.size).toBe(SPECIAL_SIZE_MIN);
    const tall = specialPlacement(fit, 400, 1400);
    expect(tall.size).toBe(SPECIAL_SIZE_MAX);
  });

  it('uses the side letterbox when there is no strip but room beside the field', () => {
    // A phone held sideways: the field fills the height, with letterbox either side.
    const fit = { left: 517.5, top: 0, width: 405, height: 720 };
    const p = specialPlacement(fit, 1440, 720);
    expect(p.zone).toBe('gutter');
    expect(p.right).toBe(SPECIAL_MARGIN);
    expect(p.size).toBeLessThanOrEqual(SPECIAL_SIZE_MAX);
  });

  it('falls back to a small button over the field corner when the field fills the screen', () => {
    const fit = { left: 0, top: 0, width: 375, height: 667 };
    const p = specialPlacement(fit, 375, 667);
    expect(p.zone).toBe('over');
    expect(p.size).toBe(SPECIAL_SIZE_MIN);
  });
});

describe('specialView', () => {
  it('shows the meter as a percentage while charging', () => {
    expect(specialView(0)).toMatchObject({ fill: 0, ready: false, label: 'SPECIAL' });
    expect(specialView(0.456)).toMatchObject({ fill: 45, ready: false });
    expect(specialView(0.456).aria).toBe('Special, 45% charged');
  });

  it('is ready only at a full meter', () => {
    expect(specialView(0.999).ready).toBe(false);
    expect(specialView(1)).toMatchObject({ fill: 100, ready: true, label: 'READY', aria: 'Special, ready' });
    expect(specialView(1.4).ready).toBe(true);
  });

  it('copes with bad numbers', () => {
    expect(specialView(Number.NaN).fill).toBe(0);
    expect(specialView(-1).fill).toBe(0);
  });
});

describe('TouchControls Special button', () => {
  it('reads a press on it as the special action, once per frame', () => {
    const { touch, downOnSpecial } = setup();
    expect(touch.pressed('special')).toBe(false);
    const e = downOnSpecial(1);
    expect(e.prevented).toBe(true);
    expect(touch.pressed('special')).toBe(true);
    expect(touch.pressed('pause')).toBe(false);
    touch.endFrame();
    expect(touch.pressed('special')).toBe(false);
  });

  it('does not start a drag or fire, even in the lower half where drags start', () => {
    const { touch, downOnSpecial, move } = setup();
    downOnSpecial(1, 700, 300);
    move(1, 360);
    expect(touch.shipInput()).toEqual({ move: 0, drag: 0, fire: false, special: false });
  });

  it('leaves a drag already under way by another thumb alone', () => {
    const { touch, down, move, downOnSpecial } = setup();
    down(1, 600, 100);
    downOnSpecial(2);
    move(1, 110);
    const input = touch.shipInput();
    expect(input.fire).toBe(true);
    expect(input.drag).toBeCloseTo(dragToArt(10, 2), 9);
  });

  it('ignores the button while a menu hides the overlay', () => {
    const { touch, downOnSpecial } = setup();
    touch.setVisible(false);
    downOnSpecial(1);
    expect(touch.pressed('special')).toBe(false);
  });

  it('shows the meter and hides the button before a Special is chosen', () => {
    const { touch, button, label } = setup();
    touch.setSpecial(null);
    expect(button.hidden).toBe(true);
    touch.setSpecial(0.4);
    expect(button.hidden).toBe(false);
    expect(button.dataset.state).toBe('charging');
    expect(label.textContent).toBe('SPECIAL');
    touch.setSpecial(1);
    expect(button.dataset.state).toBe('ready');
    expect(label.textContent).toBe('READY');
    touch.setSpecial(null);
    expect(button.hidden).toBe(true);
  });

  it('places the button from the fit', () => {
    const { touch, button, buttonProps, win } = setup();
    Object.assign(win, { innerWidth: 390 });
    touch.layout(fitPlayfield(390, 800, 1));
    expect(button.dataset.zone).toBe('strip');
    expect(buttonProps.get('--special-bottom')).toBe(`${SPECIAL_MARGIN}px`);
  });
});
