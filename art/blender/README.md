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

1. builds it (`player.py`, `drone.py`, `warden.py`, `diver.py`, `shots.py`, `carrier.py`, `brood_mother.py`,
   `pickups.py`, `helper.py`, `splitter.py`, `mini.py`, `hive_mind.py`, each with `build()`; a module may set `PREVIEW = {size, spacing}`),
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
  (emissive, unlit look). Variants use a numeric suffix: `accent2` (player wing tips, Brood Mother
  plates), `glow2` (player engine flames, alien shot, Carrier pod, Brood Mother bay lights).
  Pickups use one glow role per power-up instead: `glow_spread`, `glow_laser`, `glow_slow`,
  `glow_helper`. Principled BSDF, roughness 1, metallic 0.

## Parts and sizes (pixels)

| File | Root | Parts | Size W x H |
| --- | --- | --- | --- |
| `player.glb` | `player` | `hull`, `wing_L`, `wing_R`, `tip_L`, `tip_R`, `cockpit`, `flame_L`, `flame_R` | 19 x 21 |
| `drone.glb` | `drone` | `body`, `eye_L`, `eye_R`, `leg_0`, `leg_1`, `leg_2`, `antenna_L`, `antenna_R` | 15 x 13 |
| `warden.glb` | `warden` | `body`, `plate`, `core`, `spike_L`, `spike_R`, `foot_L`, `foot_R` | 17 x 14 |
| `diver.glb` | `diver` | `body`, `wing_L`, `wing_R`, `eye` | 14 x 14 |
| `carrier.glb` | `carrier` | `hull`, `ring`, `pod`, `eye_L`, `eye_R` | 22.8 x 14.4 |
| `brood_mother.glb` | `brood_mother` | `hull`, `dome`, `wing_L`, `wing_R`, `plate_0`..`plate_3`, `core`, `bay_L`, `bay_R`, `bay_glow_L`, `bay_glow_R` | 105 x 27 |
| `pickups.glb` | `pickup_spread`, `pickup_laser`, `pickup_slow`, `pickup_helper` | `<name>_ring`, `<name>_icon` | 9.7 x 9.7 each |
| `helper.glb` | `helper` | `body`, `eye`, `fin_L`, `fin_R` | 8 x 8 |
| `splitter.glb` | `splitter` | `half_L`, `half_R`, `seam`, `eye_L`, `eye_R` | 16 x 12.9 |
| `mini.glb` | `mini` | `body`, `eye`, `leg_0`, `leg_1` | 8.8 x 7.5 |
| `hive_mind.glb` | `hive_mind` | `core`, `core_eye`, `seg_0`..`seg_7`, `spike_0`..`spike_5` | 72.7 x 84 |
| `shots.glb` | `shot_player`, `shot_alien` | `bolt`, `diamond` | 1.6 x 7, 4 x 4.8 |

## Slice 2a models

