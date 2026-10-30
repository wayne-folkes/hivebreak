import { midiToHz } from './pattern';
import type { Layer, TrackId } from './song';
import {
  activeLayers,
  clampPhase,
  eventsAtStep,
  gearFor,
  isBarLine,
  isBeat,
  resumeTime,
  skipBehind,
  stepSeconds,
  type MixState,
  type ParsedSong,
} from './timeline';
import { createChannelInput, playDrum, playNote, type VoiceEnv } from './voices';

// One playing track: its own bus gain, a gain per layer and per channel, and a position in the
// song. The music engine (music.ts) runs the timer and calls schedule(); this class turns song
// steps into Web Audio notes.
//
// Gain nodes here are only ever steered with setTargetAtTime (smooth, and safe to layer
// one on top of another), never with ramps that a later change would have to cancel.

/** Layers fade over this many beats, starting on a bar line. */
const LAYER_FADE_BEATS = 1;

export class TrackPlayer {
  readonly id: TrackId;
  /** Everything in the track goes through this gain, for crossfades and fade-outs. */
  readonly bus: GainNode;
  /** The next step to schedule, counted from the start of the song. */
  pos = 0;
  /** When that step starts (AudioContext seconds). */
  nextTime: number;
  /** When the most recent scheduled beat started, and how long a beat lasts, for stingers to line up. */
  lastBeatAt: number | null = null;
  beatSec = 0.5;
  /** Set while fading out: when the bus is silent and the player can be dropped. */
  stopAt: number | null = null;
  /** Fading out because of play(null) or an ending stinger: play() of the same track brings it back. */
  revivable = false;
  /** The mix state a fading player keeps, so a new track's reset doesn't thin it out mid-fade. */
  frozen: MixState | null = null;

  /** Whether the song has boss phases (a gear per phase). */
  get hasPhases(): boolean {
    return !!this.parsed.song.phases;
  }

  private appliedPhase: number;
  private appliedLayers: Set<Layer>;
  /** When each layer turned off has faded to silence; its channels aren't scheduled after that. */
  private readonly silentFrom = new Map<Layer, number>();
  private readonly layerGains = new Map<Layer, GainNode>();
  private readonly inputs: GainNode[];
  private needSync = false;

  constructor(
    private readonly env: VoiceEnv,
    private readonly parsed: ParsedSong,
    dest: AudioNode,
    start: number,
    state: MixState,
    fadeIn: number,
  ) {
    const { ctx } = env;
    const song = parsed.song;
    this.id = song.id;
    this.nextTime = start;
    this.appliedPhase = song.phases ? clampPhase(state.phase) : 1;
    this.appliedLayers = activeLayers({ ...state, phase: this.appliedPhase });
    this.beatSec = stepSeconds(gearFor(song, this.appliedPhase).bpm, song.stepsPerBeat) * song.stepsPerBeat;

    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.gain.setTargetAtTime(1, Math.max(start - 0.05, ctx.currentTime), fadeIn / 4);
    this.bus.connect(dest);

    for (const { channel } of parsed.channels) {
      if (this.layerGains.has(channel.layer)) continue;
      const gain = ctx.createGain();
      gain.gain.value = this.appliedLayers.has(channel.layer) ? 1 : 0;
      gain.connect(this.bus);
      this.layerGains.set(channel.layer, gain);
    }
    this.inputs = parsed.channels.map(({ channel }) =>
      createChannelInput(ctx, this.layerGains.get(channel.layer)!, channel.vol, channel.pan),
    );
    for (const layer of this.layerGains.keys()) if (!this.appliedLayers.has(layer)) this.silentFrom.set(layer, -Infinity);
  }

