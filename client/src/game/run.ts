import { ALIEN_SPECS, alienBox, damageAlien, startDive, stepAlien } from './aliens';
import {
  BOSS_POINTS,
  bossDefeated,
  bossEntering,
  createBoss,
  damageBossFixed,
  damageBossPart,
  freeAlienGone,
  hitBoss,
  partBox,
  stepBoss,
  stepFreeAlien,
} from './boss';
import type { BossHit } from './boss';
import { firstAlienHit, overlaps, shotBox, SHOT_HALF_HEIGHT } from './collision';
import { hasInvaded, pickShooter, rollEvent, slotPosition, spawnFormation, stepFormation } from './formation';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import {
  activatePowerUp,
  applyRunEffect,
  computeBeam,
  enemyTimeScale,
  hasPowerUp,
  helperShots,
  laserDamage,
  rollDrop,
  spawnPickup,
  spreadVolley,
  stepPickups,
  tickLaser,
  tickPowerUps,
  tickRunEffects,
} from './powerups';
import { createPlayer, currentFireInterval, hitPlayer, isAlive, nearestPlayer, shipBox, SHIP_Y, stepPlayer, tryFire, wingmanShots } from './player';
import { createRng } from './rng';
import { VOLLEY_HIT, awardKill, refillWaveGuards, registerMiss, registerShotHit } from './scoring';
import type { Target } from './shots';
import { stepShot } from './shots';
import { CHARGE_PER_BOSS_PART, chargeSpecial, fireSpecial, killCharge, reflectShots, tickBurst } from './special';
import { BURST_DAMAGE, BURST_RADIUS, hasSynergy, killBursts, unlockSynergies } from './synergies';
import type { Alien, Box, Pickup, PlayerState, RunEvent, RunPhase, RunState, ShipInput, Shot, ShotKind, SpecialId } from './types';
import { NO_INPUT } from './types';
import { applyUpgrade, offerUpgrades } from './upgrades';
import { WAVE_COUNT, WAVES, waveColumns } from './waves';

// A whole run: the phases from the Special choice to a win or loss, and the fixed simulation step
// that ties the ships, power-ups, Special, formation, boss, shots, collisions and scoring
// together. Pure and deterministic: the same seed and the same inputs always play out the same way
// (all randomness comes from `run.rng`).
//
// One `playing` step runs in this order:
//   1. run effects tick (real time) and `run.time` advances
//   2. each ship: movement and timers, power-up timers, Shield Burst, laser tick
//   3. Special presses
//   4. firing: the laser beam, or the volley (with the spread power-up), wingmen, helper drone
//   5. enemies, on scaled time (frozen, slowed or stunned): formation, aliens, boss, shots they fire
//   6. shots fly; the ones that left the field are dropped and missed volleys counted
//   7. Shield Burst reflects; enemy shots and crashing aliens hit the ships
//   8. player shots hit aliens, then the boss
//   9. pickups fall and are caught
//  10. the wave ends (cleared, boss defeated) or the run is lost

export { WAVE_COUNT } from './waves';

/** Seconds of banner before a wave's aliens start to move. */
export const WAVE_INTRO_SECONDS = 1.5;
/** Aliens' shots fall at this speed, art pixels per second. */
export const ALIEN_SHOT_SPEED = 90;
/** The most sideways speed an aimed warden shot can have. */
export const ALIEN_SHOT_MAX_VX = 50;
/** Upgrades on offer between waves. */
export const OFFER_SIZE = 3;
/** Gap between players' starting places when there's more than one, art pixels. */
export const PLAYER_START_SPACING = 40;
/** The laser's blocked-core flare comes at most this often, seconds. */
export const CORE_BLOCK_FLARE_SECONDS = 0.3;
/** Player shots are dropped once they are this far past the side walls, art pixels. */
export const SHOT_SIDE_MARGIN = 4;

/**
 * Starts a run waiting in the Special choice, at wave 0 or, for testing, at `firstWave` (an
 * index into the wave list; the dev server's `?wave=` uses it to reach the boss quickly).
 */
