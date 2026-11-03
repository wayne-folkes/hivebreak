import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CUE_GAP,
  DEFAULT_MUSIC_SETTINGS,
  DEFAULT_SOUND_SETTINGS,
  MAX_VOICES,
  PLAYER_FIRE_GAP,
  SETTINGS_KEY,
  Sound,
  admitVoice,
  attackTime,
  killPitch,
  loadMusicSettings,
  loadSoundSettings,
  partsFor,
  pickupPitch,
  playerFirePitch,
  playerFireReady,
  saveMusicSettings,
  saveSoundSettings,
  soundLength,
  uiParts,
  type Part,
} from './audio';
import type { StorageLike } from './records';
import type { RunEvent } from './types';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('killPitch', () => {
  it('climbs with each combo step', () => {
    for (let c = 2; c <= 8; c++) {
      expect(killPitch(c)).toBeGreaterThan(killPitch(c - 1));
    }
  });

  it('is clamped to the combo range', () => {
    expect(killPitch(0)).toBe(killPitch(1));
    expect(killPitch(99)).toBe(killPitch(8));
  });

  it('is brighter for divers', () => {
    expect(killPitch(3, true)).toBeGreaterThan(killPitch(3, false));
  });
});

describe('playerFirePitch', () => {
  it('is a little lower for each extra shot in the volley', () => {
    expect(playerFirePitch(2)).toBeLessThan(playerFirePitch(1));
    expect(playerFirePitch(3)).toBeLessThan(playerFirePitch(2));
    expect(playerFirePitch(2)).toBeGreaterThan(playerFirePitch(1) * 0.9);
  });
});

describe('attackTime', () => {
  it('eases in quickly and never longer than the note', () => {
    expect(attackTime(1)).toBeGreaterThan(0);
    expect(attackTime(1)).toBeLessThanOrEqual(0.008);
    expect(attackTime(0.04)).toBeLessThan(0.04);
    expect(attackTime(0.001)).toBeLessThan(0.001);
  });
});

/**
 * One example of every event type. Keyed by type, so a new event type is a type error here until
 * it has a sample, and the sound test then covers it.
 */
