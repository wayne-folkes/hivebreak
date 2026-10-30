import { ALIEN_SPECS, alienBox, damageAlien, startDive, stepAlien } from './aliens';
import { firstAlienHit, overlaps, shotBox, SHOT_HALF_HEIGHT } from './collision';
import { hasInvaded, pickShooter, rollEvent, slotPosition, spawnFormation, stepFormation } from './formation';
import { FIELD_HEIGHT, FIELD_WIDTH } from './playfield';
import { createPlayer, hitPlayer, isAlive, nearestPlayer, shipBox, SHIP_Y, stepPlayer, tryFire } from './player';
import { createRng } from './rng';
import { VOLLEY_HIT, awardKill, registerMiss, registerShotHit } from './scoring';
import type { PlayerState, RunEvent, RunPhase, RunState, ShipInput, Shot } from './types';
import { NO_INPUT } from './types';
import { applyUpgrade, offerUpgrades } from './upgrades';
import { WAVE_COUNT, WAVES, waveColumns } from './waves';

// A whole run: the phases from wave intro to win or loss, and the fixed simulation step that
// ties the player, formation, aliens, collisions and scoring together. Pure and deterministic:
// the same seed and the same inputs always play out the same way.

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

/** Starts a run at wave 0, in the intro. */
export function createRun(seed: number, playerCount = 1): RunState {
  const players = Array.from({ length: playerCount }, (_, i) =>
    createPlayer(i, (i - (playerCount - 1) / 2) * PLAYER_START_SPACING),
  );
  const run: RunState = {
    phase: 'waveIntro',
    phaseTime: 0,
    wave: 0,
    players,
    aliens: [],
    shots: [],
    pickups: [],
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
  return run;
}

function setPhase(run: RunState, phase: RunPhase): void {
  run.phase = phase;
  run.phaseTime = 0;
}

/** Puts the current wave's formation in place, refills shields and starts the intro. */
function startWave(run: RunState): void {
  const spawned = spawnFormation(WAVES[run.wave], () => run.nextId++);
  run.aliens = spawned.aliens;
  run.formation = spawned.formation;
  run.shots = [];
  for (const p of run.players) {
    p.shield = p.stats.shieldPerWave;
    p.pendingDrag = 0;
  }
  setPhase(run, 'waveIntro');
}

/**
 * Advances the run by one fixed step (`dt` seconds) and returns what happened. In the upgrade
 * pick and after the run ends only the phase clock runs.
 */
export function stepRun(run: RunState, inputs: readonly ShipInput[], dt: number): RunEvent[] {
  const events: RunEvent[] = [];
  // A zero step changes nothing, and would announce the wave twice.
  if (dt <= 0) return events;
  if (run.phase === 'waveIntro' && run.phaseTime === 0) events.push({ type: 'waveStart', wave: run.wave });
  run.phaseTime += dt;

  if (run.phase === 'waveIntro') {
    for (const p of run.players) stepPlayer(p, { ...(inputs[p.id] ?? NO_INPUT), fire: false }, dt);
    if (run.phaseTime >= WAVE_INTRO_SECONDS) setPhase(run, 'playing');
  } else if (run.phase === 'playing') {
    stepPlaying(run, inputs, dt, events);
  }
  return events;
}

/**
 * Takes the upgrade at `run.offer[choice]` for a player and sets up the next wave, whose
 * `waveStart` event comes from the first step of its intro. Does nothing outside the upgrade
 * pick or for a choice that isn't on offer.
 */
export function pickUpgrade(run: RunState, choice: number, playerId = 0): RunEvent[] {
  const upgrade = run.offer[choice];
  const player = run.players[playerId];
  if (run.phase !== 'upgradePick' || upgrade === undefined || !player) return [];
  applyUpgrade(player, upgrade);
  run.offer = [];
  run.wave++;
  startWave(run);
  return [{ type: 'upgradePicked', playerId, upgrade }];
}

function stepPlaying(run: RunState, inputs: readonly ShipInput[], dt: number, events: RunEvent[]): void {
  const def = WAVES[run.wave];

  for (const p of run.players) {
    const input = inputs[p.id] ?? NO_INPUT;
    stepPlayer(p, input, dt);
    const fired = tryFire(p, input, () => run.nextId++);
    if (fired.length > 0) {
      run.shots.push(...fired);
      events.push({ type: 'playerFired', playerId: p.id, shots: fired.length });
    }
  }

  moveShots(run, dt, events);

  stepFormation(run.formation, run.aliens, def, dt);
  const cols = waveColumns(def);
  for (const a of run.aliens) stepAlien(a, slotPosition(run.formation, a.col, a.row, cols), dt);

  alienFire(run, def.fireRate, dt, events);
  startDives(run, def.diveRate, dt, events);

  resolvePlayerShots(run, events);
  if (run.aliens.length === 0) {
    clearWave(run, events);
    return;
  }

  resolveHitsOnPlayers(run, events);
  if (run.players.every((p) => !isAlive(p))) {
    setPhase(run, 'lost');
    events.push({ type: 'lost', reason: 'lives' });
  } else if (hasInvaded(run.aliens)) {
    setPhase(run, 'lost');
    events.push({ type: 'lost', reason: 'invaded' });
  }
}

/**
 * Flies every shot and drops the ones that left the field. A volley counts as a miss, and
 * breaks the combo, only once its last shot has left without any of them hitting something.
 */
function moveShots(run: RunState, dt: number, events: RunEvent[]): void {
  const kept: Shot[] = [];
  const missed: Shot[] = [];
  for (const s of run.shots) {
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.owner === 'player') {
      if (s.y - SHOT_HALF_HEIGHT > FIELD_HEIGHT / 2) {
        if (s.hits === 0) missed.push(s);
        continue;
      }
    } else if (s.y + SHOT_HALF_HEIGHT < -FIELD_HEIGHT / 2 || Math.abs(s.x) > FIELD_WIDTH / 2 + 10) {
      continue;
    }
    kept.push(s);
  }
  run.shots = kept;
  // Shots of one volley can leave in the same step; it still counts as one miss.
  const missedVolleys = new Set(missed.map((s) => s.volley));
  for (const volley of missedVolleys) {
    if (volley !== VOLLEY_HIT && !kept.some((k) => k.volley === volley)) events.push(...registerMiss(run));
  }
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
  run.shots.push({
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
  });
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

/** Player shots against aliens: hits, kills, combo and points. Spent shots and dead aliens are removed. */
function resolvePlayerShots(run: RunState, events: RunEvent[]): void {
  const spent = new Set<number>();
  for (const shot of run.shots) {
    if (shot.owner !== 'player') continue;
    const alien = firstAlienHit(shot, run.aliens);
    if (!alien) continue;

    // Points count at the combo before this hit raises it, so the first kill in a chain is x1.
    const firstHit = shot.hits === 0;
    shot.hits++;
    if (damageAlien(alien)) {
      const points = awardKill(run, alien);
      events.push({ type: 'alienKilled', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y, points, combo: run.combo });
    } else {
      events.push({ type: 'alienHit', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y });
    }
    if (firstHit) registerShotHit(run);
    // The volley has landed a hit, so its other shots can no longer count as a miss.
    const volley = shot.volley;
    for (const s of run.shots) if (s.volley === volley) s.volley = VOLLEY_HIT;

    if (shot.pierceLeft > 0) {
      // Move the shot just past the alien so it can't hit the same one again next step.
      shot.pierceLeft--;
      shot.y = alien.y + ALIEN_SPECS[alien.kind].halfHeight + SHOT_HALF_HEIGHT;
    } else {
      spent.add(shot.id);
    }
  }
  if (spent.size > 0) run.shots = run.shots.filter((s) => !spent.has(s.id));
  run.aliens = run.aliens.filter((a) => a.hp > 0);
}

/** Alien shots and diving aliens against the ships. */
function resolveHitsOnPlayers(run: RunState, events: RunEvent[]): void {
  const spent = new Set<number>();
  for (const shot of run.shots) {
    if (shot.owner !== 'alien') continue;
    const box = shotBox(shot);
    const victim = run.players.find((p) => isAlive(p) && overlaps(box, shipBox(p)));
    if (!victim) continue;
    spent.add(shot.id);
    damagePlayer(victim, events);
  }
  if (spent.size > 0) run.shots = run.shots.filter((s) => !spent.has(s.id));

  const crashed = new Set<number>();
  for (const alien of run.aliens) {
    if (alien.mode !== 'diving') continue;
    const box = alienBox(alien);
    const victim = run.players.find((p) => isAlive(p) && p.invulnerable <= 0 && overlaps(box, shipBox(p)));
    if (!victim) continue;
    crashed.add(alien.id);
    events.push({ type: 'alienKilled', alienId: alien.id, kind: alien.kind, x: alien.x, y: alien.y, points: 0, combo: run.combo });
    damagePlayer(victim, events);
  }
  if (crashed.size > 0) run.aliens = run.aliens.filter((a) => !crashed.has(a.id));
}

function damagePlayer(player: PlayerState, events: RunEvent[]): void {
  const result = hitPlayer(player);
  if (result === 'shield') events.push({ type: 'shieldHit', playerId: player.id });
  else if (result === 'life') events.push({ type: 'playerHit', playerId: player.id, livesLeft: player.lives });
}

/** The last alien is gone: end the wave with a win after the final one, otherwise offer upgrades. */
function clearWave(run: RunState, events: RunEvent[]): void {
  run.shots = [];
  events.push({ type: 'waveClear', wave: run.wave });
  if (run.wave >= WAVE_COUNT - 1) {
    setPhase(run, 'won');
    events.push({ type: 'won' });
    return;
  }
  run.offer = offerUpgrades(run.rng, run.players[0], OFFER_SIZE);
  setPhase(run, 'upgradePick');
}
