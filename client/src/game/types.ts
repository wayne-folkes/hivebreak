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
}

export const NO_INPUT: ShipInput = { move: 0, drag: 0, fire: false };

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
  /** Shots per volley, spread side by side. */
  shotsPerVolley: number;
  /** Aliens each shot can pass through after the first. */
  pierce: number;
  /** Hits absorbed each wave before a life is lost. Refilled at the start of every wave. */
  shieldPerWave: number;
}

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
  stats: PlayerStats;
  /** Upgrades taken this run, in the order picked. */
  upgrades: UpgradeId[];
}

export type ShotOwner = 'player' | 'alien';

export interface Shot {
  id: number;
  owner: ShotOwner;
  /** For a player's shot: whose it is. */
  playerId: number | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Aliens this shot can still pass through. */
  pierceLeft: number;
  /** Aliens this shot has hit. */
  hits: number;
  /**
   * The volley this shot was fired in (shots fired together share it). A volley is a miss, and
   * breaks the combo, only when every shot in it has left the field with 0 hits.
   */
  volley: number;
}

export type AlienKind = 'drone' | 'warden' | 'diver';

/**
 * Where an alien is: in its formation slot, swooping at the player, or flying back to its slot.
 * Only divers leave the formation.
 */
export type AlienMode = 'formation' | 'diving' | 'returning';

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
  /** The alien's slot in the formation grid. */
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

/**
 * One wave, as data. Each string in `rows` is one row of the formation, top row first, one
 * character per column: 'w' warden, 'd' drone, 'v' diver, '.' empty slot.
 */
export interface WaveDef {
  rows: readonly string[];
  /** Sideways marching speed with the full formation, art pixels per second. */
  marchSpeed: number;
  /** Formation shots per second across the whole formation. */
  fireRate: number;
  /** Dives started per second across the formation's divers. */
  diveRate: number;
}

export type UpgradeId = 'twinShot' | 'rapidFire' | 'piercing' | 'extraLife' | 'shieldPulse' | 'thrusters';

export type Rarity = 'common' | 'uncommon';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** One short sentence for the pick card. */
  description: string;
  rarity: Rarity;
  /** How many times one run can take it. */
  maxStacks: number;
}

/**
 * - `waveIntro`: a short pause with the wave's banner before aliens move.
 * - `playing`: the wave is on.
 * - `upgradePick`: the wave is clear and the run waits for the player to pick an upgrade.
 * - `won`: the last wave is clear. `lost`: out of lives, or the formation reached the ship's row.
 */
export type RunPhase = 'waveIntro' | 'playing' | 'upgradePick' | 'won' | 'lost';

export interface RunState {
  phase: RunPhase;
  /** Seconds spent in the current phase. */
  phaseTime: number;
  /** Index into the wave list. */
  wave: number;
  players: PlayerState[];
  aliens: Alien[];
  shots: Shot[];
  formation: FormationState;
  score: number;
  /** Current combo multiplier, 1 to 8. */
  combo: number;
  /** Highest combo reached this run. */
  bestCombo: number;
  /** The three upgrades on offer while phase is `upgradePick`, otherwise empty. */
  offer: UpgradeId[];
  rng: Rng;
  /** The next id to hand out to a shot or alien. */
  nextId: number;
}

/** Things that happened during a step, for sound, effects, rumble and the HUD to react to. */
export type RunEvent =
  | { type: 'waveStart'; wave: number }
  | { type: 'playerFired'; playerId: number; shots: number }
  | { type: 'alienFired'; x: number; y: number }
  | { type: 'alienHit'; alienId: number; kind: AlienKind; x: number; y: number }
  | { type: 'alienKilled'; alienId: number; kind: AlienKind; x: number; y: number; points: number; combo: number }
  | { type: 'diveStart'; alienId: number }
  | { type: 'comboBroken'; combo: number }
  | { type: 'shieldHit'; playerId: number }
  | { type: 'playerHit'; playerId: number; livesLeft: number }
  | { type: 'waveClear'; wave: number }
  | { type: 'upgradePicked'; playerId: number; upgrade: UpgradeId }
  | { type: 'won' }
  | { type: 'lost'; reason: 'lives' | 'invaded' };
