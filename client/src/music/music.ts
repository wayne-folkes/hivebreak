import { DEFAULT_MUSIC_SETTINGS, type MusicSettings } from '../game/audio';
import {
  busCutoff,
  duckLevel,
  glide,
  liveDucks,
  makeDuck,
  masterLevel,
  SCALE_GLIDE,
  type Duck,
} from './mix';
import { midiToHz } from './pattern';
import { TrackPlayer } from './player';
import type { Song, Stinger, StingerId, TrackId } from './song';
import {
  clampPhase,
  clampTimeScale,
  parseSong,
  parseStinger,
  stepSeconds,
  stingerSeconds,
  stingerStart,
  type MixState,
  type ParsedSong,
  type ParsedStinger,
} from './timeline';
import { STINGERS, TRACKS } from './tracks';
import { createChannelInput, createVoiceEnv, playDrum, playNote, type VoiceEnv } from './voices';

// The music engine. It plays through the sound effects' AudioContext (attach() it after
// Sound.unlock()), into its own gain, so music has its own on/off and volume. The master sound
// switch (Sound: Off, the M key) silences it too, through `soundOn`.
//
// Every method is safe to call before attach() and while muted: the engine remembers what it was
// asked (the track, layers, phase, time scale) and picks up from there once it can play.
//
// The signal path, with who steers each gain:
//
//   channel -> layer gain -> track bus -> [ duck ] -> [ low-pass ] -> master -> compressor -> out
//                                                                      ^
//   stinger channels -> a gain per stinger ---------------------------+
//
//   layer gain: layers fading on bar lines     track bus: crossfades and fade-outs
//   duck:       Music.duck() and stingers      low-pass:  time scale and pause
//   master:     setting x sound switch x pause x tab hidden
//
// A timer ticks every TICK_MS and schedules notes into the context up to LOOKAHEAD seconds ahead,
// so timing is the audio clock's, whatever the frame rate. It also steers the duck gain.

/** How often (ms) the scheduler wakes, and how far ahead (s) it schedules. */
export const TICK_MS = 25;
export const LOOKAHEAD = 0.35;
/** Seconds between asking for a track and its first note, so the first notes aren't late. */
const START_LEAD = 0.06;
/** Seconds a crossfade, or a fade-out to nothing, takes. */
const CROSSFADE = 1;
/** Fade-in (s) of a track starting from silence. */
const FIRST_FADE = 0.12;
/** Seconds an ending stinger takes to fade the track out. */
const ENDING_FADE = 0.5;
/** Seconds the music takes to come back after the player returns to a revived track. */
const REVIVE_FADE = 0.4;
/** How far down a non-ending stinger ducks the track, and how long the track takes to come back. */
const STINGER_DUCK = 0.7;
const STINGER_RECOVER = 0.4;
/** Time constants (s) for the master and the low-pass. */
const LEVEL_TC = 0.03;
const HIDE_TC = 0.04;
const SHOW_TC = 0.1;
const FILTER_TC = 0.1;
/** Tail (s) added to a stinger's notes for their release, before the track comes back. */
const STINGER_TAIL = 0.3;
/** Seconds sounding stingers take to fade out when a track is asked for. */
const STINGER_FADE = 0.3;
/** The limiter's threshold (dB). */
const LIMITER_THRESHOLD = -3;

/** A stinger that is sounding: its own gain, and when it can be disconnected. */
interface SoundingStinger {
  gain: GainNode;
  endAt: number;
}

/** The nodes the engine owns once it has a context. */
interface Graph {
  ctx: AudioContext;
  env: VoiceEnv;
  /** Where track buses connect: the duck gain, then the low-pass, then the master. */
  tracks: GainNode;
  duck: GainNode;
  filter: BiquadFilterNode;
  master: GainNode;
}

export class Music {
  private on: boolean;
  private level: number;
  private master = true;
  private current: TrackId | null = null;

  private graph: Graph | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listening = false;
  private hidden = false;
  private paused = false;
  /** The tracks playing: the active one, and any fading out (until they are silent). */
  private players: TrackPlayer[] = [];
  private active: TrackPlayer | null = null;
  private readonly songs = new Map<TrackId, ParsedSong | null>();
  private readonly stingerCache = new Map<StingerId, ParsedStinger | null>();

  private intensity = 0;
  private danger = false;
  private bossPhase = 1;

  /** Time scale: gliding from `scaleFrom` to `scaleTo`, starting at `glideStart` (AudioContext seconds). */
  private scaleFrom = 1;
  private scaleTo = 1;
  private glideStart = -Infinity;