export function createRun(seed: number, playerCount = 1, firstWave = 0): RunState {
  const players = Array.from({ length: playerCount }, (_, i) =>
    createPlayer(i, (i - (playerCount - 1) / 2) * PLAYER_START_SPACING),
  );
  const run: RunState = {
    phase: 'chooseSpecial',
    phaseTime: 0,
    time: 0,
    wave: Math.max(0, Math.min(WAVES.length - 1, Math.floor(firstWave))),
    players,
    aliens: [],
    shots: [],
    pickups: [],
    bunkers: [],
    beams: [],
    boss: null,
    freeze: 0,
    slow: 0,
    stun: 0,
    formation: { offsetX: 0, offsetY: 0, dir: 1, startCount: 0 },
    score: 0,
    combo: 1,
    bestCombo: 1,
    offer: [],
    rng: createRng(seed),
    nextId: 1,
  };
  startWave(run);
  setPhase(run, 'chooseSpecial');
  return run;
}

function setPhase(run: RunState, phase: RunPhase): void {
  run.phase = phase;
  run.phaseTime = 0;
}

/**
 * Sets a ship's Special for the run. Once every ship has chosen, wave 0's intro begins (its
 * `waveStart` event comes from the intro's first step). Does nothing outside the Special choice.
 */
export function chooseSpecial(run: RunState, special: SpecialId, playerId = 0): RunEvent[] {
  const player = run.players[playerId];
  if (run.phase !== 'chooseSpecial' || !player) return [];
  player.special = special;
  player.specialCharge = 0;
  if (run.players.every((p) => p.special !== null)) setPhase(run, 'waveIntro');
  return [{ type: 'specialChosen', playerId, special }];
}

/**
 * Puts the current wave in place: a formation, or the boss of a boss wave (above the field, ready
 * to descend). Clears what belongs to the last wave (shots, pickups, beams, and the freeze, slow
 * and stun clocks; power-ups carry over), refills shields and combo guards, and starts the intro.
 */
function startWave(run: RunState): void {
  const def = WAVES[run.wave];
  const spawned = spawnFormation(def, () => run.nextId++);
  run.aliens = spawned.aliens;
  run.formation = spawned.formation;
  run.boss = def.boss ? createBoss(def.boss, () => run.nextId++) : null;
  run.shots = [];
  run.pickups = [];
  run.beams = [];
  run.freeze = 0;
  run.slow = 0;
  run.stun = 0;
  for (const p of run.players) {
    refillWaveGuards(p);
    p.pendingDrag = 0;
  }
  setPhase(run, 'waveIntro');
}

/**
 * Advances the run by one fixed step (`dt` seconds) and returns what happened. In the Special
 * choice, the upgrade pick and after the run ends only the phase clock runs.
 */
export function stepRun(run: RunState, inputs: readonly ShipInput[], dt: number): RunEvent[] {
  const events: RunEvent[] = [];
  // A zero step changes nothing, and would announce the wave twice.
  if (dt <= 0) return events;
  if (run.phase === 'waveIntro' && run.phaseTime === 0) events.push({ type: 'waveStart', wave: run.wave });
  run.phaseTime += dt;

  if (run.phase === 'waveIntro') {
    stepIntro(run, inputs, dt, events);
    if (run.phaseTime >= WAVE_INTRO_SECONDS) setPhase(run, 'playing');
  } else if (run.phase === 'playing') {
    stepPlaying(run, inputs, dt, events);
  }
  return events;
}

/**
 * Takes the upgrade at `run.offer[choice]` for a player (announcing any synergy it completes) and
 * sets up the next wave, whose `waveStart` event comes from the first step of its intro. Does
 * nothing outside the upgrade pick or for a choice that isn't on offer.
 */
export function pickUpgrade(run: RunState, choice: number, playerId = 0): RunEvent[] {
  const upgrade = run.offer[choice];
  const player = run.players[playerId];
  if (run.phase !== 'upgradePick' || upgrade === undefined || !player) return [];
  applyUpgrade(player, upgrade);
  const events: RunEvent[] = [{ type: 'upgradePicked', playerId, upgrade }];
  for (const synergy of unlockSynergies(player)) events.push({ type: 'synergyUnlocked', playerId, synergy });
  run.offer = [];
  run.wave++;
  startWave(run);
  return events;
}

