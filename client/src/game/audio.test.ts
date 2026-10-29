import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOUND_SETTINGS,
  MAX_VOICES,
  PLAYER_FIRE_GAP,
  SETTINGS_KEY,
  Sound,
  admitVoice,
  attackTime,
  killPitch,
  loadSoundSettings,
  partsFor,
  playerFirePitch,
  playerFireReady,
  saveSoundSettings,
  soundLength,
  uiParts,
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

describe('partsFor', () => {
  const EVENTS: RunEvent[] = [
    { type: 'waveStart', wave: 0 },
    { type: 'playerFired', playerId: 0, shots: 1 },
    { type: 'alienFired', x: 0, y: 0 },
    { type: 'alienHit', alienId: 1, kind: 'warden', x: 0, y: 0 },
    { type: 'alienKilled', alienId: 1, kind: 'drone', x: 0, y: 0, points: 10, combo: 1 },
    { type: 'diveStart', alienId: 1 },
    { type: 'comboBroken', combo: 3 },
    { type: 'shieldHit', playerId: 0 },
    { type: 'playerHit', playerId: 0, livesLeft: 2 },
    { type: 'waveClear', wave: 0 },
    { type: 'upgradePicked', playerId: 0, upgrade: 'twinShot' },
    { type: 'won' },
    { type: 'lost', reason: 'lives' },
  ];

  it('gives every event a short sound with real notes', () => {
    for (const event of EVENTS) {
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
    const loudest = (parts: typeof shot) => Math.max(...parts.map((p) => p.vol));
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
