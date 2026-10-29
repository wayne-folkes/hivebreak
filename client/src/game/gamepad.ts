import type { Action, InputSource } from './controls';
import type { ShipInput } from './types';

// Gamepad support through the browser Gamepad API, using the "standard" button layout that
// Xbox, PlayStation and most other controllers report:
//
//   Move:       left stick or d-pad          Fire (held): A or right trigger
//   Special:    B or left trigger            Pause: Start
//   Menus: d-pad or stick to move, A to press. A held through a menu doesn't fire on return:
//   menus call Controls.holdFireUntilReleased() when they confirm.

/** The parts of a Gamepad this reads, so tests can pass plain objects. */
export interface PadSnapshot {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

/** The vibration parts of a Gamepad: vibrationActuator in current browsers, hapticActuators in older ones. */
interface Haptics {
  vibrationActuator?: {
    playEffect?(type: 'dual-rumble', params: { duration: number; strongMagnitude: number; weakMagnitude: number }): Promise<unknown>;
  };
  hapticActuators?: readonly { pulse?(value: number, duration: number): Promise<unknown> }[];
}

export const BUTTON = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  back: 8,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;

/** Stick travel ignored around the centre, so a resting stick doesn't steer. */
const STICK_DEADZONE = 0.18;
/** Stick travel that counts as a d-pad press when moving around menus. */
const STICK_MENU_THRESHOLD = 0.6;
/** How far a trigger must be pulled to count as held. */
const TRIGGER_THRESHOLD = 0.3;

const ACTION_BUTTONS: Record<Action, number[]> = {
  special: [BUTTON.b],
  confirm: [BUTTON.a],
  pause: [BUTTON.start],
  mute: [],
  up: [BUTTON.up],
  down: [BUTTON.down],
  left: [BUTTON.left],
  right: [BUTTON.right],
};

const value = (pad: PadSnapshot, i: number) => {
  const b = pad.buttons[i];
  return b ? Math.max(b.value, b.pressed ? 1 : 0) : 0;
};
const held = (pad: PadSnapshot, i: number) => value(pad, i) > 0.5;
const triggerDown = (pad: PadSnapshot, i: number) => value(pad, i) > TRIGGER_THRESHOLD;

/** Rescales stick travel past the deadzone to 0..1, so steering starts gently from the centre. */
function deadzone(v: number): number {
  const mag = Math.abs(v);
  if (mag < STICK_DEADZONE) return 0;
  return Math.sign(v) * Math.min(1, (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE));
}

export function padShipInput(pad: PadSnapshot): ShipInput {
  const dpad = (held(pad, BUTTON.right) ? 1 : 0) - (held(pad, BUTTON.left) ? 1 : 0);
  const stick = deadzone(pad.axes[0] ?? 0);
  return {
    move: dpad !== 0 ? dpad : stick,
    // A pad steers at full speed; only touch drags move the ship by an amount.
    drag: 0,
    fire: held(pad, BUTTON.a) || triggerDown(pad, BUTTON.rt),
  };
}

/** Which actions are held right now. The stick doubles as a d-pad for menus. */
export function padActions(pad: PadSnapshot): Set<Action> {
  const actions = new Set<Action>();
  for (const [action, buttons] of Object.entries(ACTION_BUTTONS) as [Action, number[]][]) {
    if (buttons.some((b) => held(pad, b))) actions.add(action);
  }
  if (triggerDown(pad, BUTTON.lt)) actions.add('special');
  const [x = 0, y = 0] = pad.axes;
  if (y < -STICK_MENU_THRESHOLD) actions.add('up');
  if (y > STICK_MENU_THRESHOLD) actions.add('down');
  if (x < -STICK_MENU_THRESHOLD) actions.add('left');
  if (x > STICK_MENU_THRESHOLD) actions.add('right');
  return actions;
}

function isActive(pad: PadSnapshot): boolean {
  return pad.buttons.some((b) => b.pressed || b.value > 0.1) || pad.axes.some((a) => Math.abs(a) > STICK_DEADZONE);
}

export class GamepadInput implements InputSource {
  readonly kind = 'gamepad';
  private pad: Gamepad | null = null;
  private held = new Set<Action>();
  private justPressed = new Set<Action>();
  private used = false;

  constructor(private readonly getPads: () => (Gamepad | null)[] = () => navigator.getGamepads?.() ?? []) {}

  /** True while a controller is plugged in. */
  get connected(): boolean {
    return this.pad !== null;
  }

  poll(): void {
    // Use the first connected controller. Pads must be re-read every frame: some browsers hand
    // back a fresh snapshot each time rather than updating the old object.
    this.pad = this.getPads().find((p): p is Gamepad => p !== null && p.connected) ?? null;
    if (!this.pad) {
      this.held.clear();
      return;
    }
    const now = padActions(this.pad);
    for (const a of now) if (!this.held.has(a)) this.justPressed.add(a);
    this.held = now;
    if (isActive(this.pad)) this.used = true;
  }

  shipInput(): ShipInput {
    return this.pad ? padShipInput(this.pad) : { move: 0, drag: 0, fire: false };
  }

  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }

  active(): boolean {
    return this.used;
  }

  endFrame(): void {
    this.justPressed.clear();
    this.used = false;
  }

  /** A short buzz, on controllers that support it. Does nothing on the rest. */
  rumble(strength: number, ms: number): void {
    const pad: Haptics | null = this.pad;
    const magnitude = Math.min(1, Math.max(0, strength));
    const actuator = pad?.vibrationActuator;
    if (actuator?.playEffect) {
      actuator
        .playEffect('dual-rumble', { duration: ms, strongMagnitude: magnitude, weakMagnitude: magnitude * 0.6 })
        .catch(() => {
          // Not every controller or browser can rumble; it's only a nicety.
        });
      return;
    }
    pad?.hapticActuators?.[0]?.pulse?.(magnitude, ms)?.catch(() => {
      // Same as above: the older API is only a nicety.
    });
  }
}