/** The wave intro: ships can steer (but not fire), time runs, and a boss descends into view. */
function stepIntro(run: RunState, inputs: readonly ShipInput[], dt: number, events: RunEvent[]): void {
  tickRunEffects(run, dt);
  run.time += dt;
  stepShips(run, inputs, dt, false, events);
  stepBossBy(run, dt, dt, events);
}

function stepPlaying(run: RunState, inputs: readonly ShipInput[], dt: number, events: RunEvent[]): void {
  const def = WAVES[run.wave];

  // 1-2. Effects and ships, on real time.
  tickRunEffects(run, dt);
  run.time += dt;
  stepShips(run, inputs, dt, true, events);

  // 3. Specials.
  for (const p of run.players) {
    if ((inputs[p.id] ?? NO_INPUT).special) useSpecial(run, p, events);
  }

  // 4. Firing.
  fireShips(run, inputs, dt, events);

  // 5. Enemies, on scaled time. A Pulse Bomb's stun holds the formation and aliens still; the
  // boss counts its own stun down.
  const edt = dt * enemyTimeScale(run);
  const moveDt = run.stun > 0 ? 0 : edt;
  stepAliens(run, def.boss === undefined, moveDt, dt);
  stepBossBy(run, edt, dt, events);
  if (moveDt > 0 && !def.boss) {
    alienFire(run, def.fireRate, moveDt, events);
    startDives(run, def.diveRate, moveDt, events);
  }

  // 6. Shots.
  moveShots(run, dt, edt, events);

  // 7. Reflection, then enemy shots and crashing aliens against the ships.
  events.push(...reflectShots(run));
  resolveHitsOnPlayers(run, events);

  // 8. Player shots against aliens, then the boss.
  resolvePlayerShots(run, events);

  // 9. Pickups.
  stepRunPickups(run, dt, events);

  // 10. The wave ends, or the run does.
  if (run.players.every((p) => !isAlive(p))) {
    setPhase(run, 'lost');
    events.push({ type: 'lost', reason: 'lives' });
  } else if (def.boss ? run.boss !== null && bossDefeated(run.boss) : run.aliens.length === 0) {
    clearWave(run, events);
  } else if (hasInvaded(run.aliens)) {
    setPhase(run, 'lost');
    events.push({ type: 'lost', reason: 'invaded' });
  }
}

/** Movement and timers for every ship; `canFire` is false in the intro (holding fire does nothing). */
function stepShips(run: RunState, inputs: readonly ShipInput[], dt: number, canFire: boolean, events: RunEvent[]): void {
  for (const p of run.players) {
    const input = inputs[p.id] ?? NO_INPUT;
    stepPlayer(p, canFire ? input : { ...input, fire: false }, dt);
    for (const kind of tickPowerUps(p, dt)) events.push({ type: 'powerUpEnded', playerId: p.id, kind });
    tickBurst(p, dt);
    tickLaser(p, dt);
  }
}

// Specials --------------------------------------------------------------------------------------

/** Fires a ship's Special if it can, and finishes what the Special leaves to the run (see fireSpecial). */
function useSpecial(run: RunState, player: PlayerState, events: RunEvent[]): void {
  const result = fireSpecial(run, player);
  events.push(...result.events);
  // Pulse Bomb kills score and can drop pickups, but don't charge the meter or burst.
  for (const hit of result.hits) {
    if (hit.killed) killAlien(run, hit.alien, player, { charge: false, burst: false, kind: null }, events);
    else events.push({ type: 'alienHit', alienId: hit.alien.id, kind: hit.alien.kind, x: hit.alien.x, y: hit.alien.y });
  }
  removeDead(run);
  if (run.boss && result.bossDamage > 0) {
    for (const hit of damageBossFixed(run.boss, result.bossDamage)) bossPartDamaged(run, player, hit, false, events);
  }
}

// Firing ----------------------------------------------------------------------------------------

