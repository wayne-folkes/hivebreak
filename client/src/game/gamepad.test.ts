import { describe, expect, it } from 'vitest';
import { BUTTON, GamepadInput, padActions, padShipInput, type PadSnapshot } from './gamepad';

/** A standard-layout pad with nothing pressed, plus whatever's given. */
function pad(pressed: Partial<Record<keyof typeof BUTTON, number>> = {}, axes: number[] = [0, 0, 0, 0]): PadSnapshot {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  for (const [name, v] of Object.entries(pressed)) {
    buttons[BUTTON[name as keyof typeof BUTTON]] = { pressed: v > 0.5, value: v };
  }
  return { axes, buttons };
}

describe('padShipInput', () => {
  it('is idle with nothing pressed and the stick resting slightly off-centre', () => {
    expect(padShipInput(pad({}, [0.1, -0.05]))).toEqual({ move: 0, drag: 0, fire: false, special: false });
  });

  it('steers with the stick, starting gently past the deadzone', () => {
    expect(padShipInput(pad({}, [1, 0])).move).toBe(1);
    expect(padShipInput(pad({}, [-1, 0])).move).toBe(-1);
    const part = padShipInput(pad({}, [0.6, 0])).move;
    expect(part).toBeGreaterThan(0.3);
    expect(part).toBeLessThan(0.6);
  });

  it('lets the d-pad override the stick', () => {
    expect(padShipInput(pad({ left: 1 }, [0.8, 0])).move).toBe(-1);
    expect(padShipInput(pad({ right: 1 }, [-0.8, 0])).move).toBe(1);
  });

  it('fires with A, or with the right trigger pulled past the threshold', () => {
    expect(padShipInput(pad({ a: 1 })).fire).toBe(true);
    expect(padShipInput(pad({ rt: 0.5 })).fire).toBe(true);
    expect(padShipInput(pad({ rt: 0.2 })).fire).toBe(false);
    expect(padShipInput(pad({ b: 1 })).fire).toBe(false);
  });

  it('never drags: only touch moves the ship by an amount', () => {
    expect(padShipInput(pad({ a: 1 }, [1, 0])).drag).toBe(0);
  });
});

describe('padActions', () => {
  it('maps buttons to actions', () => {
    expect(padActions(pad({ b: 1 }))).toContain('special');
    expect(padActions(pad({ start: 1 }))).toContain('pause');
    expect(padActions(pad({ start: 1 }))).not.toContain('confirm');
    expect(padActions(pad({ a: 1 }))).toContain('confirm');
  });

  it('maps the left trigger to special', () => {
    expect(padActions(pad({ lt: 1 }))).toContain('special');
    expect(padActions(pad({ lt: 0.2 }))).not.toContain('special');
  });

  it('does not turn fire into an action: it is held, so it lives in the ship input', () => {
    expect(padActions(pad({ a: 1, rt: 1 })).size).toBe(1);
  });

  it('treats a pushed stick as a d-pad for menus', () => {
    expect(padActions(pad({}, [0, -0.9]))).toContain('up');
    expect(padActions(pad({}, [0.9, 0]))).toContain('right');
    expect(padActions(pad({}, [0.3, 0.3])).size).toBe(0);
  });
});

describe('GamepadInput', () => {
  it('reports each button press once, until it is released and pressed again', () => {
    let current: PadSnapshot = pad();
    const input = new GamepadInput(() => [{ ...current, connected: true } as unknown as Gamepad]);
    const frame = () => {
      input.poll();
      const paused = input.pressed('pause');
      input.endFrame();
      return paused;
    };
    expect(frame()).toBe(false);
    current = pad({ start: 1 });
    expect(frame()).toBe(true);
    expect(frame()).toBe(false); // still held
    current = pad();
    expect(frame()).toBe(false);
    current = pad({ start: 1 });
    expect(frame()).toBe(true);
  });

  it('is idle with no controller plugged in', () => {
    const input = new GamepadInput(() => [null]);
    input.poll();
    expect(input.connected).toBe(false);
    expect(input.shipInput()).toEqual({ move: 0, drag: 0, fire: false, special: false });
    expect(input.active()).toBe(false);
  });

  it('rumbles through vibrationActuator when the pad has one', () => {
    const effects: unknown[][] = [];
    const current = {
      ...pad(),
      connected: true,
      vibrationActuator: {
        playEffect: (...args: unknown[]) => {
          effects.push(args);
          return Promise.resolve('complete');
        },
      },
    };
    const input = new GamepadInput(() => [current as unknown as Gamepad]);
    input.poll();
    input.rumble(1, 150);
    expect(effects).toEqual([
      ['dual-rumble', { duration: 150, strongMagnitude: 1, weakMagnitude: 0.6 }],
    ]);
  });

  it('falls back to hapticActuators on older browsers', () => {
    const pulses: [number, number][] = [];
    const current = {
      ...pad(),
      connected: true,
      hapticActuators: [{ pulse: (value: number, ms: number) => (pulses.push([value, ms]), Promise.resolve(true)) }],
    };
    const input = new GamepadInput(() => [current as unknown as Gamepad]);
    input.poll();
    input.rumble(0.5, 100);
    expect(pulses).toEqual([[0.5, 100]]);
  });

  it('does nothing when the pad cannot rumble, or no pad is connected', () => {
    const plain = { ...pad(), connected: true };
    const input = new GamepadInput(() => [plain as unknown as Gamepad]);
    input.poll();
    expect(() => input.rumble(1, 100)).not.toThrow();

    const none = new GamepadInput(() => [null]);
    none.poll();
    expect(() => none.rumble(1, 100)).not.toThrow();
  });
});
