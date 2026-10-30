# Slice 2 plan: depth, bosses and a second sector

Approved on 2026-10-30.

Goal: make a run worth repeating. Upgrades you can feel, power-ups and a Special for burst moments,
a boss at the end of each sector, and a second sector that looks and plays differently. See
[requirements.md](requirements.md) for the full picture, and [plan-slice-2.html](plan-slice-2.html)
for the same plan with concept renders.

It ships as **two releases**, each deployed and play-tested before the next starts:

- **2a, sector 1 deepened:** retuned difficulty, the upgrade rework, power-ups, the Special, the
  Carrier, and the Brood Mother boss at wave 5. The run still ends after wave 5, now with a boss.
- **2b, sector 2:** waves 6-10 with their own look, the Splitter, new formation behaviours,
  destructible shields in both sectors, and the Hive Mind boss at wave 10. The run becomes 10 waves.

Not in this slice: music, the online leaderboard, unlocks, local co-op.

## Done means

- 2a: a run of five waves ends in a Brood Mother fight; you pick a Special at the start, can fire it
  from a full meter with every input type, and power-ups drop and work. Upgrades include the new
  ones, a rare tier and synergies, and the pick card shows when one completes a synergy.
- 2b: a run is ten waves in two sectors; sector 2 has its own palette, the Splitter and new
  formation behaviours; shields erode in both sectors; the Hive Mind's three phases end the run.
- Both: the scripted bot clears every wave and boss with spare lives (tests); with 3 lives it wins
  fewer runs than in slice 1 (tuning check); `npm test`, typecheck and build pass; CI is green; it's
  deployed to hivebreak.folkes.dev; and you've play-tested it.

## How the work runs

Same as slice 1. I write the shared types for each release (the contract), then smaller models
build in parallel on separate files: Sonnet for design-heavy parts (simulation, bosses, renderer, UI),
Haiku for ports and routine parts. A reviewer agent checks every batch, the workers fix what it
finds, and the reviewer re-checks. I play-test in the browser before each commit, and push only
when a release is complete.

## 2a: sector 1 deepened

### 1. Contract (main session)

Extend `types.ts`: power-up kinds and pickups, active power-up timers, the Special choice and
meter, upgrade rarity `rare`, synergy ids, a `Boss` with parts (plates, bays, core) and phases,
the Carrier kind, and the new events (pickup, power-up start/end, special fired, boss phase,
boss part destroyed, boss killed). Add a `chooseSpecial` phase before wave 1.

### 2. Parallel workers

| Worker | Model | Owns |
|---|---|---|
| Upgrades and tuning | Sonnet | `upgrades.ts`, `waves.ts`, `player.ts`, shot behaviour (homing, ricochet, spread, overcharge); retune numbers; synergies; rare tier; bot win-rate report |
| Power-ups, Special, Carrier | Sonnet | new `powerups.ts`, `special.ts`; Carrier in `aliens.ts`; drop rules |
| Brood Mother | Sonnet | new `boss.ts` (movement, plates, bays launching Drones, phases, damage) and its tests |
| Models | Sonnet | Blender scripts for the Carrier, the Brood Mother (plates and bays as separate parts), four pickup icons, the Special effect meshes |

Then one Sonnet worker folds them into `run.ts` (phases, events, wave 5 as a boss wave, the rare
offer after the boss), since all three sim workers would otherwise collide there.

### 3. Second parallel round

| Worker | Model | Owns |
|---|---|---|
| Renderer | Sonnet | boss rendering with part damage and flashes, pickups, power-up visuals (spread, beam, slow tint, helper drone), the three Special effects |
| UI | Sonnet | Special choice card, Special meter, power-up timer, boss health bar, rare and synergy labels on pick cards, touch Special button |
| Sound | Haiku | sounds for pickups, power-ups, each Special, boss phases and death |

### 4. Wiring, review, ship

Sonnet wires the new screens and events into `main.ts`; the reviewer checks all of 2a; fixes; I
play-test (including the boss fight and each Special on phone and desktop); push; follow CI and the
Vercel deploy; you play-test.

## 2b: sector 2

### 5. Contract (main session)

Extend the types for sectors (palette id per wave), the Splitter, formation behaviours
(split/regroup, paired dives), shields (a per-bunker pixel mask), and the Hive Mind (shield ring
segments, beam sweeps, phases).

### 6. Parallel workers

| Worker | Model | Owns |
|---|---|---|
| Sector 2 waves | Sonnet | waves 6-10 data, the Splitter, formation behaviours, sector difficulty |
| Shields | Sonnet | new `shields.ts`: bunker masks, erosion from both sides' shots, collisions |
| Hive Mind | Sonnet | Hive Mind in `boss.ts`: ring segments, aimed shots through gaps, telegraphed beams, desperation phase |
| Models | Sonnet | Splitter, mini-drone, Hive Mind (core and ring segments) |

Then `run.ts` integration (10 waves, two sectors, win after wave 10).

### 7. Second parallel round

| Worker | Model | Owns |
|---|---|---|
| Renderer | Sonnet | sector 2 palette and red-nebula starfield, shields as an eroding pixel texture, Hive Mind with its ring and beam telegraphs |
| UI and sound | Haiku | sector banner ("SECTOR 2"), wave counter to 10, records showing wave of 10, new sounds |

### 8. Wiring, review, ship

As in step 4.

## Open questions for later

- Music: chiptune tracks per sector, and whether bosses get their own.
- Online leaderboard (Supabase): names, daily seeded runs, score checks.
- Unlocks: which upgrades and ships finishing runs should unlock.