/**
 * Every ship fires: with the laser running, a beam straight up that damages what it touches in
 * place of the ship's own volley (wingmen still fire); otherwise the volley, with the spread
 * power-up's extra shots in the same volley. The helper drone fires on its own clock.
 */
function fireShips(run: RunState, inputs: readonly ShipInput[], dt: number, events: RunEvent[]): void {
  const newId = () => run.nextId++;
  if (run.beams.length > 0) run.beams = [];
  for (const p of run.players) {
    const input = inputs[p.id] ?? NO_INPUT;
    const laser = isAlive(p) && input.fire && hasPowerUp(p, 'laser');
    let fired: Shot[];
    if (laser) {
      // The laser takes the place of the ship's own shots, lance and overcharge included; only the
      // wingmen fire, on the ship's cooldown, without counting a volley.
      fired = [];
      if (p.cooldown <= 0 && p.stats.wingmen > 0) {
        p.cooldown = currentFireInterval(p);
        fired = wingmanShots(p, newId);
      }
      fireLaser(run, p, dt, events);
    } else {
      fired = tryFire(p, input, newId);
      if (fired.length > 0) fired.push(...spreadVolley(p, newId, fired[0].volley));
    }
    if (fired.length > 0) {
      run.shots.push(...fired);
      events.push({ type: 'playerFired', playerId: p.id, shots: fired.length });
    }
    run.shots.push(...helperShots(p, run.time, dt, newId));
  }
}

/** One ship's laser for this step: adds its beam and applies a damage tick to what it stops at. */
function fireLaser(run: RunState, player: PlayerState, dt: number, events: RunEvent[]): void {
  const { beam, target } = computeBeam(player, run.aliens, run.boss);
  run.beams.push(beam);
  if (!target) return;
  if (target.blocked) {
    // The shielded core stops the beam: no damage, but the shield flares, a few times a second.
    if (Math.floor(run.time / CORE_BLOCK_FLARE_SECONDS) !== Math.floor((run.time - dt) / CORE_BLOCK_FLARE_SECONDS)) {
      events.push({ type: 'coreBlocked', x: beam.x, y: beam.topY });
    }
    return;
  }
  const damage = laserDamage(player);
  if (damage <= 0) return;
  if (target.alienId !== undefined) {
    const alien = run.aliens.find((a) => a.id === target.alienId);
    if (!alien) return;
    let killed = false;
    for (let i = 0; i < damage && !killed; i++) killed = damageAlien(alien);
    if (killed) killAlien(run, alien, player, { charge: true, burst: true, kind: null }, events);
    else events.push({ type: 'alienHit', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y });
    removeDead(run);
  } else if (target.part && run.boss) {
    bossPartDamaged(run, player, damageBossPart(target.part, damage), true, events);
  }
}

// Kills -----------------------------------------------------------------------------------------

interface KillOptions {
  /** Charges the killer's Special meter. */
  charge: boolean;
  /** May burst (bomb on kill, chain reaction). A burst's own kills never do. */
  burst: boolean;
  /** The kind of shot that made the kill, or null (laser, Pulse Bomb, burst). */
  kind: ShotKind | null;
}

/**
 * Scores a kill (the alien is already at 0 hp): points at the current combo, the kill event, a
 * possible power-up drop, meter charge and burst. The caller removes the dead from `run.aliens`.
 */
function killAlien(run: RunState, alien: Alien, killer: PlayerState | null, options: KillOptions, events: RunEvent[]): void {
  const points = awardKill(run, alien);
  events.push({ type: 'alienKilled', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y, points, combo: run.combo });
  const drop = rollDrop(alien.kind, run.rng);
  if (drop) {
    const pickup = spawnPickup(drop, alien.x, alien.y, run.nextId++);
    run.pickups.push(pickup);
    events.push({ type: 'pickupSpawned', pickupId: pickup.id, kind: drop, x: pickup.x, y: pickup.y });
  }
  if (!killer) return;
  if (options.charge) events.push(...chargeSpecial(killer, killCharge(run.combo)));
  if (options.burst && killBursts(killer, options.kind, run.rng)) burstAround(run, alien, killer, events);
}

