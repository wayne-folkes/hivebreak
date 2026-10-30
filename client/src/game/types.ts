import type { Rng } from './rng';

// The shapes the simulation, input, rendering and UI all share. The simulation works in art
// pixels with the origin at the centre of the playfield and y pointing up, so the renderer can
// use these coordinates as world units directly:
//
//   x from -FIELD_WIDTH / 2 (left) to FIELD_WIDTH / 2 (right)
//   y from -FIELD_HEIGHT / 2 (bottom) to FIELD_HEIGHT / 2 (top)
//
// Everything here is plain data, so a run can be inspected, cloned or replayed in tests.

/** What one player asks their ship to do during a simulation step. */
export interface ShipInput {
  /** Steering from a stick or keys, -1 (full left) to 1 (full right). Moves at the ship's speed. */
  move: number;
  /**
   * Art pixels to shift the ship sideways, from a touch drag. Added to the ship's pending drag,
   * which the sim plays out over the next steps at a capped speed. The game loop reads input
   * once per frame (reading drains the touch drag), adds the drag to a carry, and passes the
   * carry to the next sim step that runs, then zeroes it, so frames with no sim step lose nothing.
   */
  drag: number;
  /** Fire is held. The ship fires whenever its cooldown allows. */
  fire: boolean;
  /**
   * The Special button was pressed. Like drag, the game loop carries a press to the next sim step
   * that runs and then clears it, so one press fires the Special at most once.
   */
  special: boolean;
}

export const NO_INPUT: ShipInput = { move: 0, drag: 0, fire: false, special: false };

/** An axis-aligned box: centre and half sizes, in art pixels. */
export interface Box {
  x: number;
  y: number;
  halfWidth: number;
  halfHeight: number;
}

/** A ship's numbers, which upgrades change. */
export interface PlayerStats {
  /** Top sideways speed, art pixels per second. */
  speed: number;
  /** Seconds between volleys while fire is held. */
  fireInterval: number;
  /** Upward speed of the ship's shots, art pixels per second. */
  shotSpeed: number;
  /** Shots per volley, fanned out from the nose. */
  shotsPerVolley: number;
  /** Angle between neighbouring shots of a volley, radians (0 = side by side, straight up). */
  spreadAngle: number;
  /** Aliens each shot can pass through after the first. */
  pierce: number;
  /** Damage each shot does (1 = one hit point). */
  damage: number;
  /** How hard shots steer toward the nearest alien, radians per second (0 = straight). */
  homing: number;
  /** Times a shot bounces off the side walls. */
  ricochet: number;
  /** Hits absorbed each wave before a life is lost. Refilled at the start of every wave. */
  shieldPerWave: number;
  /** Misses forgiven each wave before one breaks the combo. Refilled at the start of every wave. */
  comboGuard: number;
  /** Pickups within this distance drift to the ship, art pixels (0 = off). */
  magnetRadius: number;
  /** Chance a kill bursts and damages the aliens around it, 0 to 1. */
  bombOnKill: number;
  /** Every Nth volley adds one big piercing shot (0 = off). */
  overchargeEvery: number;
  /** Wingmen flying beside the ship and firing with it. */
  wingmen: number;
  /** Multiplier on enemy shot speed (1 = normal; the slow field lowers it). */
  enemyShotSpeed: number;
}

/** Short, strong, timed boosts that fall as pickups. */
export type PowerUpKind = 'spread' | 'laser' | 'slow' | 'helper';

/** A power-up a ship has running. */
export interface ActivePowerUp {
  kind: PowerUpKind;
  /** Seconds left. */
  timeLeft: number;
}

/** A power-up falling down the field, waiting to be caught. */
export interface Pickup {
  id: number;
  kind: PowerUpKind;
  x: number;
  y: number;
}

/** The Special a player chose for this run. */
export type SpecialId = 'pulseBomb' | 'shieldBurst' | 'timeStop';

export interface PlayerState {
  /** Index in RunState.players. */
  id: number;
  x: number;
  /** Sideways velocity, art pixels per second (for banking the model). */
  vx: number;
  /** Touch drag still to play out, art pixels. */
  pendingDrag: number;
  lives: number;
  /** Seconds until the ship can fire again. */
  cooldown: number;
  /** Seconds of safety left after a hit. */
  invulnerable: number;
  /** Shield hits left this wave. */
  shield: number;
  /** Combo-breaking misses still forgiven this wave. */
  comboGuardLeft: number;
  /** Volleys fired this run, for the overcharge count. */
  volleys: number;
  stats: PlayerStats;
  /** Upgrades taken this run, in the order picked. */
  upgrades: UpgradeId[];
  /** Synergies unlocked this run, in the order unlocked. */
  synergies: SynergyId[];
  /** Power-ups running now; at most one of each kind (catching another refreshes it). */
  powerUps: ActivePowerUp[];
  /** The Special chosen for this run, or null before the choice. */
  special: SpecialId | null;
  /** Special meter, 0 to 1. The Special can fire at 1. */
  specialCharge: number;
  /** Seconds left of a Shield Burst: untouchable, and enemy shots that hit the ship bounce back. */
  burst: number;
  /** Seconds until the laser's next damage tick (the laser has its own timer, apart from `cooldown`). */
  laserTimer: number;
  /** Bulwark synergy: seconds until a used shield hit comes back (absent or 0 = none pending). */
  shieldRegen?: number;
  /** Bulwark synergy: true once this wave's regeneration has been used. Cleared at wave start. */
  bulwarkUsed?: boolean;
}