- **Carrier** (teal saucer, 208 tris): roles `hull` (#3fd6a0), `accent` (ring, belt), `dark`,
  `glow` (eyes, #ffe14f), `glow2` (pod, #ffb04f; the game can tint it to the carried power-up).
  `pod` pivots at its own centre, (0, -2.4, 0.15) in Three.js axes (x, y up, z toward camera), so
  it can spin about the vertical axis.
- **Brood Mother** (830 tris): roles `hull` #5a48a6, `accent` #6b56c2 (dome, wings), `accent2`
  #c9c2e8 (plates), `dark` #2c2450, `glow` #ff4fd8 (core), `glow2` #ffb04f (bay lights). The model is
  centred on its bounding box. Node positions (pivots) relative to the root, in Three.js axes
  (x right, y up, z toward the camera):

  | Part | x | y | z | Size (x y) | Pivot |
  | --- | --- | --- | --- | --- | --- |
  | `hull` | 0 | -0.05 | -1.22 | 100 x 14.5 (14 deep) | centre of model |
  | `dome` | 0 | -0.05 | -1.22 | 58 x 7, sits on top of hull (y 6.4 to 13.4) | model centre |
  | `plate_0..3` | -39, -13, 13, 39 | -0.05 | 7.78 | 22 x 12 (4 deep) | own centre |
  | `core` | 0 | -0.05 | 2.78 | r 5.4, behind the plates, only visible in the 4 px gaps | own centre |
  | `wing_L / R` | -41 / 41 | 5.95 | -1.22 | root hinge; fins reach x = +-52.5, y = 13.4 | wing root |
  | `bay_L / R` | -28 / 28 | -9.65 | -1.22 | 14 x 5.6 | own centre |
  | `bay_glow_L / R` | -28 / 28 | -12.75 | 1.78 | 9 x 1.6 light strip under each bay | own centre |

  The hull's visible rim above and below the plates is y +-6 to +-7.5. Vertical extent is y = -13.7
  (bay lights) to +13.4 (dome top and wing tips). Hide a plate node to show the core.
- **Pickups** (four roots, 168 tris each): `<name>_ring` is the dark ring (role `dark`, #2c2450),
  `<name>_icon` the glow. Icon roles and colours: `glow_spread` #ffb04f (fan of three bars),
  `glow_laser` #4ff0ff (pointed vertical bar), `glow_slow` #9b7bff (hourglass), `glow_helper` #4fff9b
  (tiny ship). Each root is centred at the origin; spin the root, not the parts.
- **Helper** (216 tris): the player's palette (`hull`, `accent`, `accent2`, `dark`, `glow`); a rounded
  pod with a dark visor, glow `eye`, and two `fin_L/R` hinged at the body. Wingmen reuse `player.glb`.

## Slice 2b models (red nebula)

- **Splitter** (148 tris): roles `hull` #c0392b, `accent` #7e1f2e (jaw plates, horns), `dark` #4a0f20
  (brows), `glow` #ffe14f (eyes), `glow2` #ff8a3d (seam). `half_L` / `half_R` pivot at the seam, at
  x = -0.8 / +0.8 (Blender and Three.js x are the same; the model is centred on its bounding box, so
  the pivots are within a pixel of the root origin). Spread them along x when it dies. `seam` is a
  glowing lozenge on the origin that stands slightly proud of the halves; `eye_L/R` pivot at their
  centres, (+-4, 0.6, 3.6) in Three.js axes.
- **Mini** (112 tris): the Splitter's palette, with `legs` in `accent` #a32c3b. Parts `body`, one
  cyclops `eye` (`glow`), `leg_0` / `leg_1` hinged at the underside of the body (x = -2 / +2).
- **Hive Mind** (988 tris; limit raised to 1500): roles `hull` #d04a64 (ring segments), `accent`
  #8e2a3c (segment inlay, spikes), `glow` #ff4fd8 and `glow3` #c41e8e (core facets), `glow2` #ffe14f
  (core eye, segment vents). About 72.7 wide x 84 tall (the spikes top and bottom set the height).
  **Not recentred**: x and z are symmetric so the boss centre is the root origin; every part
  except the two core parts pivots at exactly (0, 0, 0), so the game can rotate or scale them about the
  boss centre. Angles are measured counter-clockwise from +X as seen from the front (screen
  right = 0 deg, up = 90 deg), which is the game's own convention too.

  | Part | Layout |
  | --- | --- |
  | `core` | icosphere, radius 11, pivot at centre |
  | `core_eye` | flattened crystal r 5 x 3.2 (depth) at (0, 0, +9) toward the camera, pivot at its own centre |
  | `seg_i`, i = 0..7 | arc 30 deg wide centred at `45 * i` deg (seg_0 at +X, then counter-clockwise), radius 26 (centre line), radial thickness 6 (r 23 to 29), 6 deep, 15 deg gaps (the arc spans `45 * i - 15` to `45 * i + 15`); pivot at the boss centre; rotate the whole ring by rotating all eight about z; hide a node to show a destroyed segment |
  | `spike_i`, i = 0..5 | four-sided thorn pointing radially out at `30 + 60 * i` deg, base r 29.8 to tip r 42; pivot at the boss centre |

  Each segment carries an inlay strip and a small orange vent at its centre angle (the weak-point
  cue).

## Files

- `common.py`: scene clearing, role materials, geometry builders (box, extruded polygon, loft,
  octahedron, icosphere), `add_part` (name, parent, pivot), recentring, glb export, preview render.
- `build.py`: runs everything. `check.py`: verifies the exported files.