/** A kill's burst: every living alien within BURST_RADIUS takes BURST_DAMAGE. Its kills don't burst again. */
function burstAround(run: RunState, source: Alien, killer: PlayerState, events: RunEvent[]): void {
  events.push({ type: 'blast', x: source.x, y: source.y, radius: BURST_RADIUS });
  for (const alien of run.aliens) {
    if (alien.hp <= 0 || Math.hypot(alien.x - source.x, alien.y - source.y) > BURST_RADIUS) continue;
    let killed = false;
    for (let i = 0; i < BURST_DAMAGE && !killed; i++) killed = damageAlien(alien);
    if (killed) killAlien(run, alien, killer, { charge: true, burst: false, kind: null }, events);
    else events.push({ type: 'alienHit', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y });
  }
}

/**
 * Events and score for a boss part that took damage. A plate or bay that falls scores its points
 * at the current combo and, with `charge`, charges the killer's meter (not for Pulse Bomb damage).
 * The core's fall has no part event: `bossKilled` (with its points) comes when the wave ends.
 */
function bossPartDamaged(run: RunState, killer: PlayerState | null, hit: BossHit, charge: boolean, events: RunEvent[]): void {
  const boss = run.boss;
  if (!boss) return;
  const box = partBox(boss, hit.part);
  events.push({ type: 'bossPartHit', partId: hit.part.id, part: hit.part.kind, x: box.x, y: box.y });
  if (!hit.destroyed || hit.part.kind === 'core') return;
  const points = BOSS_POINTS[hit.part.kind] * run.combo;
  run.score += points;
  events.push({ type: 'bossPartDestroyed', partId: hit.part.id, part: hit.part.kind, x: box.x, y: box.y, points });
  if (charge && killer) events.push(...chargeSpecial(killer, CHARGE_PER_BOSS_PART));
}

// Enemies ---------------------------------------------------------------------------------------

/**
 * Moves the aliens by `dt` of enemy time: the formation marches (a formation wave only), formation
 * and diving aliens follow their slots and paths, launched Drones fly free and are dropped when
 * they leave the field. `realDt` keeps hit-flashes fading while the enemies are frozen.
 */
function stepAliens(run: RunState, formationWave: boolean, dt: number, realDt: number): void {
  if (dt <= 0) {
    for (const a of run.aliens) a.flash = Math.max(0, a.flash - realDt);
    return;
  }
  const def = WAVES[run.wave];
  let cols = 0;
  if (formationWave) {
    stepFormation(run.formation, run.aliens, def, dt);
    cols = waveColumns(def);
  }
  const aliens = run.aliens;
  let kept = 0;
  for (const a of aliens) {
    if (a.mode === 'free') {
      stepFreeAlien(a, nearestPlayer(run.players, a.x)?.x ?? null, dt);
      if (freeAlienGone(a)) continue;
    } else {
      stepAlien(a, slotPosition(run.formation, a.col, a.row, cols), dt);
    }
    aliens[kept++] = a;
  }
  aliens.length = kept;
}

/**
 * Steps the boss by `dt` of enemy time (it handles its own stun): launched Drones join the
 * aliens, its volleys join the shots, at the speed of the ship they're aimed at.
 */
function stepBossBy(run: RunState, dt: number, realDt: number, events: RunEvent[]): void {
  const boss = run.boss;
  if (!boss || bossDefeated(boss)) return;
  if (dt <= 0) {
    for (const part of boss.parts) part.flash = Math.max(0, part.flash - realDt);
    return;
  }
  const out = stepBoss(boss, { players: run.players, rng: run.rng, dt, newId: () => run.nextId++ });
  run.aliens.push(...out.launched);
  for (const shot of out.shots) {
    scaleEnemyShot(run, shot);
    run.shots.push(shot);
  }
  events.push(...out.events);
}

/** Scales an enemy shot's speed by the stats of the ship it's nearest to (the slow field). */
function scaleEnemyShot(run: RunState, shot: Shot): void {
  const factor = nearestPlayer(run.players, shot.x)?.stats.enemyShotSpeed ?? 1;
  shot.vx *= factor;
  shot.vy *= factor;
}

