import { describe, expect, it } from 'vitest';
import { Controls, mergeShipInputs, type Action, type InputSource } from './controls';
import type { ShipInput } from './types';

/** A source with a fixed ship input and a set of actions pressed. */
function source(kind: InputSource['kind'], input: ShipInput, actions: Action[] = [], used = true): InputSource {
  return {
    kind,
    shipInput: () => input,
    pressed: (a) => actions.includes(a),
    active: () => used,
    endFrame: () => {},
  };
}
const idle: ShipInput = { move: 0, drag: 0, fire: false, special: false };

describe('mergeShipInputs', () => {
  it('takes the strongest move, keeping its sign', () => {
    expect(mergeShipInputs([{ ...idle, move: 0.3 }, { ...idle, move: -1 }]).move).toBe(-1);
    expect(mergeShipInputs([{ ...idle, move: 0.2 }, { ...idle, move: 0.9 }]).move).toBe(0.9);
  });

  it('adds up the drags from every source', () => {
    expect(mergeShipInputs([{ ...idle, drag: 2 }, { ...idle, drag: 3.5 }]).drag).toBe(5.5);
    expect(mergeShipInputs([{ ...idle, drag: -4 }, { ...idle, drag: 1 }]).drag).toBe(-3);
  });

  it('fires if any source is firing', () => {
    expect(mergeShipInputs([idle, { ...idle, fire: true }]).fire).toBe(true);
    expect(mergeShipInputs([idle, idle]).fire).toBe(false);
  });

  it('is idle with no sources', () => {
    expect(mergeShipInputs([])).toEqual(idle);
  });
});

describe('Controls', () => {
  it('fires an action if any device pressed it, and remembers which device was used last', () => {
    const controls = new Controls([
      source('keyboard', idle, [], false),
      source('touch', { move: 0, drag: 4, fire: true, special: false }, ['pause']),
    ]);
    controls.poll();
    expect(controls.pressed('pause')).toBe(true);
    expect(controls.pressed('mute')).toBe(false);
    expect(controls.shipInput()).toEqual({ move: 0, drag: 4, fire: true, special: false });
    expect(controls.lastUsed).toBe('touch');
  });

  it('merges every source into one ship input', () => {
    const controls = new Controls([
      source('keyboard', { move: -1, drag: 0, fire: false, special: false }),
      source('gamepad', { move: 0.4, drag: 0, fire: true, special: false }),
    ]);
    expect(controls.shipInput()).toEqual({ move: -1, drag: 0, fire: true, special: false });
  });

  it('ignores fire held through a menu or pause until it has been released once', () => {
    let fire = true;
    const controls = new Controls([{ ...source('gamepad', idle), shipInput: () => ({ move: 0, drag: 0, fire, special: false }) }]);
    expect(controls.shipInput().fire).toBe(true);

    controls.holdFireUntilReleased();
    expect(controls.shipInput().fire).toBe(false); // still held: no shot
    expect(controls.shipInput().fire).toBe(false);

    fire = false;
    expect(controls.shipInput().fire).toBe(false); // released: the hold ends here

    fire = true;
    expect(controls.shipInput().fire).toBe(true); // a fresh press fires again
  });

  it('forwards rumble to the sources that can rumble and skips the rest', () => {
    const calls: [number, number][] = [];
    const controls = new Controls([
      source('keyboard', idle),
      { ...source('gamepad', idle), rumble: (strength: number, ms: number) => calls.push([strength, ms]) },
    ]);
    controls.rumble(0.8, 200);
    expect(calls).toEqual([[0.8, 200]]);
  });
});
