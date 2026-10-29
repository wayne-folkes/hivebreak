# Hivebreak: requirements

A browser fixed shooter in the genre Space Invaders started, with its own identity: pixel-art
looks rendered from real 3D models, and a roguelite run where you pick an upgrade between waves,
so each run plays differently. Agreed on 2026-10-29.

"Slice 1" marks what the first playable version includes; everything else is planned for later
slices but shapes the design now.

## Look and art

- **Pixel art, modernized.** The playfield is drawn at a fixed art resolution of **180 × 320**
  and scaled up by whole pixels (nearest-neighbour), so pixels stay square and crisp at any size.
- **Live 3D, pixelated.** Ships and aliens are real 3D models rendered in Three.js at that low
  resolution, then given a pixel-art finish: toon (stepped) lighting, a 1-pixel dark outline, and
  a limited colour palette. Models can bank, spin, wobble and flash in real time.
- An orthographic camera tilted back slightly, so models show some top and front depth while
  gameplay stays flat 2D.
- Modern touches on top of the pixels: bloom-style glow on shots and engines (drawn in pixels),
  pixel particle explosions, screen shake, hit-flash, a scrolling starfield.
- Slice 1: toon lighting, outline, palette, starfield, explosions, shake, hit-flash.

## Models

- **Built by Blender Python scripts in the repo** (`art/blender/`), one per model, run headless
  (`blender -b -P …`) and exported as glTF (`.glb`) into `client/public/models/`.
- The exported `.glb` files are committed, so CI and Vercel never need Blender.
- Models stay low-poly with flat-coloured materials by role (hull, accent, glow), so the palette
  pass can recolour them and enemies can come in variants.
- Moving parts (wings, claws, cores) are separate named nodes, animated in code.
- Needs Blender installed locally (`brew install --cask blender`); not yet installed.
- Slice 1: player ship, three alien types, player and enemy shots.

## Gameplay

### Core

- One ship at the bottom moves left and right and fires upward. Aliens in a formation march side
  to side and step down; the formation speeds up as it thins, and aliens fire back.
- Lives (slice 1: 3). A run ends when you lose your last life or the formation reaches your row.
- **Combo scoring:** each hit in a row raises a multiplier (up to ×8); a shot that misses resets it.
  Rewards aiming over spraying. Slice 1.

### The roguelite run (the main twist)

- A run is a sequence of waves. After each cleared wave you **pick one of three upgrades** offered
  at random from a pool. Upgrades stack, so runs build differently each time.
- Slice 1: 5 waves, a pool of about 6 upgrades (e.g. twin shot, rapid fire, piercing shots, extra
  life, shield that absorbs one hit per wave, faster thrusters). Clearing wave 5 ends the run as a
  win.
- Later: longer runs in sectors, rarer upgrades, upgrade synergies.

### Enemies

- Slice 1, three types:
  - **Drone:** the basic formation alien, one hit, fires rarely.
  - **Warden:** armoured, two hits, fires shots aimed at you.
  - **Diver:** breaks from the formation now and then and swoops at you before returning.
- Wave definitions are data (formation shape, mix of types, speed, fire rate), so new waves are
  cheap to add.

### Later slices

- **Bosses:** a hive mothership every few waves, with phases and weak points.
- **Power-ups:** timed drops from special aliens (spread shot, rapid fire, shield, helper drone),
  separate from the permanent per-run upgrades.
- **Destructible shields:** bunkers that erode pixel by pixel from both sides' fire.
- **Unlocks:** finishing runs unlocks new upgrades and ships for the pool. No permanent stat boosts;
  each run is fair.

## Players

- Single-player first. Player state is kept in an array and input is routed per player, so
  **local co-op** (two gamepads, or gamepad + keyboard) can be added later without a rewrite.

## Devices and layout

- First targets: **phone in portrait** and **desktop browsers**.
- The 9:16 playfield fills a portrait phone's width; the spare height below it is the touch strip,
  so thumbs don't cover the action. Desktop letterboxes it in the centre, with room for the HUD.
- Performance target: steady 60 fps on a mid-range phone. The low art resolution keeps rendering
  cheap.

## Controls

Keyboard, gamepad and touch all work and can be switched mid-run, merged through one `Controls`
layer (ported from rc-racer).

| Action | Keyboard | Gamepad (standard layout) | Touch |
|---|---|---|---|
| Move | ← → or A / D | Left stick or d-pad | Drag anywhere in the lower part of the screen; the ship moves by your thumb's offset, never under it |
| Fire (hold to auto-fire) | Space, Z or ↑ | A (Cross) or RT | Automatic while a thumb is down |
| Special (later slice) | X or Shift | B (Circle) or LT | Button for the second thumb |
| Pause | Esc or P | Start | ⏸ in the corner |
| Mute | M | | 🔊 in the HUD |
| Menus and upgrade picks | Arrows, Enter | D-pad or stick, A | Tap |

- Gamepad rumbles when you're hit.

## Audio

- Sound effects synthesized with Web Audio in code (no sound files), as in rc-racer's `audio.ts`.
  Slice 1: shoot, alien hit, alien death, player hit, upgrade pick, wave clear, game over.
- A chiptune music track (CC0 or generated) in a later slice.
- Sound on/off and volume, remembered.

## Scores and progression

- Slice 1: high scores and best run kept in `localStorage`.
- Later: an online leaderboard on Supabase (free tier) with score sanity checks.

## Platform, hosting and cost

- TypeScript + Vite + Three.js, no React (menus and HUD are plain DOM and CSS), mirroring rc-racer.
- Game logic in `client/src/game/` stays free of rendering and the DOM, and is unit-tested with
  Vitest. Fixed simulation step (1/120 s), as in rc-racer.
- Public GitHub repo `wayne-folkes/hivebreak`, MIT licence, GitHub Actions CI (tests + typecheck +
  build on Node 22 and 24).
- Vercel Hobby (free) at `hivebreak.folkes.dev`, with Vercel Web Analytics and Speed Insights, and a
  page view per screen as in rc-racer.
- No backend until the online leaderboard.
