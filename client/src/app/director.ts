import { bossHealth } from '../game/boss';
import type { RunEvent, RunState } from '../game/types';
import { WAVES, WAVE_COUNT } from '../game/waves';
import type { StingerId, TrackId } from '../music/song';

// The music director: what the soundtrack should be doing, as pure functions of the game's state.
// main.ts applies musicState() to the Music engine every frame, and turns the real run's events
// into stingers and ducks with stingerFor() and duckFor(). No DOM and no Web Audio in here, so
// every rule is tested.

/**
 * Where the game is. `title`: the demo behind the title and its menus. `special`: a real run
 * waiting on the Special card. `playing`: a real run, including the pause menu. `pick`: the
 * upgrade card. `over`: the game-over card.
 */
export type Mode = 'title' | 'special' | 'playing' | 'pick' | 'over';

export interface MusicState {
  /** The track to play, or null for none (a finished run: its ending stinger fades the music). */
  track: TrackId | null;
  /** 0 to 1: how far through the wave. */
  intensity: number;
  /** On the last life. */
  danger: boolean;
  /** The boss track's gear, 1 to 3. */
  bossPhase: number;
  /** 1 normal, 0.5 under Slow, 0.25 under Time Stop. */
  timeScale: number;
}

/** Music time scales for the enemy time effects. */
export const TIME_STOP_SCALE = 0.25;
export const SLOW_SCALE = 0.5;

const QUIET: Omit<MusicState, 'track'> = { intensity: 0, danger: false, bossPhase: 1, timeScale: 1 };

/**
 * How far through the wave the run is, 0 to 1. Boss wave: the share of the boss's health gone,
 * counted the way its health bar counts it. Other waves: the share of the formation destroyed.
 * Free aliens (a Splitter's minis, a boss's Drones) have no slot and don't count, as in the
 * formation's own speed-up. Nothing has happened yet during the wave intro, so 0 there.
 */
export function waveProgress(run: RunState): number {
  if (run.phase === 'chooseSpecial' || run.phase === 'waveIntro') return 0;
  if (run.boss) return clamp01(1 - bossHealth(run.boss));
  const start = run.formation.startCount;
  if (start <= 0) return 0;
  let alive = 0;
  for (const a of run.aliens) if (a.mode !== 'free') alive++;
  return clamp01(1 - alive / start);
}

/** The track a wave plays: the boss theme on a boss wave, otherwise its sector's. */
function trackFor(wave: number): TrackId {
  const def = WAVES[wave];
  return def.boss ? 'boss' : def.sector === 2 ? 'sector2' : 'sector1';
}

/** What the music should be doing for this mode and run. */
export function musicState(mode: Mode, run: RunState): MusicState {
  if (mode === 'title' || mode === 'special') return { track: 'title', ...QUIET };
  // The game-over card, and a run that is won or lost (its ending stinger fades the track).
  if (mode === 'over' || run.phase === 'won' || run.phase === 'lost') return { track: null, ...QUIET };

  // With a boss beaten, its theme gives way to the next wave's track under the upgrade card.
  const bossBeaten = run.phase === 'upgradePick' && WAVES[run.wave].boss && run.wave + 1 < WAVE_COUNT;
  if (bossBeaten) return { track: trackFor(run.wave + 1), ...QUIET };
  const track = trackFor(run.wave);
  // The enemy clocks only run (and so only wind down) in these phases; a Time Stop left over when
  // the last alien fell mustn't hold the music slow behind the upgrade card.
  const clocksRun = run.phase === 'playing' || run.phase === 'waveIntro';
  let timeScale = 1;
  if (clocksRun && run.freeze > 0) timeScale = TIME_STOP_SCALE;
  else if (clocksRun && run.slow > 0) timeScale = SLOW_SCALE;

  return {
    track,
    intensity: waveProgress(run),
    danger: run.players.some((p) => p.lives === 1),
    bossPhase: run.boss?.phase ?? 1,
    timeScale,
  };
}

/** The stinger an event calls for, if any. The last wave's clear gives way to the victory stinger. */
export function stingerFor(event: RunEvent): StingerId | null {
  switch (event.type) {
    case 'waveClear':
      return event.wave >= WAVE_COUNT - 1 ? null : 'waveClear';
    case 'upgradePicked':
      return 'upgrade';
    case 'won':
      return 'victory';
    case 'lost':
      return 'gameOver';
    default:
      return null;
  }
}

/** How a big moment dips the music: for `seconds`, down by `depth` (0 to 1). */
export interface DuckSpec {
  seconds: number;
  depth: number;
}

export function duckFor(event: RunEvent): DuckSpec | null {
  switch (event.type) {
    case 'bossKilled':
      return { seconds: 2, depth: 0.8 };
    case 'specialFired':
      return { seconds: 1, depth: 0.5 };
    case 'playerHit':
      return { seconds: 0.6, depth: 0.4 };
    default:
      return null;
  }
}

function clamp01(n: number): number {
  return Number.isNaN(n) ? 0 : Math.min(1, Math.max(0, n));
}