/** The formation fires now and then, from the lowest alien of a random column. Wardens aim. */
function alienFire(run: RunState, rate: number, dt: number, events: RunEvent[]): void {
  if (!rollEvent(rate, dt, run.rng)) return;
  const shooter = pickShooter(run.aliens, run.rng);
  if (!shooter) return;
  const y = shooter.y - ALIEN_SPECS[shooter.kind].halfHeight;
  let vx = 0;
  if (shooter.kind === 'warden') {
    const target = nearestPlayer(run.players, shooter.x);
    if (target) {
      const flightTime = Math.max(0.1, (y - SHIP_Y) / ALIEN_SHOT_SPEED);
      vx = Math.max(-ALIEN_SHOT_MAX_VX, Math.min(ALIEN_SHOT_MAX_VX, (target.x - shooter.x) / flightTime));
    }
  }
  const id = run.nextId++;
  const shot: Shot = {
    id,
    owner: 'alien',
    kind: 'enemy',
    playerId: null,
    x: shooter.x,
    y,
    vx,
    vy: -ALIEN_SHOT_SPEED,
    pierceLeft: 0,
    damage: 1,
    homing: 0,
    bouncesLeft: 0,
    hits: 0,
    volley: id,
  };
  scaleEnemyShot(run, shot);
  run.shots.push(shot);
  events.push({ type: 'alienFired', x: shooter.x, y });
}

/** Now and then a random diver in the formation swoops at where the nearest player is. */
function startDives(run: RunState, rate: number, dt: number, events: RunEvent[]): void {
  if (!rollEvent(rate, dt, run.rng)) return;
  const divers = run.aliens.filter((a) => a.kind === 'diver' && a.mode === 'formation');
  if (divers.length === 0) return;
  const diver = run.rng.pick(divers);
  const target = nearestPlayer(run.players, diver.x);
  startDive(diver, target ? target.x : diver.x);
  events.push({ type: 'diveStart', alienId: diver.id });
}

// Shots -----------------------------------------------------------------------------------------

// Scratch space reused every step, so a step that needs none of it allocates nothing. The sim is
// synchronous and none of these outlive the function that fills them.
const homingScratch: Target[] = [];
const bossTargetPool: Target[] = [];
const idScratch = new Set<number>();
const missedScratch = new Map<number, number | null>();
const NO_TARGETS: readonly Target[] = [];

/** What homing shots steer at: the living aliens and the standing parts of a boss that has landed. */
function homingTargets(run: RunState): readonly Target[] {
  const targets = homingScratch;
  targets.length = 0;
  for (const a of run.aliens) if (a.hp > 0) targets.push(a);
  const boss = run.boss;
  if (boss && !bossEntering(boss)) {
    let n = 0;
    for (const part of boss.parts) {
      if (part.hp <= 0) continue;
      const t = (bossTargetPool[n] ??= { x: 0, y: 0 });
      n++;
      t.x = boss.x + part.dx;
      t.y = boss.y + part.dy;
      targets.push(t);
    }
  }
  return targets;
}

/** Drops the dead (0 hp) from `run.aliens`; does nothing, and allocates nothing, if none died. */
function removeDead(run: RunState): void {
  if (run.aliens.some((a) => a.hp <= 0)) run.aliens = run.aliens.filter((a) => a.hp > 0);
}

/** Removes the shots whose ids are in `idScratch` and clears it. */
function removeSpentShots(run: RunState): void {
  if (idScratch.size > 0) {
    run.shots = run.shots.filter((s) => !idScratch.has(s.id));
    idScratch.clear();
  }
}

/**
 * Flies every shot (the ships' on real time, the enemies' on enemy time) and drops the ones that
 * left the field: the top, bottom or sides for a player's shot, the bottom or sides for an
 * enemy's. A volley counts as a miss, and breaks the combo (or uses a combo guard), only once its
 * last shot has left without any of them hitting something, and only once however many left.
 */