  private ducks: Duck[] = [];
  /** Stingers still sounding, and when an ending stinger (which shuts out new ones) is over. */
  private sounding: SoundingStinger[] = [];
  private endingUntil = 0;
  /** The last values sent to the audio params, so unchanged values don't schedule anything. */
  private sentMaster = -1;
  private sentCutoff = -1;
  private sentDuck = 1;

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
    this.applyMaster(LEVEL_TC);
  }

  /** The Music volume setting, 0 to 1. */
  get volume(): number {
    return this.level;
  }

  set volume(volume: number) {
    this.level = Math.min(1, Math.max(0, Number.isNaN(volume) ? 0 : volume));
    this.applyMaster(LEVEL_TC);
  }

  /** The master sound switch; off silences music whatever its own setting. */
  get soundOn(): boolean {
    return this.master;
  }

  set soundOn(on: boolean) {
    this.master = on;
    this.applyMaster(LEVEL_TC);
  }

  /** Plays through this context. Call after Sound.unlock(); calling again with the same context does nothing. */
  attach(ctx: AudioContext): void {
    if (this.graph?.ctx === ctx) return;
    this.teardown();
    try {
      this.graph = this.buildGraph(ctx);
    } catch {
      this.graph = null;
      return;
    }
    this.listenForVisibility();
    if (this.current !== null) this.startTrack(this.current, FIRST_FADE);
  }

  /** The track playing (or fading in), or null. */
  get track(): TrackId | null {
    return this.current;
  }

  /** The next song step to be scheduled on the playing track, counted from the start of its intro; null when none is playing. */
  get position(): number | null {
    return this.active?.pos ?? null;
  }

  /**
   * Crossfades to a track (about a second), starting it from its intro. Asking for the track
   * already playing does nothing (it doesn't restart); null fades the music out, and asking for
   * the same track again while it is still fading out from that (not from an ending stinger,
   * and not once it is silent) brings it back where it was, without restarting or resetting.
   * Any other new track starts from its intro and resets the boss phase to 1, intensity to 0 and
   * danger to off. Any play() also fades out stingers still sounding.
   */
  play(track: TrackId | null): void {
    if (track === this.current) return;
    const g = this.graph;
    const now = g?.ctx.currentTime ?? 0;
    const previous = this.active;
    this.fadeStingers(now);

    if (track === null) {
      this.current = null;
      this.active = null;
      previous?.fadeOut(now, now, CROSSFADE, this.mixState(), true);
      return;
    }

    // Fading out because of play(null) or an ending stinger, and not yet silent: bring it back.
    const revivable = this.players.find((p) => p.id === track && p.revivable);
    if (revivable && previous === null && g) {
      revivable.revive(now, REVIVE_FADE);
      this.current = track;
      this.active = revivable;
      this.ensureTimer();
      this.tick();
      return;
    }

    for (const p of this.players) {
      p.revivable = false;
      // A fade that hasn't begun yet (an ending stinger's) starts now, so the old track doesn't linger.
      if (p.fadeStart !== null && p.fadeStart > now) p.fadeOut(now, now, CROSSFADE, p.frozen ?? this.mixState(), false);
    }
    this.current = track;
    this.intensity = 0;
    this.danger = false;
    this.bossPhase = 1;
    if (previous) {
      previous.fadeOut(now, now, CROSSFADE, this.mixState(), false);
      this.active = null;
    }
    if (g) this.startTrack(track, previous ? CROSSFADE : FIRST_FADE);
  }

  /**
   * Plays a stinger on the track's next beat (at once when nothing is playing). The track ducks
   * under it and comes back, or, for an ending stinger (victory, game over), fades out and stays
   * stopped until the next play(). On a slowed track it doesn't wait for a slow beat: it uses
   * the track's normal tempo, and starts at once if that beat is more than half a second away.
   * While an ending stinger is sounding, new stingers are ignored.
   */
  stinger(id: StingerId): void {
    const g = this.graph;
    const parsed = this.parsedStinger(id);
    if (!g || !parsed) return;
    const now = g.ctx.currentTime;
    if (now < this.endingUntil) return;
    const track = this.active;
    const at = track ? stingerStart(track.lastBeatAt, track.unscaledBeatSec, now) : now + 0.03;
    const length = stingerSeconds(parsed) + STINGER_TAIL;

    if (this.audible()) this.playStinger(g, parsed, at, length);
    if (parsed.stinger.ends) this.endingUntil = at + length;

    if (!track) {
      this.ensureTimer();
      return;
    }
    if (parsed.stinger.ends) {
      // Not revivable: the next play() of any track starts it fresh.
      track.fadeOut(now, at, ENDING_FADE, this.mixState(), false);
      this.active = null;
      this.current = null;
      this.ensureTimer();
    } else {
      this.ducks.push({ start: at - 0.05, depth: STINGER_DUCK, hold: length, recover: STINGER_RECOVER });
      this.ensureTimer();
      this.tick();
    }
  }

  /** 0 to 1: how far through the wave the player is. Brings in the `mid` and `high` layers. */
  setIntensity(level: number): void {
    this.intensity = Number.isNaN(level) ? 0 : Math.min(1, Math.max(0, level));
  }

  /** On the last life: brings in the `danger` layer. */
  setDanger(on: boolean): void {
    this.danger = on;
  }

  /**
   * The boss track's gear, 1 to 3 (tempo, key and the `phase2`/`phase3` layers), from the next
   * bar. Remembered whatever is playing (a track without phases ignores it); play() of a new
   * track resets it to 1.
   */
  setBossPhase(phase: number): void {
    this.bossPhase = clampPhase(phase);
  }

  /**
   * Dips the music for a moment (a boss death, a Special): down by `depth` (0 to 1), back over
   * `seconds` (0 to 10). Ignored if either is not a finite number.
   */
  duck(seconds: number, depth = 0.6): void {
    const g = this.graph;
    if (!g || !Number.isFinite(seconds) || !Number.isFinite(depth)) return;
    this.ducks.push(makeDuck(g.ctx.currentTime, seconds, depth));
    this.ensureTimer();
    this.tick();
  }

  /**
   * Slows the music and muffles it: 1 is normal, Slow is 0.5, Time Stop about 0.25. Tempo follows
   * the scale and pitch falls by its square root (a full tape drop would lose the bass). Glides there.
   */
  setTimeScale(scale: number): void {
    const target = clampTimeScale(scale);
    if (target === this.scaleTo) return;
    const now = this.now();
    this.scaleFrom = this.scaleAt(now);
    this.glideStart = now;
    this.scaleTo = target;
    this.applyFilter();
  }

  /** While a pause menu is up the music plays on, quieter and muffled. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.applyMaster(LEVEL_TC);
    this.applyFilter();
  }

  // --- Graph ---------------------------------------------------------------------------------

  private buildGraph(ctx: AudioContext): Graph {
    this.hidden = typeof document !== 'undefined' && document.hidden === true;
    this.sentMaster = this.targetMaster();
    this.sentCutoff = busCutoff(this.scaleTo, this.paused);
    this.sentDuck = 1;
    this.scaleFrom = this.scaleTo;
    this.glideStart = -Infinity;

    const duck = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.value = this.sentCutoff;
    const master = ctx.createGain();
    master.gain.value = this.sentMaster;
    // A safety limiter, not a mixing compressor: it only catches the peaks when many voices
    // land together. (Browsers add makeup gain to a compressor that squeezes hard, so a gentle
    // one would make the music louder than the staging says.)
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.1;

    duck.connect(filter);
    filter.connect(master);
    master.connect(limiter);
    limiter.connect(ctx.destination);
    return { ctx, env: createVoiceEnv(ctx), tracks: duck, duck, filter, master };
  }

  private teardown(): void {
    this.stopTimer();
    for (const p of this.players) p.dispose();
    this.players = [];
    this.active = null;
    this.ducks = [];
    for (const st of this.sounding) st.gain.disconnect();
    this.sounding = [];
    this.endingUntil = 0;
    this.graph?.master.disconnect();
    this.graph = null;
  }

  // --- Visibility ----------------------------------------------------------------------------

  /** Background tabs throttle timers to about a second, which would leave gaps: fade out and stop while hidden. */
  private listenForVisibility(): void {
    if (this.listening || typeof document === 'undefined') return;
    this.listening = true;
    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden === true;
      if (hidden === this.hidden) return;
      this.hidden = hidden;
      const g = this.graph;
      if (!g) return;
      if (hidden) {
        this.stopTimer();
        this.applyMaster(HIDE_TC);
      } else {
        const state: string = g.ctx.state;
        if (state === 'suspended' || state === 'interrupted') void g.ctx.resume().catch(() => {});
        for (const p of this.players) p.resumeClock(g.ctx.currentTime);
        this.applyMaster(SHOW_TC);
        this.ensureTimer();
        this.tick();
      }
    });
  }

  // --- Scheduler -----------------------------------------------------------------------------

  private ensureTimer(): void {
    if (this.timer !== null || this.hidden || !this.graph) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** One scheduler tick: drop faded-out tracks, schedule notes ahead, steer the duck gain. */
  private tick(): void {
    const g = this.graph;
    if (!g || this.hidden) return;
    const now = g.ctx.currentTime;
    this.players = this.players.filter((p) => {
      if (p.stopAt === null || now < p.stopAt) return true;
      p.dispose();
      return false;
    });
    this.sounding = this.sounding.filter((st) => {
      if (now < st.endAt) return true;
      st.gain.disconnect();
      return false;
    });
    const mix = this.mixState();
    const audible = this.audible();
    for (const p of this.players) p.schedule(now + LOOKAHEAD, now, mix, (t) => this.scaleAt(t), audible);
    this.updateDucks(g, now);
    if (this.players.length === 0 && this.ducks.length === 0 && this.sounding.length === 0) this.stopTimer();
  }

  private startTrack(id: TrackId, fadeIn: number): void {
    const g = this.graph;
    const parsed = this.parsedSong(id);
    if (!g || !parsed) return;
    const player = new TrackPlayer(g.env, parsed, g.tracks, g.ctx.currentTime + START_LEAD, this.mixState(), fadeIn);
    this.players.push(player);
    this.active = player;
    this.ensureTimer();
    this.tick();
  }

  /** A song's patterns parsed once; null (logged) when it is invalid, so a bad song is silent rather than fatal. */
  private parsedSong(id: TrackId): ParsedSong | null {
    if (!this.songs.has(id)) {
      try {
        this.songs.set(id, parseSong(this.tracks[id]));
      } catch (e) {
        console.error(`Music: track '${id}' can't play: ${(e as Error).message}`);
        this.songs.set(id, null);
      }
    }
    return this.songs.get(id) ?? null;
  }

  private parsedStinger(id: StingerId): ParsedStinger | null {
    if (!this.stingerCache.has(id)) {
      try {
        this.stingerCache.set(id, parseStinger(this.stingers[id]));
      } catch (e) {
        console.error(`Music: stinger '${id}' can't play: ${(e as Error).message}`);
        this.stingerCache.set(id, null);
      }
    }
    return this.stingerCache.get(id) ?? null;
  }

  /** Builds a stinger's notes from `at`, through a gain of its own that is kept until it has finished. */
  private playStinger(g: Graph, parsed: ParsedStinger, at: number, length: number): void {
    const { stinger } = parsed;
    const stepSec = stepSeconds(stinger.bpm, stinger.stepsPerBeat);
    const gain = g.ctx.createGain();
    gain.connect(g.master);
    this.sounding.push({ gain, endAt: at + length + 0.2 });
    for (const { channel, drums, pattern } of parsed.channels) {
      const input = createChannelInput(g.ctx, gain, channel.vol, channel.pan);
      for (const note of pattern.notes) {
        const time = at + note.at * stepSec;
        if (drums) {
          if (note.drum) playDrum(g.env, input, note.drum, note.accent, time);
        } else if (note.midi !== undefined && channel.instrument !== 'drums') {
          const hz = midiToHz(note.midi + (channel.transpose ?? 0));
          playNote(g.env, input, channel.instrument, hz, time, note.len * stepSec, note.accent);
        }
      }
    }
  }

  /** Fades out the stingers still sounding, to be disconnected once they are silent. */
  private fadeStingers(now: number): void {
    for (const st of this.sounding) {
      if (st.endAt <= now + STINGER_FADE) continue;
      st.gain.gain.setTargetAtTime(0, now, STINGER_FADE / 5);
      st.endAt = now + STINGER_FADE;
    }
    this.endingUntil = 0;
  }

  // --- Levels --------------------------------------------------------------------------------

  private mixState(): MixState {
    return { intensity: this.intensity, danger: this.danger, phase: this.bossPhase };
  }

  private now(): number {
    return this.graph?.ctx.currentTime ?? 0;
  }

  private scaleAt(t: number): number {
    return glide(this.scaleFrom, this.scaleTo, this.glideStart, SCALE_GLIDE, t);
  }

  private targetMaster(): number {
    return masterLevel({ enabled: this.on, soundOn: this.master, volume: this.level, paused: this.paused, hidden: this.hidden });
  }

  /** Whether notes are worth building: not when the master is silent. */
  private audible(): boolean {
    return this.targetMaster() > 0;
  }

  /** Sends the master level to the audio param, if it changed. */
  private applyMaster(timeConstant: number): void {
    const g = this.graph;
    if (!g) return;
    const target = this.targetMaster();
    if (target === this.sentMaster) return;
    this.sentMaster = target;
    g.master.gain.setTargetAtTime(target, g.ctx.currentTime, timeConstant);
  }

  /** Sends the low-pass cutoff (time scale, pause) to the audio param, if it changed. */
  private applyFilter(): void {
    const g = this.graph;
    if (!g) return;
    const cutoff = busCutoff(this.scaleTo, this.paused);
    if (cutoff === this.sentCutoff) return;
    this.sentCutoff = cutoff;
    g.filter.frequency.setTargetAtTime(cutoff, g.ctx.currentTime, FILTER_TC);
  }

  /** Follows the ducks in force with the duck gain, a little ahead of now, and drops the ones that are over. */
  private updateDucks(g: Graph, now: number): void {
    const level = duckLevel(this.ducks, now + 0.025);
    if (level !== this.sentDuck) {
      this.sentDuck = level;
      g.duck.gain.setTargetAtTime(level, now, 0.015);
    }
    this.ducks = liveDucks(this.ducks, now + 0.025);
  }
}
