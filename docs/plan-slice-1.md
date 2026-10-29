# Slice 1 plan: one full run

Approved on 2026-10-29. The same plan, with concept renders, is in [plan-slice-1.html](plan-slice-1.html).

Goal: a complete, deployed run of Hivebreak you can play on a phone in portrait and on desktop,
with keyboard, touch and gamepad. Five waves, an upgrade pick after each, three alien types, combo
scoring, local high score, synth sound. See [requirements.md](requirements.md) for the full picture.

Not in this slice: bosses, power-up drops, destructible shields, unlocks, music, online leaderboard,
co-op, the special button.

## Done means

- A full run plays from the title screen to a win after wave 5, or to game over, and back to the title.
- It works with keyboard, gamepad (Xbox and PlayStation layouts) and touch on a portrait phone.
- Ship and aliens are Blender-scripted models rendered in the pixel style.
- `npm test`, `npm run typecheck` and `npm run build` pass, CI is green, and it's live at
  `hivebreak.folkes.dev`.

## Steps

Steps 2 to 4 are independent of each other once step 1 has settled the shared types, so they can
run in parallel. Routine implementation goes to the `implementer` subagent; design and review stay
in the main session.

### 1. Sim core types (main session)

Define the shapes the rest builds on, in `client/src/game/`:

- `rng.ts`: seeded RNG, so runs and tests are reproducible.
- `types.ts`: `PlayerState` (in an array, for co-op later), `Shot`, `Alien`, `AlienKind`,
  `WaveDef`, `Upgrade`, `RunState`, and `RunEvent` (hit, kill, playerHit, waveClear, …) for sound
  and effects to react to.

### 2. Simulation (pure TypeScript, tested)

- `player.ts`: movement with a little acceleration, fire rate, invulnerability after a hit.
- `formation.ts`: march, step down, speed-up as it thins, enemy fire choice.
- `aliens.ts`: Drone, Warden (2 hits, aimed shots), Diver (swoop path out and back).
- `collision.ts`: shots against aliens and the player (axis-aligned boxes are enough).
- `waves.ts`: five `WaveDef`s as data.
- `upgrades.ts`: the pool of about 6 upgrades and how each modifies `PlayerState`; offer three at random.
- `scoring.ts`: points per alien, combo multiplier up to ×8, reset on a miss.
- `run.ts`: ties it together: `step(run, inputs, dt)` → events; wave clear → upgrade pick → next wave;
  win and game over.
- `records.ts`: local high scores in `localStorage`.
- Tests for each, plus a full simulated run driven by a scripted bot, as rc-racer does for races.

### 3. Input

- Port `controls.ts`, `input.ts` (keyboard) and `gamepad.ts` from rc-racer, changing the car input
  to a ship input (`move`, `fire`) and the action set (fire, special, pause, confirm, menu moves).
- New `touch.ts`: relative drag anywhere in the lower part of the screen moves the ship by the
  thumb's offset; auto-fire while a thumb is down; ⏸ button. Pure maths in tested functions, as in
  rc-racer's `touch.ts`.
- Gamepad rumble on a player hit.

### 4. Models and art pipeline

- Install Blender (`brew install --cask blender`), with your OK first.
- `art/blender/common.py`: shared helpers (materials by role: hull, accent, glow; naming of
  animated parts; export to `.glb` with Y-up and the right scale).
- One script per model: `player.py`, `drone.py`, `warden.py`, `diver.py`, and shots.
- `npm run models` runs them all and writes `client/public/models/*.glb`; the `.glb` files are
  committed.

### 5. Renderer

- `client/src/render/`: low-resolution render target at 180 × 320, whole-pixel upscale (the
  scaffold's `playfield.ts`), tilted orthographic camera.
- Toon materials, 1-pixel outline pass, palette quantization pass.
- Load the `.glb` models, instance aliens, animate parts (bank, wobble, flap), hit-flash.
- Starfield, pixel particle explosions, screen shake. Render interpolated between sim steps.

### 6. UI and audio

- DOM cards in the rc-racer style (`ui/card.ts` focus and menu pattern): title, how to play,
  settings (sound, volume), pause, upgrade pick (three cards; d-pad, arrows or tap), game over and
  win with high score.
- HUD: score, combo, lives, wave.
- `audio.ts`: synth SFX for the events in `RunEvent`, sound on/off and volume saved.
- A page view per screen for Vercel Analytics.

### 7. Ship it

- README with controls, screenshot and how to run, in the rc-racer style.
- With your go-ahead: create the public GitHub repo `wayne-folkes/hivebreak` and push, create the
  Vercel project, add `hivebreak.folkes.dev`. Then follow CI and the Vercel deploy through (`/ship`).
- Play-test on a real phone in portrait and with a controller; tune speeds, fire rates and
  upgrade values.

## Open questions for later slices

- Boss design and how often bosses come.
- Which power-up drops, and how they differ from upgrades.
- Leaderboard: anonymous names or sign-in, and what counts as a fair score.
