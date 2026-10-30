import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '../game/audio';
import type { Song, Stinger, StingerId, TrackId } from './song';
import { STINGERS, TRACKS } from './tracks';

// The music engine's public face. CONTRACT STUB: the settings getters and setters work; the
// playback methods do nothing yet. The engine worker fills them in without changing the API.
//
// It plays through the sound effects' AudioContext (attach() it after Sound.unlock()), into its
// own gain, so music has its own on/off and volume. The master sound switch (Sound: Off, the M
// key) silences it too, through `soundOn`.
//
// Every method is safe to call before attach() and while muted: the engine remembers what it was
// asked (the track, layers, phase, time scale) and picks up from there once it can play.

export class Music {
  private on: boolean;
  private level: number;
  private master = true;
  private current: TrackId | null = null;

  constructor(
    settings: MusicSettings = DEFAULT_MUSIC_SETTINGS,
    private readonly tracks: Record<TrackId, Song> = TRACKS,
    private readonly stingers: Record<StingerId, Stinger> = STINGERS,
  ) {
    this.on = settings.enabled;
    this.level = Math.min(1, Math.max(0, settings.volume));
  }

  /** The Music setting. */
  get enabled(): boolean {
    return this.on;
  }

  set enabled(on: boolean) {
    this.on = on;
  }

  /** The Music volume setting, 0 to 1. */
  get volume(): number {
    return this.level;
  }

  set volume(volume: number) {
    this.level = Math.min(1, Math.max(0, Number.isNaN(volume) ? 0 : volume));
  }

  /** The master sound switch; off silences music whatever its own setting. */
  get soundOn(): boolean {
    return this.master;
  }

  set soundOn(on: boolean) {
    this.master = on;
  }

  /** Plays through this context. Call after Sound.unlock(); calling again with the same context does nothing. */
  attach(_ctx: AudioContext): void {}

  /** The track playing (or fading in), or null. */
  get track(): TrackId | null {
    return this.current;
  }

  /**
   * Crossfades to a track (about a second), starting it from its intro. Asking for the track
   * already playing does nothing (it doesn't restart); null fades the music out. Starting a
   * track resets the boss phase to 1, intensity to 0 and danger to off.
   */
  play(track: TrackId | null): void {
    this.current = track;
    void this.tracks;
  }

  /**
   * Plays a stinger on the track's next beat (at once when nothing is playing). The track ducks
   * under it and comes back, or, for an ending stinger (victory, game over), fades out and stays
   * stopped until the next play().
   */
  stinger(_id: StingerId): void {
    void this.stingers;
  }

  /** 0 to 1: how far through the wave the player is. Brings in the `mid` and `high` layers. */
  setIntensity(_level: number): void {}

  /** On the last life: brings in the `danger` layer. */
  setDanger(_on: boolean): void {}

  /** The boss track's gear, 1 to 3 (tempo, key and the `phase2`/`phase3` layers), from the next bar. */
  setBossPhase(_phase: number): void {}

  /** Dips the music for a moment (a boss death, a Special): down by `depth` (0 to 1), back over `seconds`. */
  duck(_seconds: number, _depth = 0.6): void {}

  /** Slows the music (tempo and pitch, like tape) and muffles it: 1 is normal, Slow is 0.5, Time Stop about 0.25. Glides there. */
  setTimeScale(_scale: number): void {}

  /** While a pause menu is up the music plays on, quieter and muffled. */
  setPaused(_paused: boolean): void {}
}