function moveShots(run: RunState, dt: number, enemyDt: number, events: RunEvent[]): void {
  let homing = false;
  for (const s of run.shots) if (s.owner === 'player' && s.homing > 0) homing = true;
  const targets = homing ? homingTargets(run) : NO_TARGETS;
  const shots = run.shots;
  const missed = missedScratch;
  let kept = 0;
  for (const s of shots) {
    if (s.owner === 'player') {
      const owner = s.playerId === null ? undefined : run.players[s.playerId];
      stepShot(s, targets, dt, owner !== undefined && hasSynergy(owner, 'seekers'));
      const gone =
        s.y - SHOT_HALF_HEIGHT > FIELD_HEIGHT / 2 ||
        s.y + SHOT_HALF_HEIGHT < -FIELD_HEIGHT / 2 ||
        Math.abs(s.x) > FIELD_WIDTH / 2 + SHOT_SIDE_MARGIN;
      if (gone) {
        if (s.volley !== VOLLEY_HIT) missed.set(s.volley, s.playerId);
        continue;
      }
    } else {
      if (enemyDt > 0) stepShot(s, NO_TARGETS, enemyDt);
      if (s.y + SHOT_HALF_HEIGHT < -FIELD_HEIGHT / 2 || Math.abs(s.x) > FIELD_WIDTH / 2 + 10) continue;
    }
    shots[kept++] = s;
  }
  shots.length = kept;
  if (missed.size === 0) return;
  for (const [volley, playerId] of missed) {
    if (shots.some((k) => k.volley === volley)) continue;
    events.push(...registerMiss(run, playerId === null ? undefined : run.players[playerId]));
  }
  missed.clear();
}

/** The first living ship whose box overlaps `box` (and, if `vulnerable`, isn't in its safe moment), or null. */
function shipTouching(run: RunState, box: Box, vulnerable: boolean): PlayerState | null {
  for (const p of run.players) {
    if (isAlive(p) && (!vulnerable || p.invulnerable <= 0) && overlaps(box, shipBox(p))) return p;
  }
  return null;
}

/** Alien shots and crashing aliens (divers, and Drones the boss launched) against the ships. */
function resolveHitsOnPlayers(run: RunState, events: RunEvent[]): void {
  for (const shot of run.shots) {
    if (shot.owner !== 'alien') continue;
    const victim = shipTouching(run, shotBox(shot), false);
    if (!victim) continue;
    idScratch.add(shot.id);
    damagePlayer(victim, events);
  }
  removeSpentShots(run);

  for (const alien of run.aliens) {
    if (alien.mode !== 'diving' && alien.mode !== 'free') continue;
    const victim = shipTouching(run, alienBox(alien), true);
    if (!victim) continue;
    idScratch.add(alien.id);
    events.push({ type: 'alienKilled', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y, points: 0, combo: run.combo });
    damagePlayer(victim, events);
  }
  if (idScratch.size > 0) {
    run.aliens = run.aliens.filter((a) => !idScratch.has(a.id));
    idScratch.clear();
  }
}

function damagePlayer(player: PlayerState, events: RunEvent[]): void {
  const result = hitPlayer(player);
  if (result === 'shield') events.push({ type: 'shieldHit', playerId: player.id });
  else if (result === 'life') events.push({ type: 'playerHit', playerId: player.id, livesLeft: player.lives });
}

/**
 * A counted volley's shot has landed: the combo rises once for the whole volley (only if
 * `raiseCombo`), and the volley's other shots can no longer count as a miss.
 */
function landVolley(run: RunState, shot: Shot, raiseCombo: boolean): void {
  const volley = shot.volley;
  if (volley === VOLLEY_HIT) return;
  if (raiseCombo) registerShotHit(run);
  for (const s of run.shots) if (s.volley === volley) s.volley = VOLLEY_HIT;
}

/**
 * Player shots against aliens, then against the boss: hits, kills, combo and points. A piercing
 * shot carries on past what it hit; any other is spent. A shot the boss's shielded core stops is
 * spent without damage (a `coreBlocked` event lets the shield flare). Dead aliens are removed.
 */