const EVENTS: Record<RunEvent['type'], RunEvent> = {
  specialChosen: { type: 'specialChosen', playerId: 0, special: 'pulseBomb' },
  chainSpark: { type: 'chainSpark', fromX: 0, fromY: 0, toX: 10, toY: 10 },
  wellConsumed: { type: 'wellConsumed', x: 0, y: 0 },
  waveStart: { type: 'waveStart', wave: 0 },
  sectorStart: { type: 'sectorStart', sector: 2 },
  bunkerHit: { type: 'bunkerHit', bunkerId: 1, x: 0, y: -100 },
  alienSplit: { type: 'alienSplit', alienId: 1, x: 0, y: 0 },
  formationSplit: { type: 'formationSplit' },
  formationRegroup: { type: 'formationRegroup' },
  bossBeam: { type: 'bossBeam', state: 'warn', angle: -1.57 },
  playerFired: { type: 'playerFired', playerId: 0, shots: 1 },
  alienFired: { type: 'alienFired', x: 0, y: 0 },
  alienHit: { type: 'alienHit', alienId: 1, kind: 'warden', x: 0, y: 0 },
  alienKilled: { type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo: 1 },
  diveStart: { type: 'diveStart', alienId: 1 },
  comboBroken: { type: 'comboBroken', combo: 3 },
  comboGuarded: { type: 'comboGuarded', playerId: 0 },
  shieldHit: { type: 'shieldHit', playerId: 0 },
  playerHit: { type: 'playerHit', playerId: 0, livesLeft: 2 },
  blast: { type: 'blast', x: 0, y: 0, radius: 20 },
  pickupSpawned: { type: 'pickupSpawned', pickupId: 1, kind: 'spread', x: 0, y: 0 },
  pickupCollected: { type: 'pickupCollected', playerId: 0, pickupId: 1, kind: 'laser' },
  powerUpEnded: { type: 'powerUpEnded', playerId: 0, kind: 'slow' },
  specialReady: { type: 'specialReady', playerId: 0 },
  specialFired: { type: 'specialFired', playerId: 0, special: 'timeStop', x: 0, y: 0 },
  shotReflected: { type: 'shotReflected', x: 0, y: 0 },
  bossLaunched: { type: 'bossLaunched', alienId: 1 },
  bossFired: { type: 'bossFired', x: 0, y: 0 },
  bossPartHit: { type: 'bossPartHit', partId: 1, part: 'plate', x: 0, y: 0 },
  coreBlocked: { type: 'coreBlocked', x: 0, y: 0 },
  bossPartDestroyed: { type: 'bossPartDestroyed', partId: 1, part: 'bay', x: 0, y: 0, points: 100 },
  bossPhase: { type: 'bossPhase', phase: 2 },
  bossKilled: { type: 'bossKilled', kind: 'broodMother', x: 0, y: 0, points: 1000 },
  waveClear: { type: 'waveClear', wave: 0 },
  upgradePicked: { type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' },
  synergyUnlocked: { type: 'synergyUnlocked', playerId: 0, synergy: 'lance' },
  won: { type: 'won' },
  lost: { type: 'lost', reason: 'lives' },
  alienWarped: { type: 'alienWarped', alienId: 1, fromX: 0, fromY: 0, toX: 20, toY: 0 },
  mendPulse: { type: 'mendPulse', alienId: 1, x: 0, y: 0, healed: [{ x: 20, y: 0 }] },
  mineSpawned: { type: 'mineSpawned', mineId: 1, x: 0, y: 150 },
  mineBurst: { type: 'mineBurst', mineId: 1, x: 0, y: 0, radius: 26, cause: 'shot' },
  acidColumn: { type: 'acidColumn', columnId: 1, state: 'warn', x: 0, halfWidth: 8 },
};

/** The loudest a cue's parts get, before the master level. */
function loudest(parts: readonly Part[]): number {
  return Math.max(...parts.map((p) => p.vol));
}

/** The pitch (Hz) of a cue's first note, or 0 if it starts with noise. */
function firstFreq(parts: readonly Part[]): number {
  const first = parts[0];
  return first?.kind === 'tone' ? first.freq : 0;
}

/** The pitches (Hz) of a cue's tones, in the order they play. */
function toneFreqs(parts: readonly Part[]): number[] {
  return parts.flatMap((p) => (p.kind === 'tone' ? [p.freq] : []));
}

describe('partsFor', () => {
  it('gives every event a short sound with real notes', () => {
    for (const event of Object.values(EVENTS)) {
      const parts = partsFor(event);
      expect(parts.length, event.type).toBeGreaterThan(0);
      for (const part of parts) expect(part.dur, event.type).toBeGreaterThan(0);
      expect(soundLength(parts), event.type).toBeGreaterThan(0.02);
      expect(soundLength(parts), event.type).toBeLessThanOrEqual(1.6);
    }
  });

  it('keeps the player shot quiet, since it repeats a lot', () => {
    const shot = partsFor({ type: 'playerFired', playerId: 0, shots: 1 });
    const kill = partsFor({ type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo: 1 });
    expect(loudest(shot)).toBeLessThan(loudest(kill));
  });

  it('raises the kill pitch with the combo', () => {
    const toneAt = (combo: number) => {
      const tone = partsFor({ type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo }).find(
        (p) => p.kind === 'tone',
      );
      return tone?.kind === 'tone' ? tone.freq : 0;
    };
    expect(toneAt(4)).toBeGreaterThan(toneAt(1));
    expect(toneAt(8)).toBeGreaterThan(toneAt(4));
  });

  it('plays the menu sounds as short tones', () => {
    for (const name of ['move', 'confirm', 'back'] as const) {
      expect(soundLength(uiParts(name))).toBeGreaterThan(0);
      expect(soundLength(uiParts(name))).toBeLessThan(0.5);
    }
  });
});

describe('admitVoice', () => {
  it('lets at most MAX_VOICES of one cue sound at once', () => {
    expect(MAX_VOICES).toBe(4);
    let ends: number[] = [];
    for (let i = 0; i < MAX_VOICES; i++) {
      ends = admitVoice(ends, 0, 0.2) ?? [];
    }
    expect(ends).toHaveLength(MAX_VOICES);
    expect(admitVoice(ends, 0.1, 0.2)).toBeNull();
  });

  it('frees a slot once a voice has finished', () => {
    const ends = [0.2, 0.2, 0.2, 0.2];
    expect(admitVoice(ends, 0.25, 0.2)).toEqual([0.45]);
  });

  it('does not change the list it is given', () => {
    const ends = [0.2, 0.1];
    admitVoice(ends, 0.15, 0.2);
    expect(ends).toEqual([0.2, 0.1]);
  });
});

describe('playerFireReady', () => {
  it('drops a player shot that follows one within 40 ms', () => {
    expect(playerFireReady(-Infinity, 0)).toBe(true);
    expect(playerFireReady(1, 1 + PLAYER_FIRE_GAP / 2)).toBe(false);
    expect(playerFireReady(1, 1.05)).toBe(true);
  });
});

describe('Sound', () => {
  it('starts from the given settings', () => {
    const sound = new Sound({ enabled: false, volume: 0.3 });
    expect(sound.enabled).toBe(false);
    expect(sound.volume).toBe(0.3);
  });

  it('keeps the volume within 0 to 1', () => {
    const sound = new Sound();
    sound.volume = 2;
    expect(sound.volume).toBe(1);
    sound.volume = -1;
    expect(sound.volume).toBe(0);
    sound.volume = NaN;
    expect(sound.volume).toBe(0);
  });

  it('does not throw before unlock(), when there is no audio context yet', () => {
    const sound = new Sound();
    expect(() => {
      sound.handle([{ type: 'playerHit', playerId: 0, livesLeft: 1 }, { type: 'playerFired', playerId: 0, shots: 2 }]);
      sound.ui('confirm');
      sound.enabled = false;
      sound.volume = 0.5;
    }).not.toThrow();
  });
});

describe('loadSoundSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadSoundSettings(fakeStorage())).toEqual(DEFAULT_SOUND_SETTINGS);
    expect(DEFAULT_SOUND_SETTINGS).toEqual({ enabled: true, volume: 0.75 });
  });

  it('survives corrupt data', () => {
    for (const bad of ['not json', '[1,2]', '42', 'null', '']) {
      expect(loadSoundSettings(fakeStorage({ [SETTINGS_KEY]: bad }))).toEqual(DEFAULT_SOUND_SETTINGS);
    }
  });

  it('falls back to the default for a field of the wrong type', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: '{"enabled":"yes","volume":"loud"}' });
    expect(loadSoundSettings(s)).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it('reads a valid saved value and keeps the volume within 0 to 1', () => {
    expect(loadSoundSettings(fakeStorage({ [SETTINGS_KEY]: '{"enabled":false,"volume":0.3}' }))).toEqual({
      enabled: false,
      volume: 0.3,
    });
    expect(loadSoundSettings(fakeStorage({ [SETTINGS_KEY]: '{"volume":7}' })).volume).toBe(1);
  });

  it('survives storage that throws', () => {
    expect(loadSoundSettings(broken)).toEqual(DEFAULT_SOUND_SETTINGS);
  });
});

