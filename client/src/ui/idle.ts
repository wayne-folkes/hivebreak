// The title fades away when nobody touches anything for a while, so the demo behind it can be
// watched. Any input brings it back, and that input only wakes it: a key or tap that wakes the
// title doesn't also press one of its buttons.
//
// main.ts: `idle.update(dt, active)` each frame while the title is the card on top (it returns true
// on the frame the title wakes, when main skips the menu's input); `idle.wake()` when the title
// stops being on top. No DOM in here, so it's unit-tested on its own: `onChange` shows or hides.

/** Seconds without input before the title fades. */
export const TITLE_IDLE_SECONDS = 15;

export class IdleFade {
  private still = 0;
  private faded = false;

  constructor(
    /** Called with true as the title fades out, false as it comes back. */
    private readonly onChange: (faded: boolean) => void,
    private readonly seconds = TITLE_IDLE_SECONDS,
  ) {}

  get isFaded(): boolean {
    return this.faded;
  }

  /** Counts `dt` seconds of stillness, or none if there was input (`active`). Returns true if this input woke the title. */
  update(dt: number, active: boolean): boolean {
    if (active) {
      this.still = 0;
      return this.set(false);
    }
    this.still += dt;
    if (this.still >= this.seconds) this.set(true);
    return false;
  }

  /** Brings the title back at once and restarts the count. Returns true if it was faded. */
  wake(): boolean {
    this.still = 0;
    return this.set(false);
  }

  private set(faded: boolean): boolean {
    if (faded === this.faded) return false;
    this.faded = faded;
    this.onChange(faded);
    return !faded;
  }
}
