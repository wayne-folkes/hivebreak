import type { Action, InputSource } from './controls';
import type { ShipInput } from './types';

const LEFT = ['ArrowLeft', 'KeyA'];
const RIGHT = ['ArrowRight', 'KeyD'];
/** Fire is held: any of these keeps the ship shooting. */
const FIRE = ['Space', 'KeyZ', 'ArrowUp'];
const DOWN = ['ArrowDown'];
/** Keys the game reads for itself, so the browser doesn't also scroll or act on them. */
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...FIRE, ...DOWN]);

const ACTION_KEYS: Record<Action, string[]> = {
  special: ['KeyX', 'ShiftLeft', 'ShiftRight'],
  confirm: ['Enter'],
  pause: ['Escape', 'KeyP'],
  mute: ['KeyM'],
  up: ['ArrowUp'],
  down: ['ArrowDown'],
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
};

export class Keyboard implements InputSource {
  readonly kind = 'keyboard';
  private readonly down = new Set<string>();
  private readonly justPressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (GAME_KEYS.has(e.code)) e.preventDefault();
      if (!e.repeat) this.justPressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    // Releasing keys while the window is unfocused never fires keyup.
    target.addEventListener('blur', () => this.down.clear());
  }

  private any(codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  shipInput(): ShipInput {
    return {
      move: (this.any(RIGHT) ? 1 : 0) - (this.any(LEFT) ? 1 : 0),
      // Keys steer at full speed; only touch drags move the ship by an amount.
      drag: 0,
      fire: this.any(FIRE),
      special: false,
    };
  }

  /** True once per key press; cleared by endFrame(). */
  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  pressed(action: Action): boolean {
    return ACTION_KEYS[action].some((code) => this.justPressed.has(code));
  }

  active(): boolean {
    return this.justPressed.size > 0 || this.down.size > 0;
  }

  endFrame(): void {
    this.justPressed.clear();
  }
}
