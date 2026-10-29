# Hivebreak models (Blender scripts)

The ship, aliens and shots are built from Python, so the models are reproducible and diffable.
Needs Blender 5.x locally (`brew install --cask blender`); the exported `.glb` files are
committed, so CI and Vercel never need it.

## Run

From `client/`:

```
npm run models
```

That runs `blender -b --factory-startup --python ../art/blender/build.py`, which for each model:

1. builds it (`player.py`, `drone.py`, `warden.py`, `diver.py`, `shots.py`, each with `build()`),
2. exports `client/public/models/<name>.glb`,
3. renders `art/previews/<name>.png` (256x256, orthographic front view, Workbench), and
4. at the end, `check.py` re-imports every `.glb` and prints its size and triangle count.

Run the check alone with `blender -b --factory-startup --python art/blender/check.py`.
The previews use Blender's studio lighting, so colours look a little greyer than in game.

## Conventions

- 1 Blender unit = 1 art pixel. Origin at the model's visual centre (bounding-box centre).
- Built standing up in the front view: up on screen = +Z, the visible side faces -Y. The glTF
  exporter's Y-up conversion gives Three.js +Y up and +Z toward the camera.
- Flat shaded, modifiers/transforms baked, no cameras, lights, animations or Draco.
- Each model is a root empty (named after the model) with the parts below as child meshes.
  Each part's origin is its hinge (wing root, leg top, antenna base, flame base), so rotating or
  scaling the node about its own origin animates it naturally. `tip_L/R` share the wing pivot so
  wing and tip can rotate together.
- Materials are named by role so the game can recolour them: `hull`, `accent`, `dark`, `glow`
  (emissive, unlit look). Variants use a numeric suffix: `accent2` (player wing tips), `glow2`
  (player engine flames, alien shot). Principled BSDF, roughness 1, metallic 0.

## Parts and sizes (pixels)

| File | Root | Parts | Size W x H |
| --- | --- | --- | --- |
| `player.glb` | `player` | `hull`, `wing_L`, `wing_R`, `tip_L`, `tip_R`, `cockpit`, `flame_L`, `flame_R` | 19 x 21 |
| `drone.glb` | `drone` | `body`, `eye_L`, `eye_R`, `leg_0`, `leg_1`, `leg_2`, `antenna_L`, `antenna_R` | 15 x 13 |
| `warden.glb` | `warden` | `body`, `plate`, `core`, `spike_L`, `spike_R`, `foot_L`, `foot_R` | 17 x 14 |
| `diver.glb` | `diver` | `body`, `wing_L`, `wing_R`, `eye` | 14 x 14 |
| `shots.glb` | `shot_player`, `shot_alien` | `bolt`, `diamond` | 1.6 x 7, 4 x 4.8 |

## Files

- `common.py`: scene clearing, role materials, geometry builders (box, extruded polygon, loft,
  octahedron, icosphere), `add_part` (name, parent, pivot), recentring, glb export, preview render.
- `build.py`: runs everything. `check.py`: verifies the exported files.
