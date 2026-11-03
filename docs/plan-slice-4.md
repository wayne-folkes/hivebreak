# Slice 4 plan: sector 3 and Boss Rush

Drafted on 2026-11-03. Not approved yet.

Goal: more game to play. A third sector of five waves goes in after the Hive Mind, with new aliens,
field hazards and new formation tricks, and it ends in a new boss. Winning a run then opens
**Boss Rush**: every boss back to back, on its own high-score table. Everything stays in the
browser, with no backend and no cost. See [plan-slice-4.html](plan-slice-4.html) for the same
plan with concept pictures.

Decided with you on 2026-11-03:
- **New levels:** sector 3 with a new boss. The run becomes 15 waves.
- **New content:** new alien types, field hazards and new formation tricks.
- **Boss Rush unlock:** win a run once.
- **Boss Rush records:** its own table, ranked by score, with the clear time beside each entry.

It ships as **two releases**, each deployed and played before the next starts:

- **4a, sector 3:** waves 11–14, two new aliens, mines and acid rain, two formation tricks, the
  sector's look and music. For the length of 4a the run ends after wave 14, and the Hive Mind
  stays the last boss.
- **4b, the Hive Heart and Boss Rush:** the new boss at wave 15, its music, Boss Rush (mode,
  records table, unlock), and the terminal version catching up.

Not in this slice: the online leaderboard, local co-op.

## Done means

- 4a: sector 3 opens with its banner after the Hive Mind; each new alien, hazard and formation
  trick plays as designed and reads clearly on a phone; the sector has its own colours and track;
  the autopilot bot still wins sometimes, and the win rate is lower than for a 10-wave run.
- 4b:
  - the Hive Heart fights in three phases and its music follows them;
  - winning a run unlocks Boss Rush, with an UNLOCKED moment;
  - Boss Rush plays the three bosses in order, with upgrade picks between them;
  - Boss Rush has its own records table with score, time and bosses beaten;
  - the terminal version plays sector 3, the Hive Heart and Boss Rush.
- Both: tests, typecheck and build pass; CI is green; deployed; you've played it.

## How the work runs

As in earlier slices: I write the contract for each release, Sonnet and Haiku workers build in
parallel on separate files, the reviewer checks each round and re-checks the fixes, and I play-test
before pushing. Balance is checked with the autopilot bot on seeded runs.

## 4a: sector 3

1. **Contract (main session):** `Sector` gains 3; `AlienKind` gains `warper` and `mender`; new
   `FormationBehaviour`s `weave` and `pincer`; hazards in the run state (`mines`, `acidRain`), and
   their events; the four wave definitions as data.
2. **Parallel workers:**
   - **Sonnet, aliens and formations:**
     - the Warper's blink and the Mender's heal;
     - the weave (rows march in opposite directions) and the pincer (the wave flies in from both
       sides and docks).
   - **Sonnet, hazards:** mines (drift, burst, chain into aliens, explode at the ship's row) and
     acid rain (telegraphed columns that hurt the ship and eat bunkers from above).
   - **Sonnet, models:** Warper, Mender and the mine in Blender; the sector 3 nebula tint.
   - **Sonnet, composer:** the sector 3 track, in the existing song format.
3. **Second round:** renderer and effects (blink trails, heal links, mine bursts, rain telegraphs),
   the sector banner and HUD text, sounds for the new events, and the director picking the new
   track.
4. **Balance, review, play-test, ship.**

## 4b: the Hive Heart and Boss Rush

5. **Contract (main session):**
   - `BossKind` gains `hiveHeart`; the run's `mode` is `'normal' | 'bossRush'`.
   - Boss Rush gets its records (`hivebreak.bossRush.v1`) and an unlock entry for the mode.
6. **Parallel workers:**
   - **Sonnet, boss:** the Hive Heart's parts, phases and attacks.
   - **Sonnet, Boss Rush:**
     - run setup: three starting picks, then the bosses in order;
     - a pick and a partial bunker rebuild between bosses;
     - the clear timer and its time bonus;
     - the records table and the unlock check.
   - **Sonnet, models and music:** the Hive Heart model; the heartbeat boss track, whose kick
     lines up with the boss's pulse rings.
7. **Second round:**
   - Title menu: a Boss Rush entry, locked until the first win.
   - Boss Rush records next to the normal ones; the UNLOCKED moment for the mode.
   - Renderer and effects for the Heart.
   - Terminal version: sprites for the new aliens, mines and the Heart, and Boss Rush in its
     menus and records.
8. **Wiring, balance, review, play-test, ship.**

## Draft content (to be tuned in the work)

### Sector 3: "The heart of the hive"

Acid green and gold on near-black, after sector 1's cyan and sector 2's red.

| Wave | What's new |
|---|---|
| 11 | The **pincer**: the formation flies in as two halves from the sides and docks. Warpers are introduced. |
| 12 | The **weave**: rows march in opposite directions, so gaps open and close. Menders are introduced. |
| 13 | **Mines** drift down through a dense formation. |
| 14 | Everything: weave, Warpers, Menders and mines, plus **acid rain**. |
| 15 | The **Hive Heart** (4b). |

### New aliens

| Alien | HP | Behaviour |
|---|---|---|
| Warper | 2 | The first hit blinks it to an empty slot in the formation, with a short warp-in flash. Combos survive the blink. |
| Mender | 3 | Every 4 s it pulses and restores 1 HP to damaged aliens next to it, shown by green links. Kill it first. |

### Hazards

- **Mines** drift slowly down from the top. One shot bursts a mine and damages the aliens around
  it, so it pays to shoot mines that sit near the formation. A mine that reaches the ship's row
  explodes, and the blast hurts the ship if it is close.
- **Acid rain** (wave 14): columns are marked at the top for a second, then rain for 1.5 s. The rain
  hurts the ship and eats bunkers from above.

### The Hive Heart

A huge heart in the hive's core, fed by four veins.

| Phase | Starts at | What happens |
|---|---|---|
| 1 | Full health | The veins shield the Heart. Every beat it fires a ring of shots with a gap in it, timed to the music. |
| 2 | All four veins cut | The Heart is exposed. It launches Warpers and Menders, and the rings come faster. |
| 3 | Below 1/3 health | Double rings. The Heart sinks lower, so there is less room. |

### Boss Rush

- **Unlock:** win a run. The milestone that unlocks the Gravity Well, "win a run", now also opens
  Boss Rush. Players who won the 10-wave game already have it.
- **How it runs:**
  - Choose a ship and a Special as usual.
  - Take three upgrade picks.
  - Fight the Brood Mother, then the Hive Mind, then the Hive Heart, with an upgrade pick and a
    partial bunker rebuild between bosses.
  - Your lives carry over between bosses.
- **Score:** points as usual, plus a time bonus for each boss beaten under par.
- **Records:** a top 10 by score, each entry showing the clear time and how many bosses were
  beaten (1/3, 2/3 or 3/3). It is shown next to the normal records.

### Knock-on changes

- A normal run is 15 waves, so "win a run" gets harder. Records already note how many waves a run
  had, so old wins still read correctly.
- The autopilot behind the title learns to deal with the new aliens and mines well enough to look
  good.

## Open for later

- Online leaderboard (Supabase), possibly with daily seeded runs and a daily Boss Rush.
- Local co-op for controllers.
- New unlocks tied to sector 3 and Boss Rush (a ship or Special for clearing Boss Rush).
