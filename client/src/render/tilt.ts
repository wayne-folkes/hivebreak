import { OrthographicCamera } from 'three';
import { FIELD_HEIGHT, FIELD_WIDTH } from '../game/playfield';

// The camera looks at the playfield from slightly below and in front, so models show some of
// their front and underside while the gameplay stays flat. The sim's coordinates are in art
// pixels on the z = 0 plane, so the camera is built to map that plane 1:1 onto the screen: the
// frustum is shortened by cos(tilt), which cancels the foreshortening of y. A shot at the
// ship's x therefore lands exactly on the ship, and only parts that stick out in z (a nose
// cone, a cockpit) shift up the screen, by z * tan(tilt).

/** How far the camera tilts back from looking straight at the field, in degrees. */
export const TILT_DEG = 20;
/** Distance from the camera to the field's centre. Orthographic, so it only has to clear the models. */
export const CAMERA_DISTANCE = 300;

const TILT = (TILT_DEG * Math.PI) / 180;

/** Where the camera sits, with the sim's centre as its target. */
export function cameraPosition(): { x: number; y: number; z: number } {
  return { x: 0, y: -CAMERA_DISTANCE * Math.sin(TILT), z: CAMERA_DISTANCE * Math.cos(TILT) };
}

/** Half the camera's view height in world units. Shortened by cos(tilt) so z = 0 maps 1:1. */
export function frustumHalfHeight(): number {
  return (FIELD_HEIGHT / 2) * Math.cos(TILT);
}

/**
 * Where a world point lands on the 180 x 320 canvas, in art pixels from the top-left corner.
 * `z` is the height above the field (toward the camera).
 */
export function projectToScreen(x: number, y: number, z = 0): { px: number; py: number } {
  return { px: x + FIELD_WIDTH / 2, py: FIELD_HEIGHT / 2 - y - z * Math.tan(TILT) };
}

/** Builds the tilted camera. Call `place` to move it, e.g. for screen shake. */
export function createTiltCamera(): OrthographicCamera {
  const half = frustumHalfHeight();
  const camera = new OrthographicCamera(-FIELD_WIDTH / 2, FIELD_WIDTH / 2, half, -half, 1, 1000);
  placeTiltCamera(camera, 0, 0);
  return camera;
}

/** Points the camera at the field's centre shifted by (dx, dy) world units (= art pixels). */
export function placeTiltCamera(camera: OrthographicCamera, dx: number, dy: number): void {
  const p = cameraPosition();
  camera.position.set(p.x + dx, p.y + dy, p.z);
  camera.lookAt(dx, dy, 0);
}