/**
 * What fired a shot. 'normal' covers the ship, wingmen and the helper drone; 'overcharge' is the
 * big piercing shot; 'lance' is the Lance synergy's piercing bolt; 'enemy' is any alien or boss
 * shot; 'reflected' is an enemy shot a Shield Burst sent back up.
 */
export type ShotKind = 'normal' | 'overcharge' | 'lance' | 'enemy' | 'reflected';

export type ShotOwner = 'player' | 'alien';

/**
 * The volley id of a shot that can no longer count as a miss: its volley has already hit
 * something, or it's an extra shot (lance, overcharge, wingman, helper) that never counts.
 */
export const VOLLEY_HIT = -1;

export interface Shot {
  id: number;
  owner: ShotOwner;
  kind: ShotKind;
  /** For a player's shot: whose it is. */
  playerId: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Aliens this shot can still pass through. */
  pierceLeft: number;
  /** Damage on hit. */
  damage: number;
  /** Steering toward the nearest alien, radians per second (0 = straight). */
  homing: number;
  /** Wall bounces left. */
  bouncesLeft: number;
  /** Aliens this shot has hit. */
  hits: number;
  /** Wall bounces so far (absent = none), so the Seekers synergy boosts a shot only once. */
  bounces?: number;
  /**
   * The volley this shot was fired in (shots fired together share it). A volley is a miss, and
   * breaks the combo, only when every shot in it has left the field with 0 hits.
   */
  volley: number;
}

/**
 * A ship's laser while the laser power-up runs: a beam straight up from the nose to the first
 * thing it touches, doing damage over time. Recomputed every step.
 */
export interface Beam {
  playerId: number;
  x: number;
  /** Where the beam stops: the bottom of what it hit, or the top of the field. */
  topY: number;
}

export type AlienKind = 'drone' | 'warden' | 'diver' | 'carrier';

/**
 * Where an alien is: in its formation slot, swooping at the player, flying back to its slot, or
 * (for a Drone launched by a boss) flying free toward the player's row.
 */
export type AlienMode = 'formation' | 'diving' | 'returning' | 'free';

/** The curve a diving alien follows: where it left the formation and the x it swoops towards. */
export interface DivePath {
  fromX: number;
  fromY: number;
  toX: number;
}

export interface Alien {
  id: number;
  kind: AlienKind;
  hp: number;
  /** The alien's slot in the formation grid (-1 for a free alien with no slot). */
  col: number;
  row: number;
  x: number;
  y: number;
  mode: AlienMode;
  /** Seconds into the current dive or return, for following its path. */
  modeTime: number;
  /** Seconds left of the white hit-flash, for the renderer. */
  flash: number;
  /** The path of the current dive. Only set while `mode` is `diving`. */
  dive?: DivePath;
  /** Velocity of a free alien, art pixels per second. */
  vx?: number;
  vy?: number;
}

export interface FormationState {
  /** Offset of the whole formation from its starting position, art pixels. */
  offsetX: number;
  offsetY: number;
  /** Marching direction: 1 right, -1 left. */
  dir: 1 | -1;
  /** Aliens alive at the start of the wave, for speeding up as it thins. */
  startCount: number;
}

export type BossKind = 'broodMother';

/** The pieces of a boss you can shoot. Plates shield the core; bays launch Drones. */
export type BossPartKind = 'plate' | 'bay' | 'core';

export interface BossPart {
  id: number;
  kind: BossPartKind;
  /** Hit points left; 0 means destroyed (it stays in the list so the renderer can show the wreck). */
  hp: number;
  maxHp: number;
  /** Centre relative to the boss's centre, art pixels. */
  dx: number;
  dy: number;
  halfWidth: number;
  halfHeight: number;
  /** Seconds left of the white hit-flash. */
  flash: number;
}

export interface BossState {
  kind: BossKind;
  /** Centre of the boss. */
  x: number;
  y: number;
  vx: number;
  /** 1-based phase; changes are announced with a bossPhase event. */
  phase: number;
  /** Seconds into the current phase. */
  phaseTime: number;
  parts: BossPart[];
  /** Seconds until the next Drone launch and the next volley. */
  launchTimer: number;
  fireTimer: number;
  /** Seconds the boss is stunned (a Pulse Bomb); it neither moves nor fires. */
  stun: number;
}

/**
 * One wave, as data. Each string in `rows` is one row of the formation, top row first, one
 * character per column: 'w' warden, 'd' drone, 'v' diver, 'c' carrier, '.' empty slot. A boss
 * wave sets `boss` and usually has no rows.
 */
export interface WaveDef {
  rows: readonly string[];
  /** Sideways marching speed with the full formation, art pixels per second. */
  marchSpeed: number;
  /** Formation shots per second across the whole formation. */
  fireRate: number;
  /** Dives started per second across the formation's divers. */
  diveRate: number;
  boss?: BossKind;
}