describe('saveSoundSettings', () => {
  it('saves settings that load back the same', () => {
    const s = fakeStorage();
    saveSoundSettings(s, { enabled: false, volume: 0.4 });
    expect(loadSoundSettings(s)).toEqual({ enabled: false, volume: 0.4 });
  });

  it('keeps other settings already saved under the key', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: '{"other":1,"volume":0.2}' });
    saveSoundSettings(s, { enabled: true, volume: 0.5 });
    expect(JSON.parse(s.data[SETTINGS_KEY])).toEqual({ other: 1, enabled: true, volume: 0.5 });
  });

  it('replaces corrupt data rather than failing', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: 'not json' });
    saveSoundSettings(s, { enabled: true, volume: 0.75 });
    expect(loadSoundSettings(s)).toEqual(DEFAULT_SOUND_SETTINGS);
  });

  it('does not throw when storage is blocked', () => {
    expect(() => saveSoundSettings(broken, { enabled: true, volume: 0.75 })).not.toThrow();
  });
});

describe('loadMusicSettings', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(loadMusicSettings(fakeStorage())).toEqual(DEFAULT_MUSIC_SETTINGS);
    expect(DEFAULT_MUSIC_SETTINGS).toEqual({ enabled: true, volume: 0.6 });
  });

  it('survives corrupt data', () => {
    for (const bad of ['not json', '[1,2]', '42', 'null', '']) {
      expect(loadMusicSettings(fakeStorage({ [SETTINGS_KEY]: bad }))).toEqual(DEFAULT_MUSIC_SETTINGS);
    }
  });

  it('falls back to the default for a field of the wrong type', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: '{"music":"yes","musicVolume":"loud"}' });
    expect(loadMusicSettings(s)).toEqual(DEFAULT_MUSIC_SETTINGS);
  });

  it('reads a valid saved value and keeps the volume within 0 to 1', () => {
    expect(loadMusicSettings(fakeStorage({ [SETTINGS_KEY]: '{"music":false,"musicVolume":0.3}' }))).toEqual({
      enabled: false,
      volume: 0.3,
    });
    expect(loadMusicSettings(fakeStorage({ [SETTINGS_KEY]: '{"musicVolume":7}' })).volume).toBe(1);
    expect(loadMusicSettings(fakeStorage({ [SETTINGS_KEY]: '{"musicVolume":-2}' })).volume).toBe(0);
  });

  it('ignores the sound keys', () => {
    expect(loadMusicSettings(fakeStorage({ [SETTINGS_KEY]: '{"enabled":false,"volume":0.2}' }))).toEqual(
      DEFAULT_MUSIC_SETTINGS,
    );
  });

  it('survives storage that throws', () => {
    expect(loadMusicSettings(broken)).toEqual(DEFAULT_MUSIC_SETTINGS);
  });
});

