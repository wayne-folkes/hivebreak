# Slice 3 plan: music and unlocks

Goal: give the game a soundtrack that reacts to play, and a reason to come back: milestones that
unlock ships, Specials and upgrades. Everything stays in the browser, with no backend and no cost.
See [requirements.md](requirements.md) (Audio, Unlocks) and [plan-slice-3.html](plan-slice-3.html)
for the same plan with concept renders.

It ships as **two releases**, each deployed and played before the next starts:

- **3a, music:** a chiptune sequencer, four tracks, stingers, reactive layers, and music settings.
- **3b, unlocks:** milestones, a trimmed starting pool, three new ships, two new Specials, four new
  upgrades and two synergies, a ship choice before each run, an unlocks screen, and save backup.

Not in this slice: the online leaderboard, local co-op.

## Done means

- 3a: the title, both sectors and the bosses each have their music; stingers play on wave clear,
  upgrade pick, victory and game over; layers build as a wave thins and on the last life; boss
  phases change gear; music ducks under boss deaths and Specials and slows under Time Stop and
  Slow; music has its own on/off and volume; no audio glitches when pausing, tabbing away or
  restarting.
- 3b: a new player starts with the trimmed pool; each milestone unlocks what it says, once, with
  an "UNLOCKED" moment at the end of the run; the unlocks screen shows progress and what's next;
  ships and the new Specials play as designed; progress survives reloads and can be exported and
  imported.
- Both: tests, typecheck and build pass; CI is green; deployed; you've played it.

## How the work runs

As in slices 1 and 2: I write the contract for each release, Sonnet and Haiku workers build in
parallel on separate files, the reviewer checks each round and re-checks the fixes, and I play-test
before pushing.

## 3a: music

1. **Contract (main session):** the song format (tempo, channels, patterns as note data, layers,
   loop points), the music API (`play(track)`, `stinger(name)`, `setIntensity`, `setBossPhase`,
   `duck`, `setTimeScale`, `setVolume`), and its settings.
2. **Parallel workers:**
   - **Sonnet, engine:** the sequencer on Web Audio (square/triangle/noise voices scheduled ahead
     with a lookahead timer, so it stays in time however the frame rate varies), crossfades
     between tracks, layer fades, ducking, time scaling, and stingers that don't clash with the beat.
   - **Sonnet, composer:** the four tracks and the stingers as data, written against the song
     format, with a dev-only page to audition them.
   - **Haiku, settings:** music on/off and volume in Settings, saved with the sound settings.
3. **Wiring (Sonnet):** a music director in `main.ts` that picks the track by screen and wave,
   sets intensity from the formation and lives, follows boss phases, ducks on big events, and
   slows under Time Stop and Slow.
4. **Review, play-test (by ear, on desktop and phone), ship.**

## 3b: unlocks

5. **Contract (main session):** unlock ids for ships, Specials and upgrades; milestone definitions
   (id, description, check, reward); the progress state and its save format with a version number;
   ship definitions; the two Specials and four upgrades in the existing unions.
6. **Parallel workers:**
   - **Sonnet, progression:** the milestone checks (fed by run events and run-end results),
     unlock bookkeeping, the starting pool, save/load with versioning, export/import codes.
   - **Sonnet, new content:** the three ships' stats and fire patterns, Missile Swarm and Gravity
     Well, the four upgrades and two synergies, wired into the run and the offer (only unlocked
     items are offered).
   - **Sonnet, models:** Interceptor, Lancer and Bulwark ships; a missile; the Gravity Well's core.
7. **Second round in parallel:** renderer (ships, missiles, the well's pull), UI (ship choice card,
   unlocks screen, the end-of-run "UNLOCKED" moment, locked items shown as next goals, export and
   import in Settings), sound (unlock fanfare, the new Specials).
8. **Wiring, review, play-test, ship.**

## Draft content (to be tuned in the work)

| Ship | Trade-off | Unlocked by |
|---|---|---|
| Breaker | Balanced, 3 lives | Start |
| Interceptor | 35% faster, fires 15% faster, 2 lives | Reach sector 2 |
| Lancer | Twin piercing shot, fires 35% slower | Defeat the Brood Mother |
| Bulwark | A free shield every wave, 15% slower | Destroy 300 aliens in total |

| Special | Effect | Unlocked by |
|---|---|---|
| Pulse Bomb, Shield Burst | As today | Start |
| Time Stop | As today | Fire your Special 5 times in one run |
| Missile Swarm | Eight homing missiles, 2 damage each | Reach the Hive Mind |
| Gravity Well | A vortex mid-field pulls in enemy shots and free aliens and grinds them for 3 s | Win a run |

| New upgrade | Effect |
|---|---|
| Chain Spark | A hit arcs to one nearby alien for 1 damage |
| Scavenger | Power-ups last 50% longer and drop more often |
| Overclock | The Special meter charges 30% faster |
| Last Stand | On your last life, fire 30% faster |

New synergies: **Storm** (Chain Spark + Homing: sparks chain twice) and **Battery** (Overclock +
Scavenger: catching a power-up adds a quarter of the meter).

Starting upgrades: twin shot, rapid fire, extra life, piercing, shield pulse, thrusters, combo
guard, magnet, homing. Unlocked by milestones: ricochet, bomb on kill, overcharge, wingman, slow
field, double tap, and the four new ones.

Draft milestones (each unlocks one item): clear wave 3; reach an x8 combo; unlock any synergy;
catch 10 power-ups in one run; fire your Special 5 times in one run; clear a wave without breaking
your combo; beat the Brood Mother without losing a life; reach sector 2; defeat the Brood Mother;
reach the Hive Mind; win a run; win with Time Stop; win with two different ships; destroy 300
aliens in total; finish 10 runs.

## Open for later

- Online leaderboard (Supabase), possibly with daily seeded runs.
- Local co-op for controllers.