  /**
   * Schedules every step that starts before `until`. `scaleAt(t)` is the time scale at a moment,
   * `audible` says whether to make sound at all (when muted the song still advances, so it is in
   * time when the sound comes back).
   */
  schedule(until: number, now: number, mix: MixState, scaleAt: (t: number) => number, audible: boolean): void {
    const state = this.frozen ?? mix;
    const song = this.parsed.song;

    // Fell behind (a throttled timer): skip to the present instead of a burst of late notes.
    const behind = skipBehind(
      this.pos,
      this.nextTime,
      now,
      stepSeconds(gearFor(song, this.appliedPhase).bpm, song.stepsPerBeat, scaleAt(now)),
    );
    if (behind.skipped > 0) {
      this.pos = behind.pos;
      this.nextTime = behind.nextTime;
      this.needSync = true;
    }

    while (this.nextTime < until) {
      const step = this.pos;
      const t = this.nextTime;
      const scale = scaleAt(t);
      if (this.needSync || isBarLine(step, song.stepsPerBar)) {
        this.sync(state, t, scale);
        this.needSync = false;
      }
      const gear = gearFor(song, this.appliedPhase);
      const stepSec = stepSeconds(gear.bpm, song.stepsPerBeat, scale);
      if (isBeat(step, song.stepsPerBeat)) {
        this.lastBeatAt = t;
        this.beatSec = stepSec * song.stepsPerBeat;
      }
      if (audible) {
        for (const { channel, event } of eventsAtStep(this.parsed, step)) {
          const silentFrom = this.silentFrom.get(this.parsed.channels[channel].channel.layer);
          if (silentFrom !== undefined && t >= silentFrom) continue;
          const { channel: def } = this.parsed.channels[channel];
          if (def.instrument === 'drums') {
            if (event.drum) playDrum(this.env, this.inputs[channel], event.drum, event.accent, t, scale);
          } else if (event.midi !== undefined) {
            const hz = midiToHz(event.midi + (def.transpose ?? 0) + gear.transpose) * scale;
            playNote(this.env, this.inputs[channel], def.instrument, hz, t, event.len * stepSec, event.accent);
          }
        }
      }
      this.pos++;
      this.nextTime += stepSec;
    }
  }

  /** Picks up the wanted phase and layers on a bar line at time `t`, fading changed layers over a beat. */
  private sync(state: MixState, t: number, scale: number): void {
    const song = this.parsed.song;
    this.appliedPhase = song.phases ? clampPhase(state.phase) : 1;
    const layers = activeLayers({ ...state, phase: this.appliedPhase });
    const fade = stepSeconds(gearFor(song, this.appliedPhase).bpm, song.stepsPerBeat, scale) * song.stepsPerBeat * LAYER_FADE_BEATS;
    for (const [layer, gain] of this.layerGains) {
      const on = layers.has(layer);
      if (on === this.appliedLayers.has(layer)) continue;
      gain.gain.setTargetAtTime(on ? 1 : 0, t, fade / 4);
      if (on) this.silentFrom.delete(layer);
      else this.silentFrom.set(layer, t + fade * 1.5);
    }
    this.appliedLayers = layers;
  }

  /**
   * Fades the bus to silence over `seconds` from `at`, then it can be dropped (see stopAt). `state`
   * is kept for the rest of the fade.
   */
  fadeOut(now: number, at: number, seconds: number, state: MixState, revivable: boolean): void {
    const from = Math.max(at, now);
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(0, from, seconds / 5);
    this.stopAt = from + seconds;
    this.revivable = revivable;
    this.frozen = state;
  }

  /** Brings a fading track back up without restarting it. */
  revive(now: number, seconds: number): void {
    this.bus.gain.cancelScheduledValues(now);
    this.bus.gain.setTargetAtTime(1, now, seconds / 4);
    this.stopAt = null;
    this.revivable = false;
    this.frozen = null;
    this.needSync = true;
  }

  /** Coming back from a background tab: carry on from where the song was, starting now. */
  resumeClock(now: number): void {
    this.nextTime = resumeTime(this.nextTime, now);
    this.needSync = true;
  }

  dispose(): void {
    this.bus.disconnect();
  }
}