describe('saveMusicSettings', () => {
  it('saves settings that load back the same', () => {
    const s = fakeStorage();
    saveMusicSettings(s, { enabled: false, volume: 0.4 });
    expect(loadMusicSettings(s)).toEqual({ enabled: false, volume: 0.4 });
  });

  it('keeps the volume within 0 to 1', () => {
    const s = fakeStorage();
    saveMusicSettings(s, { enabled: true, volume: 3 });
    expect(loadMusicSettings(s).volume).toBe(1);
    saveMusicSettings(s, { enabled: true, volume: -1 });
    expect(loadMusicSettings(s).volume).toBe(0);
  });

  it('keeps other settings already saved under the key, sound included', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: '{"other":1,"volume":0.2,"enabled":false}' });
    saveMusicSettings(s, { enabled: true, volume: 0.5 });
    expect(JSON.parse(s.data[SETTINGS_KEY])).toEqual({
      other: 1,
      volume: 0.2,
      enabled: false,
      music: true,
      musicVolume: 0.5,
    });
  });

  it('replaces corrupt data rather than failing', () => {
    const s = fakeStorage({ [SETTINGS_KEY]: 'not json' });
    saveMusicSettings(s, DEFAULT_MUSIC_SETTINGS);
    expect(loadMusicSettings(s)).toEqual(DEFAULT_MUSIC_SETTINGS);
  });

  it('does not throw when storage is blocked', () => {
    expect(() => saveMusicSettings(broken, DEFAULT_MUSIC_SETTINGS)).not.toThrow();
  });
});

describe('music and sound settings share one saved object', () => {
  it('saving sound keeps the music settings', () => {
    const s = fakeStorage();
    saveMusicSettings(s, { enabled: false, volume: 0.2 });
    saveSoundSettings(s, { enabled: true, volume: 0.9 });
    expect(loadMusicSettings(s)).toEqual({ enabled: false, volume: 0.2 });
    expect(loadSoundSettings(s)).toEqual({ enabled: true, volume: 0.9 });
  });

  it('saving music keeps the sound settings', () => {
    const s = fakeStorage();
    saveSoundSettings(s, { enabled: false, volume: 0.4 });
    saveMusicSettings(s, { enabled: true, volume: 0.1 });
    expect(loadSoundSettings(s)).toEqual({ enabled: false, volume: 0.4 });
    expect(loadMusicSettings(s)).toEqual({ enabled: true, volume: 0.1 });
  });
});

