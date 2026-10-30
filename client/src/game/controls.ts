import type { ShipInput } from './types';

// One place the game reads input from, whatever it comes from: keyboard, gamepad or touch.
// Ship input is merged across sources (the strongest move wins, drags add up, and fire is on
// if any source holds it), and one-off actions fire if any source pressed them this frame.

export type Action =
  /** Use the special ability (a later slice). */
  | 'special'
  /** Press the focused (or main) button on a menu card. */
  | 'confirm'
  /** Open or close the pause menu. */
  | 'pause'
  /** Turn the sound on or off. */
  | 'mute'
  /** Move focus between buttons on a menu card. */
  | 'up'
  | 'down'
  | 'left'
  | 'right';

export type SourceKind = 'keyboard' | 'gamepad' | 'touch';

export interface InputSource {
  readonly kind: SourceKind;
  /** Reads the device, once per frame, before anything asks for input. */
  poll?(): void;
  shipInput(): ShipInput;
  /** True if the action was pressed since the last endFrame(). */
  pressed(action: Action): boolean;
  /** True if the source was used since the last endFrame(), to tell which device is in play. */
  active(): boolean;
  endFrame(): void;
  /** A short buzz for the player, e.g. when the ship is hit. Sources that can't rumble leave this out. */
  rumble?(strength: number, ms: number): void;
}

const strongest = (values: number[]) => values.reduce((best, v) => (Math.abs(v) > Math.abs(best) ? v : best), 0);

export function mergeShipInputs(inputs: ShipInput[]): ShipInput {
  return {
    move: strongest(inputs.map((i) => i.move)),
    drag: inputs.reduce((sum, i) => sum + i.drag, 0),
    fire: inputs.some((i) => i.fire),
    special: inputs.some((i) => i.special),
  };
}

export class Controls {
  /** The device used most recently, for showing the right button hints. */
  lastUsed: SourceKind = 'keyboard';
  /** Set by holdFireUntilReleased(): fire is ignored until the merged fire input has been off once. */
  private waitingForFireRelease = false;

  constructor(private readonly sources: InputSource[]) {}

  /** Call once at the start of each frame. */
  poll(): void {
    for (const s of this.sources) {
      s.poll?.();
      if (s.active()) this.lastUsed = s.kind;
    }
  }

  /** True if any device was used since the last endFrame(). */
  used(): boolean {
    return this.sources.some((s) => s.active());
  }

  /**
   * Ignores fire until the player lets go of it, so a press that confirmed a menu or resumed
   * from pause doesn't also fire a shot. Call it when the menu or pause closes.
   */
  holdFireUntilReleased(): void {
    this.waitingForFireRelease = true;
  }

  /**
   * The ship's input for this frame. Call it once per frame: a touch drag is handed out once,
   * then cleared.
   */
  shipInput(): ShipInput {
    const input = mergeShipInputs(this.sources.map((s) => s.shipInput()));
    if (!this.waitingForFireRelease) return input;
    if (!input.fire) this.waitingForFireRelease = false;
    return { ...input, fire: false };
  }

  pressed(action: Action): boolean {
    return this.sources.some((s) => s.pressed(action));
  }

  /** Buzzes every source that can rumble. */
  rumble(strength: number, ms: number): void {
    for (const s of this.sources) s.rumble?.(strength, ms);
  }

  /** Call once at the end of each frame, after every pressed() check. */
  endFrame(): void {
    for (const s of this.sources) s.endFrame();
  }
}
