import { describe, expect, it } from 'vitest';
import { parsePattern, validateSong, validateStinger } from './pattern';
import type { Channel, Layer, Song } from './song';
import { HEART_BEAT_SECONDS } from '../game/heart';
import { STINGERS, TRACKS } from './tracks';

const songs = Object.values(TRACKS);

const layersOf = (song: Song): Set<Layer> => new Set(song.channels.map((c) => c.layer));
const pitched = (song: Song): Channel[] => song.channels.filter((c) => c.instrument !== 'drums');
const drumsOf = (song: Song): Channel[] => song.channels.filter((c) => c.instrument === 'drums');
const tokensIn = (text: string): string[] => text.split(/\s+/).filter((t) => t !== '' && t !== '|');

/** Steps in each `|`-separated bar of a pattern. */
const barLengths = (text: string): number[] => text.split('|').map((bar) => tokensIn(bar).length);

describe('the soundtrack', () => {
  it('has the six tracks, each filed under its own id', () => {
    expect(Object.keys(TRACKS).sort()).toEqual(['boss', 'heart', 'sector1', 'sector2', 'sector3', 'title']);
    for (const [id, song] of Object.entries(TRACKS)) expect(song.id).toBe(id);
  });

  it.each(songs.map((s) => [s.id, s] as const))('%s passes validateSong', (_id, song) => {
    expect(validateSong(song)).toEqual([]);
  });

  it.each(songs.map((s) => [s.id, s] as const))('%s writes every bar with the right number of steps', (_id, song) => {
    for (const channel of song.channels) {
      for (const [what, text] of [['intro', channel.intro], ['loop', channel.loop]] as const) {
        if (text === undefined) continue;
        for (const [i, n] of barLengths(text).entries()) {
          // A loop shorter than a bar (a one-bar riff written without bar lines) is the one exception.
          if (what === 'loop' && barLengths(text).length === 1 && n < song.stepsPerBar) continue;
          expect(n, `${song.id} '${channel.name}' ${what} bar ${i + 1}`).toBe(song.stepsPerBar);
        }
      }
    }
  });

  it('uses 4/4 sixteenths and loops for 16 to 32 bars after a short intro', () => {
    for (const song of songs) {
      expect(song.stepsPerBeat).toBe(4);
      expect(song.stepsPerBar).toBe(16);
      expect(song.loopSteps / 16, `${song.id} loop bars`).toBeGreaterThanOrEqual(16);
      expect(song.loopSteps / 16, `${song.id} loop bars`).toBeLessThanOrEqual(32);
      expect(song.introSteps / 16, `${song.id} intro bars`).toBeGreaterThanOrEqual(1);
      expect(song.introSteps / 16, `${song.id} intro bars`).toBeLessThanOrEqual(2);
    }
  });

  it('keeps every pitched note in a sensible range, even at the boss top gear', () => {
    for (const song of songs) {
      const shift = song.phases ? Math.max(...song.phases.map((p) => p.transpose)) : 0;
      for (const channel of pitched(song)) {
        const bass = /bass/.test(channel.name);
        const [lo, hi] = bass ? [28, 62] : [45, 92];
        for (const text of [channel.intro, channel.loop]) {
          if (text === undefined) continue;
          for (const note of parsePattern(text).notes) {
            const midi = (note.midi as number) + (channel.transpose ?? 0) + shift;
            expect(midi, `${song.id} '${channel.name}' step ${note.at}`).toBeGreaterThanOrEqual(lo);
            expect(midi, `${song.id} '${channel.name}' step ${note.at}`).toBeLessThanOrEqual(hi);
          }
        }
      }
    }
  });

  it('keeps instrument and channel levels in range', () => {
    for (const song of songs) {
      for (const channel of song.channels) {
        const vol = channel.vol ?? 1;
        expect(vol).toBeGreaterThan(0);
        expect(vol).toBeLessThanOrEqual(1);
        if (channel.instrument === 'drums') continue;
        expect(channel.instrument.vol, `${song.id} '${channel.name}'`).toBeGreaterThanOrEqual(0.04);
        expect(channel.instrument.vol, `${song.id} '${channel.name}'`).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it('title: only base and mid layers, with drums, bass and a lead', () => {
    const title = TRACKS.title;
    for (const layer of layersOf(title)) expect(['base', 'mid']).toContain(layer);
    expect(drumsOf(title).length).toBeGreaterThan(0);
    expect(title.channels.some((c) => c.name === 'bass')).toBe(true);
    expect(title.channels.some((c) => c.name === 'lead')).toBe(true);
  });

  it.each([TRACKS.sector1, TRACKS.sector2, TRACKS.sector3].map((s) => [s.id, s] as const))(
    '%s: base stands alone (drums and bass), with mid, high and danger layers',
    (_id, song) => {
      const base = song.channels.filter((c) => c.layer === 'base');
      expect(base.some((c) => c.instrument === 'drums')).toBe(true);
      expect(base.some((c) => c.name === 'bass')).toBe(true);
      for (const layer of ['mid', 'high', 'danger'] as const) expect(layersOf(song).has(layer)).toBe(true);
      expect(layersOf(song).has('phase2')).toBe(false);
      expect(song.phases).toBeUndefined();
    },
  );

  it('sectors 1 and 2 are in different tempos and different music', () => {
    expect(TRACKS.sector1.bpm).not.toBe(TRACKS.sector2.bpm);
    expect(TRACKS.sector1.channels.find((c) => c.name === 'bass')?.loop).not.toBe(
      TRACKS.sector2.channels.find((c) => c.name === 'bass')?.loop,
    );
  });

  it('sector 3 has its own tempo and music, and a heartbeat kick on every half bar', () => {
    const bass = (song: Song) => song.channels.find((c) => c.name === 'bass')?.loop;
    const s3 = TRACKS.sector3;
    for (const other of [TRACKS.sector1, TRACKS.sector2]) {
      expect(s3.bpm).not.toBe(other.bpm);
      expect(bass(s3)).not.toBe(bass(other));
    }
    // Lub (accented) and dub (two steps later), then a rest, in each half of every kick/snare bar.
    const drums = s3.channels.find((c) => c.name === 'drums');
    const hits = parsePattern(drums?.loop ?? '', true).notes;
    for (let bar = 0; bar < s3.loopSteps / s3.stepsPerBar; bar++) {
      for (const half of [0, 8]) {
        const at = bar * s3.stepsPerBar + half;
        expect(hits.find((n) => n.at === at && n.drum === 'k')?.accent, `bar ${bar + 1} lub`).toBe(true);
        expect(hits.some((n) => n.at === at + 2 && n.drum === 'k'), `bar ${bar + 1} dub`).toBe(true);
      }
    }
  });

  it('boss: three phases that speed up and climb, and every layer is used', () => {
    const boss = TRACKS.boss;
    expect(boss.phases).toHaveLength(3);
    const phases = boss.phases ?? [];
    expect(phases[0].bpm).toBe(boss.bpm);
    expect(phases[0].transpose).toBe(0);
    for (let i = 1; i < 3; i++) {
      expect(phases[i].bpm).toBeGreaterThan(phases[i - 1].bpm);
      expect(phases[i].transpose).toBeGreaterThan(phases[i - 1].transpose);
    }
    for (const layer of ['base', 'mid', 'high', 'danger', 'phase2', 'phase3'] as const) {
      expect(layersOf(boss).has(layer), layer).toBe(true);
    }
    const base = boss.channels.filter((c) => c.layer === 'base');
    expect(base.some((c) => c.instrument === 'drums')).toBe(true);
    expect(base.some((c) => c.name === 'bass')).toBe(true);
    expect(base.some((c) => c.name === 'riff')).toBe(true);
  });

  it('heart: its own track, with the boss layers, three phases and a drum kit of its own', () => {
    const heart = TRACKS.heart;
    expect(heart).not.toBe(TRACKS.boss);
    expect(heart.channels.find((c) => c.name === 'bass')?.loop).not.toBe(TRACKS.boss.channels.find((c) => c.name === 'bass')?.loop);
    expect(heart.phases).toHaveLength(3);
    for (const layer of ['base', 'mid', 'high', 'danger', 'phase2', 'phase3'] as const) {
      expect(layersOf(heart).has(layer), layer).toBe(true);
    }
    const base = heart.channels.filter((c) => c.layer === 'base');
    expect(base.some((c) => c.instrument === 'drums')).toBe(true);
    expect(base.some((c) => c.name === 'bass')).toBe(true);
  });

  it('heart: the lub-dub kick lands on every heartbeat, in every phase gear', () => {
    const heart = TRACKS.heart;
    const phases = heart.phases ?? [];
    // Phase 1: half a bar (one lub-dub) lasts exactly one heartbeat.
    const halfBar = heart.stepsPerBar / 2 / heart.stepsPerBeat;
    expect(halfBar * (60 / phases[0].bpm)).toBeCloseTo(HEART_BEAT_SECONDS, 6);
    // Phase 2 beats 0.75 times as far apart (see heart.ts), so the tempo is 1/0.75 times faster.
    expect(phases[1].bpm / phases[0].bpm).toBeCloseTo(1 / 0.75, 6);
    expect(halfBar * (60 / phases[1].bpm)).toBeCloseTo(HEART_BEAT_SECONDS * 0.75, 6);
    // Phase 3 keeps phase 2's tempo and climbs.
    expect(phases[2].bpm).toBe(phases[1].bpm);
    expect(phases[0].transpose).toBe(0);
    expect(phases[2].transpose).toBeGreaterThan(phases[1].transpose);
    // Lub (accented) on the first step of each half bar, dub two steps later, in every bar.
    const drums = heart.channels.find((c) => c.name === 'drums');
    const hits = parsePattern(drums?.loop ?? '', true).notes;
    for (let bar = 0; bar < heart.loopSteps / heart.stepsPerBar; bar++) {
      for (const half of [0, 8]) {
        const at = bar * heart.stepsPerBar + half;
        expect(hits.find((n) => n.at === at && n.drum === 'k')?.accent, `bar ${bar + 1} lub`).toBe(true);
        expect(hits.some((n) => n.at === at + 2 && n.drum === 'k'), `bar ${bar + 1} dub`).toBe(true);
      }
    }
  });
});

/** Length of a stinger in seconds, not counting the release tail. */
function seconds(id: keyof typeof STINGERS): number {
  const s = STINGERS[id];
  const steps = Math.max(...s.channels.map((c) => parsePattern(c.notes, c.instrument === 'drums').steps));
  return (steps / s.stepsPerBeat) * (60 / s.bpm);
}

describe('the stingers', () => {
  it('has all four, each filed under its own id', () => {
    expect(Object.keys(STINGERS).sort()).toEqual(['gameOver', 'upgrade', 'victory', 'waveClear']);
    for (const [id, stinger] of Object.entries(STINGERS)) expect(stinger.id).toBe(id);
  });

  it.each(Object.values(STINGERS).map((s) => [s.id, s] as const))('%s passes validateStinger', (_id, stinger) => {
    expect(validateStinger(stinger)).toEqual([]);
  });

  it('victory and game over end the track; wave clear and upgrade do not', () => {
    expect(STINGERS.victory.ends).toBe(true);
    expect(STINGERS.gameOver.ends).toBe(true);
    expect(STINGERS.waveClear.ends).toBe(false);
    expect(STINGERS.upgrade.ends).toBe(false);
  });

  it('are about the right length', () => {
    expect(seconds('waveClear')).toBeGreaterThanOrEqual(1.2);
    expect(seconds('waveClear')).toBeLessThanOrEqual(1.8);
    expect(seconds('upgrade')).toBeGreaterThanOrEqual(0.8);
    expect(seconds('upgrade')).toBeLessThanOrEqual(1.3);
    expect(seconds('victory')).toBeGreaterThanOrEqual(3.8);
    expect(seconds('victory')).toBeLessThanOrEqual(5);
    expect(seconds('gameOver')).toBeGreaterThanOrEqual(2.6);
    expect(seconds('gameOver')).toBeLessThanOrEqual(3.6);
  });

  it('have channels of equal length, so the parts stay together', () => {
    for (const s of Object.values(STINGERS)) {
      const lengths = s.channels.map((c) => parsePattern(c.notes, c.instrument === 'drums').steps);
      expect(new Set(lengths).size, `${s.id}: ${lengths.join(',')}`).toBe(1);
    }
  });
});