describe('pickup and Special sounds', () => {
  it('pitches each kind of power-up differently', () => {
    const kinds = ['spread', 'laser', 'slow', 'helper'] as const;
    expect(new Set(kinds.map(pickupPitch)).size).toBe(kinds.length);
  });

  it("starts a pickup's arpeggio on its kind's pitch", () => {
    for (const kind of ['spread', 'laser', 'slow', 'helper'] as const) {
      const parts = partsFor({ type: 'pickupCollected', playerId: 0, pickupId: 1, kind });
      expect(firstFreq(parts), kind).toBe(pickupPitch(kind));
    }
  });

  it('gives each Special its own sound', () => {
    const sounds = (['pulseBomb', 'shieldBurst', 'timeStop'] as const).map((special) =>
      JSON.stringify(partsFor({ type: 'specialFired', playerId: 0, special, x: 0, y: 0 })),
    );
    expect(new Set(sounds).size).toBe(3);
  });

  it('keeps the blast and the boss shot quieter than the sounds they go with', () => {
    const killed = partsFor({ type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo: 1 });
    const alienShot = partsFor({ type: 'alienFired', x: 0, y: 0 });
    expect(loudest(partsFor({ type: 'blast', x: 0, y: 0, radius: 20 }))).toBeLessThan(loudest(killed));
    expect(loudest(partsFor({ type: 'bossFired', x: 0, y: 0 }))).toBeLessThan(loudest(alienShot));
  });

  it('gives a synergy a chord that is not the upgrade chime', () => {
    const upgrade = partsFor({ type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' });
    const synergy = partsFor({ type: 'synergyUnlocked', playerId: 0, synergy: 'lance' });
    expect(JSON.stringify(synergy)).not.toBe(JSON.stringify(upgrade));
  });
});

/** A stand-in for an audio node: it takes connections and does nothing. */
class FakeNode {
  type = '';
  buffer: unknown = null;
  Q = { value: 0 };
  frequency = { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} };
  gain = { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, setTargetAtTime: () => {} };
  connect(): FakeNode {
    return this;
  }
  start(): void {}
  stop(): void {}
}

/** A stand-in for AudioContext that counts the oscillators and noise sources started. */
class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  sampleRate = 1000;
  state = 'running';
  destination = new FakeNode();
  sources = 0;

  constructor() {
    FakeAudioContext.last = this;
  }

  createGain(): FakeNode {
    return new FakeNode();
  }
  createBiquadFilter(): FakeNode {
    return new FakeNode();
  }
  createOscillator(): FakeNode {
    this.sources++;
    return new FakeNode();
  }
  createBufferSource(): FakeNode {
    this.sources++;
    return new FakeNode();
  }
  createBuffer(): { getChannelData: () => Float32Array } {
    return { getChannelData: () => new Float32Array(this.sampleRate) };
  }
  resume(): Promise<void> {
    return Promise.resolve();
  }
}

describe('voice limit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('caps blast and bossPartHit at MAX_VOICES voices each', () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const sound = new Sound();
    sound.unlock();
    const ctx = FakeAudioContext.last;
    if (!ctx) throw new Error('no audio context was created');

    // The fake clock never moves, so no voice ends: each cue can start only MAX_VOICES times.
    // Each part starts one source, so a capped cue adds MAX_VOICES times its part count.
    for (const event of [EVENTS.blast, EVENTS.bossPartHit]) {
      const before = ctx.sources;
      sound.handle(Array.from({ length: 10 }, () => event));
      expect(ctx.sources - before, event.type).toBe(MAX_VOICES * partsFor(event).length);
    }
  });
});