export type UpgradeId =
  | 'twinShot'
  | 'rapidFire'
  | 'piercing'
  | 'extraLife'
  | 'shieldPulse'
  | 'thrusters'
  | 'homing'
  | 'ricochet'
  | 'comboGuard'
  | 'magnet'
  | 'bombOnKill'
  | 'overcharge'
  | 'wingman'
  | 'slowField'
  | 'doubleTap';

export type Rarity = 'common' | 'uncommon' | 'rare';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** One short sentence for the pick card. */
  description: string;
  rarity: Rarity;
  /** How many times one run can take it. */
  maxStacks: number;
}

/** Stronger forms unlocked by holding a pair of upgrades. */
export type SynergyId = 'lance' | 'afterburner' | 'bulwark' | 'seekers' | 'chainReaction';

export interface SynergyDef {
  id: SynergyId;
  name: string;
  /** One short sentence for the pick card and the unlock toast. */
  description: string;
  /** Holding at least one of each unlocks it. */
  needs: readonly [UpgradeId, UpgradeId];
}

/**
 * - `chooseSpecial`: before wave 1, waiting for the player to pick a Special for the run.
 * - `waveIntro`: a short pause with the wave's banner before aliens move.
 * - `playing`: the wave is on.
 * - `upgradePick`: the wave is clear and the run waits for the player to pick an upgrade.
 * - `won`: the last wave is clear. `lost`: out of lives, or the formation reached the ship's row.
 */
export type RunPhase = 'chooseSpecial' | 'waveIntro' | 'playing' | 'upgradePick' | 'won' | 'lost';

export interface RunState {
  phase: RunPhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /**
   * Seconds of play since the run began: counts during wave intros and play, never resets. For
   * anything that needs a steady clock across phases, like the helper drone's orbit.
   */
  time: number;
  /** Index into the wave list. */
  wave: number;
  players: PlayerState[];
  aliens: Alien[];
  shots: Shot[];
  /** Power-ups falling down the field. */
  pickups: Pickup[];
  /** Lasers firing this step (one per ship with the laser power-up and fire held). */
  beams: Beam[];
  /** The boss of a boss wave, or null. */
  boss: BossState | null;
  formation: FormationState;
  /** Seconds left of Time Stop: aliens, the boss and enemy shots are frozen. */
  freeze: number;
  /** Seconds left of the slow power-up: aliens, the boss and enemy shots run at half speed. */
  slow: number;
  /** Seconds the formation is stunned by a Pulse Bomb: it neither moves nor fires. */
  stun: number;
  score: number;
  /** Current combo multiplier, 1 to 8. */
  combo: number;
  /** Highest combo reached this run. */
  bestCombo: number;
  /** The three upgrades on offer while phase is `upgradePick`, otherwise empty. */
  offer: UpgradeId[];
  rng: Rng;
  /** The next id to hand out to a shot, alien, pickup or boss part. */
  nextId: number;
}

/** Things that happened during a step, for sound, effects, rumble and the HUD to react to. */
export type RunEvent =
  | { type: 'specialChosen'; playerId: number; special: SpecialId }
  | { type: 'waveStart'; wave: number }
  | { type: 'playerFired'; playerId: number; shots: number }
  | { type: 'alienFired'; x: number; y: number }
  | { type: 'alienHit'; alienId: number; kind: AlienKind; x: number; y: number }
  | { type: 'alienKilled'; alienId: number; kind: AlienKind; x: number; y: number; points: number; combo: number }
  | { type: 'diveStart'; alienId: number }
  | { type: 'comboBroken'; combo: number }
  | { type: 'comboGuarded'; playerId: number }
  | { type: 'shieldHit'; playerId: number }
  | { type: 'playerHit'; playerId: number; livesLeft: number }
  | { type: 'blast'; x: number; y: number; radius: number }
  | { type: 'pickupSpawned'; pickupId: number; kind: PowerUpKind; x: number; y: number }
  | { type: 'pickupCollected'; playerId: number; pickupId: number; kind: PowerUpKind }
  | { type: 'powerUpEnded'; playerId: number; kind: PowerUpKind }
  | { type: 'specialReady'; playerId: number }
  | { type: 'specialFired'; playerId: number; special: SpecialId; x: number; y: number }
  | { type: 'shotReflected'; x: number; y: number }
  | { type: 'bossLaunched'; alienId: number }
  | { type: 'bossFired'; x: number; y: number }
  | { type: 'bossPartHit'; partId: number; part: BossPartKind; x: number; y: number }
  | { type: 'bossPartDestroyed'; partId: number; part: BossPartKind; x: number; y: number; points: number }
  | { type: 'bossPhase'; phase: number }
  | { type: 'bossKilled'; kind: BossKind; x: number; y: number; points: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'upgradePicked'; playerId: number; upgrade: UpgradeId }
  | { type: 'synergyUnlocked'; playerId: number; synergy: SynergyId }
  | { type: 'won' }
  | { type: 'lost'; reason: 'lives' | 'invaded' };
