import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';
import { SHIP_BOX_OFFSET_Y, SHIP_Y } from '../game/player';
import { createTiltCamera, placeTiltCamera, projectToScreen, TILT_DEG } from './tilt';

/** Projects with the real camera and converts to canvas pixels from the top-left. */
function viaCamera(camera: ReturnType<typeof createTiltCamera>, x: number, y: number, z: number) {
  camera.updateMatrixWorld();
  const ndc = new Vector3(x, y, z).project(camera);
  return { px: ((ndc.x + 1) / 2) * FIELD_WIDTH, py: ((1 - ndc.y) / 2) * FIELD_HEIGHT };
}

describe('tilt projection', () => {
  it('maps the z = 0 plane 1:1 onto the canvas', () => {
    const camera = createTiltCamera();
    for (const [x, y] of [[0, 0], [-90, 160], [90, -160], [37, -132], [-12.5, 80]]) {
      const got = viaCamera(camera, x, y, 0);
      expect(got.px).toBeCloseTo(x + FIELD_WIDTH / 2, 4);
      expect(got.py).toBeCloseTo(FIELD_HEIGHT / 2 - y, 4);
    }
  });

  it('puts a shot at the ship\'s x on the ship\'s column, and the ship box where the sim has it', () => {
    const camera = createTiltCamera();
    const ship = viaCamera(camera, 25, SHIP_Y + SHIP_BOX_OFFSET_Y, 0);
    const shot = viaCamera(camera, 25, SHIP_Y + 40, 0);
    expect(shot.px).toBeCloseTo(ship.px, 6);
    expect(ship.py).toBeCloseTo(FIELD_HEIGHT / 2 - (SHIP_Y + SHIP_BOX_OFFSET_Y), 4);
  });

  it('shifts points above the field up the screen by z * tan(tilt)', () => {
    const camera = createTiltCamera();
    const flat = viaCamera(camera, 10, 20, 0);
    const raised = viaCamera(camera, 10, 20, 4);
    expect(flat.py - raised.py).toBeCloseTo(4 * Math.tan((TILT_DEG * Math.PI) / 180), 4);
    expect(raised.px).toBeCloseTo(flat.px, 6);
  });

  it('agrees with projectToScreen', () => {
    const camera = createTiltCamera();
    const a = projectToScreen(-33, 71, 5);
    const b = viaCamera(camera, -33, 71, 5);
    expect(b.px).toBeCloseTo(a.px, 4);
    expect(b.py).toBeCloseTo(a.py, 4);
  });

  it('shakes by whole world units, which are whole pixels on the field plane', () => {
    const camera = createTiltCamera();
    placeTiltCamera(camera, 3, -2);
    const got = viaCamera(camera, 0, 0, 0);
    expect(got.px).toBeCloseTo(FIELD_WIDTH / 2 - 3, 4);
    expect(got.py).toBeCloseTo(FIELD_HEIGHT / 2 - 2, 4);
  });
});