describe('slice 2b sounds', () => {
  it('starts a sector on a deeper note than the wave start', () => {
    expect(firstFreq(partsFor(EVENTS.sectorStart))).toBeLessThan(firstFreq(partsFor(EVENTS.waveStart)));
  });

  it('rises for the formation split and falls for the regroup', () => {
    const split = toneFreqs(partsFor(EVENTS.formationSplit));
    const regroup = toneFreqs(partsFor(EVENTS.formationRegroup));
    expect(split[1]).toBeGreaterThan(split[0]);
    expect(regroup[1]).toBeLessThan(regroup[0]);
  });

  it('keeps the bunker crumble quieter than a kill', () => {
    expect(loudest(partsFor(EVENTS.bunkerHit))).toBeLessThan(loudest(partsFor(EVENTS.alienKilled)));
  });

  it('makes the boss charge a rising whine of about a second', () => {
    const warn = partsFor(EVENTS.bossBeam);
    expect(soundLength(warn)).toBeGreaterThan(0.8);
    expect(soundLength(warn)).toBeLessThanOrEqual(1.6);
    const charge = warn[0];
    expect(charge.kind === 'tone' && (charge.to ?? 0) > charge.freq).toBe(true);
  });

  it('gives the boss zap its own sound, not the charge', () => {
    const fire = partsFor({ type: 'bossBeam', state: 'fire', angle: 0 });
    expect(JSON.stringify(fire)).not.toBe(JSON.stringify(partsFor(EVENTS.bossBeam)));
    expect(soundLength(fire)).toBeLessThan(0.5);
  });
});

describe('3b sounds', () => {
  it('keeps the chain spark short and quieter than an alien hit, since it is frequent', () => {
    const spark = partsFor(EVENTS.chainSpark);
    expect(soundLength(spark)).toBeLessThan(0.1);
    expect(loudest(spark)).toBeLessThan(loudest(partsFor(EVENTS.alienHit)));
  });

  it('makes the well thup fall in pitch', () => {
    const thup = partsFor(EVENTS.wellConsumed)[0];
    expect(thup.kind === 'tone' && (thup.to ?? 0) < thup.freq).toBe(true);
  });

  it('gives the chain spark and the well thup a rate limit', () => {
    expect(CUE_GAP.chainSpark).toBeCloseTo(0.05);
    expect(CUE_GAP.wellConsumed).toBeCloseTo(0.06);
  });

  it('makes the missile swarm a rising whoosh with a burst of staggered launch blips', () => {
    const parts = partsFor({ type: 'specialFired', playerId: 0, special: 'missileSwarm', x: 0, y: 0 });
    const whoosh = parts[0];
    expect(whoosh.kind === 'noise' && whoosh.to > whoosh.from).toBe(true);

    const blips = parts.filter((p) => p.kind === 'tone');
    expect(blips.length).toBeGreaterThanOrEqual(4);
    expect(blips.length).toBeLessThanOrEqual(8);
    const starts = blips.map((p) => p.delay ?? 0);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeCloseTo(0.04, 5);
    }
  });

  it('makes the gravity well a deep hum that sinks, about 0.8 s long, over a noise sweep', () => {
    const parts = partsFor({ type: 'specialFired', playerId: 0, special: 'gravityWell', x: 0, y: 0 });
    expect(soundLength(parts)).toBeGreaterThan(0.7);
    expect(soundLength(parts)).toBeLessThan(0.9);
    const hum = parts[0];
    expect(hum.kind === 'tone' && hum.freq < 250 && (hum.to ?? 0) < hum.freq).toBe(true);
    expect(parts.some((p) => p.kind === 'noise')).toBe(true);
  });

  it('gives every Special a sound of its own', () => {
    const specials = ['pulseBomb', 'shieldBurst', 'timeStop', 'missileSwarm', 'gravityWell'] as const;
    const sounds = specials.map((special) =>
      JSON.stringify(partsFor({ type: 'specialFired', playerId: 0, special, x: 0, y: 0 })),
    );
    expect(new Set(sounds).size).toBe(specials.length);
  });

  it('plays the unlock fanfare as a rising arpeggio, about 0.8 s long', () => {
    const parts = uiParts('unlock');
    for (const part of parts) expect(part.dur).toBeGreaterThan(0);
    expect(soundLength(parts)).toBeGreaterThan(0.7);
    expect(soundLength(parts)).toBeLessThan(0.9);
    const notes = toneFreqs(parts);
    expect(notes[1]).toBeGreaterThan(notes[0]);
    expect(notes[2]).toBeGreaterThan(notes[1]);
  });
});

