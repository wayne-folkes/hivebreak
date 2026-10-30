import { afterEach, describe, expect, it } from 'vitest';
import { DRAG_GAIN, TouchControls, dragToArt, startsDrag } from './touch';

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
  const overlay = {
    className: '',
    hidden: false,
    innerHTML: '',
    classList: { toggle: () => false },
    querySelectorAll: () => [],
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
    win,
    doc,
    /** Fires the pointer-type media query's change event, as a device switch would. */
    switchPointer(matches: boolean) {
      for (const fn of mediaListeners) fn({ matches });
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