function resolvePlayerShots(run: RunState, events: RunEvent[]): void {
  for (const shot of run.shots) {
    if (shot.owner !== 'player') continue;
    const alien = firstAlienHit(shot, run.aliens);
    if (alien) {
      hitAlien(run, shot, alien, events);
      if (shot.pierceLeft > 0) {
        // Move the shot just past the alien so it can't hit the same one again next step.
        shot.pierceLeft--;
        shot.y = alien.y + ALIEN_SPECS[alien.kind].halfHeight + SHOT_HALF_HEIGHT;
      } else {
        idScratch.add(shot.id);
      }
      continue;
    }

    const boss = run.boss;
    const hit = boss ? hitBoss(boss, shotBox(shot), shot.damage) : null;
    if (!boss || !hit) continue;
    shot.hits++;
    if (hit.blocked) {
      // Stopped by the armour: not a miss, but nothing to reward either.
      events.push({ type: 'coreBlocked', x: shot.x, y: shot.y });
      landVolley(run, shot, false);
      idScratch.add(shot.id);
      continue;
    }
    const player = shot.playerId === null ? null : (run.players[shot.playerId] ?? null);
    bossPartDamaged(run, player, hit, true, events);
    landVolley(run, shot, true);
    if (shot.pierceLeft > 0) {
      const box = partBox(boss, hit.part);
      shot.pierceLeft--;
      shot.y = box.y + box.halfHeight + SHOT_HALF_HEIGHT;
    } else {
      idScratch.add(shot.id);
    }
  }
  removeSpentShots(run);
  removeDead(run);
}

function hitAlien(run: RunState, shot: Shot, alien: Alien, events: RunEvent[]): void {
  const killer = shot.playerId === null ? null : (run.players[shot.playerId] ?? null);
  shot.hits++;
  // Points count at the combo before this hit raises it, so the first kill in a chain is x1.
  if (damageAlien(alien)) killAlien(run, alien, killer, { charge: true, burst: true, kind: shot.kind }, events);
  else events.push({ type: 'alienHit', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y });
  landVolley(run, shot, true);
}

// Pickups and the wave's end --------------------------------------------------------------------

function stepRunPickups(run: RunState, dt: number, events: RunEvent[]): void {
  if (run.pickups.length === 0) return;
  const { kept, collected } = stepPickups(run.pickups, run.players, dt);
  run.pickups = kept;
  for (const { playerId, pickup } of collected) collectPickup(run, run.players[playerId], pickup, events);
}

/** A ship catches a pickup: its power-up starts (and any run-wide part of it), with a `pickupCollected` event. */
function collectPickup(run: RunState, player: PlayerState, pickup: Pickup, events: RunEvent[]): void {
  activatePowerUp(player, pickup.kind);
  applyRunEffect(run, pickup.kind);
  events.push({ type: 'pickupCollected', playerId: player.id, pickupId: pickup.id, kind: pickup.kind });
}

/**
 * The wave is over (the last alien is gone, or the boss's core): end the run with a win after
 * the final wave, otherwise offer upgrades, with a rare guaranteed after a boss.
 */
function clearWave(run: RunState, events: RunEvent[]): void {
  const bossWave = WAVES[run.wave].boss !== undefined;
  if (run.boss && bossWave) {
    events.push({ type: 'bossKilled', kind: run.boss.kind, x: run.boss.x, y: run.boss.y, points: BOSS_POINTS.core });
    run.score += BOSS_POINTS.core;
  }
  // Free Drones don't outlive their boss.
  run.aliens = run.aliens.filter((a) => a.mode !== 'free');
  // Pickups still falling (a last kill's drop) go to the nearest living ship rather than vanish.
  for (const pickup of run.pickups) {
    const catcher = nearestPlayer(run.players, pickup.x);
    if (catcher) collectPickup(run, catcher, pickup, events);
  }
  run.shots = [];
  run.pickups = [];
  run.beams = [];
  events.push({ type: 'waveClear', wave: run.wave });
  if (run.wave >= WAVE_COUNT - 1) {
    setPhase(run, 'won');
    events.push({ type: 'won' });
    return;
  }
  run.offer = offerUpgrades(run.rng, run.players[0], OFFER_SIZE, { guaranteeRare: bossWave });
  setPhase(run, 'upgradePick');
}