describe('rate limits', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('drops a frequent cue that comes again inside its gap', () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const sound = new Sound();
    sound.unlock();
    const ctx = FakeAudioContext.last;
    if (!ctx) throw new Error('no audio context was created');

    for (const event of [EVENTS.bunkerHit, EVENTS.bossBeam, EVENTS.chainSpark, EVENTS.wellConsumed]) {
      const before = ctx.sources;
      // Three at the same moment: the second and third fall inside the gap, so only the first plays.
      sound.handle([event, event, event]);
      expect(ctx.sources - before, event.type).toBe(partsFor(event).length);

      // A second later the gap is up, so the next one plays again.
      ctx.currentTime += 1;
      sound.handle([event]);
      expect(ctx.sources - before, event.type).toBe(2 * partsFor(event).length);
    }
  });

  it('rate-limits a mine burst against a bunker, but not a shot one', () => {
    vi.stubGlobal('window', { AudioContext: FakeAudioContext });
    const sound = new Sound();
    sound.unlock();
    const ctx = FakeAudioContext.last;
    if (!ctx) throw new Error('no audio context was created');

    const bunker: RunEvent = { type: 'mineBurst', mineId: 1, x: 0, y: 0, radius: 26, cause: 'bunker' };
    const before = ctx.sources;
    sound.handle([bunker, bunker, bunker]);
    expect(ctx.sources - before).toBe(partsFor(bunker).length);

    const shot = EVENTS.mineBurst;
    const shotBefore = ctx.sources;
    sound.handle([shot, shot]);
    expect(ctx.sources - shotBefore).toBe(2 * partsFor(shot).length);
  });
});

describe('slice 4a sounds', () => {
  it('gives each mine burst cause its own sound', () => {
    const causes = ['shot', 'bunker', 'ground'] as const;
    const sounds = causes.map((cause) =>
      JSON.stringify(partsFor({ type: 'mineBurst', mineId: 1, x: 0, y: 0, radius: 26, cause })),
    );
    expect(new Set(sounds).size).toBe(causes.length);
  });

  it('keeps the bunker thud shorter than the shot explosion', () => {
    const thud = partsFor({ type: 'mineBurst', mineId: 1, x: 0, y: 0, radius: 26, cause: 'bunker' });
    const boom = partsFor({ type: 'mineBurst', mineId: 1, x: 0, y: 0, radius: 26, cause: 'shot' });
    expect(soundLength(thud)).toBeLessThan(soundLength(boom));
  });

  it('keeps the mine blip quieter than a chain spark, since mines arrive often', () => {
    expect(loudest(partsFor(EVENTS.mineSpawned))).toBeLessThan(loudest(partsFor(EVENTS.chainSpark)));
  });

  it('keeps the mend chime quieter than a kill', () => {
    expect(loudest(partsFor(EVENTS.mendPulse))).toBeLessThan(loudest(partsFor(EVENTS.alienKilled)));
  });

  it('gives the acid rain a longer fizz than its warning hiss, and ends it in silence', () => {
    const warn = partsFor(EVENTS.acidColumn);
    const rain = partsFor({ type: 'acidColumn', columnId: 1, state: 'rain', x: 0, halfWidth: 8 });
    expect(soundLength(warn)).toBeGreaterThan(0);
    expect(soundLength(rain)).toBeGreaterThan(soundLength(warn));
    expect(soundLength(rain)).toBeLessThanOrEqual(1.6);
    expect(partsFor({ type: 'acidColumn', columnId: 1, state: 'end', x: 0, halfWidth: 8 })).toEqual([]);
  });
});
