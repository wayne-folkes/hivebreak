import { describe, expect, it } from 'vitest';
import { Keyboard } from './input';

/** A keyboard listening on a plain EventTarget, with a helper to press and release keys. */
function setup() {
  const target = new EventTarget();
  const keyboard = new Keyboard(target as unknown as Window);
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { code, repeat });
    target.dispatchEvent(e);
    return e;
  };
  return { keyboard, key, target };
}

describe('Keyboard', () => {
  it('steers with the arrows or A and D, and is idle when both are held', () => {
    const { keyboard, key } = setup();
    expect(keyboard.shipInput().move).toBe(0);
    key('keydown', 'ArrowLeft');
    expect(keyboard.shipInput().move).toBe(-1);
    key('keyup', 'ArrowLeft');
    key('keydown', 'KeyD');
    expect(keyboard.shipInput().move).toBe(1);
    key('keydown', 'ArrowLeft');
    expect(keyboard.shipInput().move).toBe(0);
  });

  it('holds fire with Space, Z or Up, until released', () => {
    const { keyboard, key } = setup();
    for (const code of ['Space', 'KeyZ', 'ArrowUp']) {
      key('keydown', code);
      expect(keyboard.shipInput().fire).toBe(true);
      key('keyup', code);
      expect(keyboard.shipInput().fire).toBe(false);
    }
  });

  it('never drags: drag is for touch only', () => {
    const { keyboard, key } = setup();
    key('keydown', 'ArrowRight');
    expect(keyboard.shipInput().drag).toBe(0);
  });

  it('reports special, pause and mute once per press, ignoring key repeat', () => {
    const { keyboard, key } = setup();
    key('keydown', 'KeyX');
    expect(keyboard.pressed('special')).toBe(true);
    keyboard.endFrame();
    key('keydown', 'KeyX', true);
    expect(keyboard.pressed('special')).toBe(false);

    key('keydown', 'KeyP');
    expect(keyboard.pressed('pause')).toBe(true);
    keyboard.endFrame();
    key('keydown', 'KeyM');
    expect(keyboard.pressed('mute')).toBe(true);
  });

  it('confirms menus with Enter, and Space stays fire rather than confirm', () => {
    const { keyboard, key } = setup();
    key('keydown', 'Enter');
    expect(keyboard.pressed('confirm')).toBe(true);
    keyboard.endFrame();
    key('keyup', 'Enter');
    key('keydown', 'Space');
    expect(keyboard.pressed('confirm')).toBe(false);
    expect(keyboard.shipInput().fire).toBe(true);
  });

  it('pauses with Escape or P', () => {
    const { keyboard, key } = setup();
    key('keydown', 'Escape');
    expect(keyboard.pressed('pause')).toBe(true);
    keyboard.endFrame();
    key('keyup', 'Escape');
    key('keydown', 'KeyP');
    expect(keyboard.pressed('pause')).toBe(true);
  });

  it('uses the arrows to move around menus', () => {
    const { keyboard, key } = setup();
    key('keydown', 'ArrowDown');
    expect(keyboard.pressed('down')).toBe(true);
    keyboard.endFrame();
    key('keydown', 'ArrowRight');
    expect(keyboard.pressed('right')).toBe(true);
  });

  it('stops the browser acting on the game keys only', () => {
    const { key } = setup();
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(key('keydown', 'ArrowLeft').defaultPrevented).toBe(true);
    expect(key('keydown', 'KeyM').defaultPrevented).toBe(false);
  });

  it('forgets held keys when the window loses focus', () => {
    const { keyboard, key, target } = setup();
    key('keydown', 'Space');
    expect(keyboard.shipInput().fire).toBe(true);
    target.dispatchEvent(new Event('blur'));
    expect(keyboard.shipInput().fire).toBe(false);
  });
});
