import { rep } from './pattern';
import type { Song, Stinger, StingerId, TrackId } from './song';

// PLACEHOLDER: one bar of drums per track and a blip per stinger, so the game builds and the
// engine has something to play. The composer replaces this file with the real tracks.

const placeholder = (id: TrackId, bpm: number): Song => ({
  id,
  title: `${id} (placeholder)`,
  bpm,
  stepsPerBeat: 4,
  stepsPerBar: 16,
  introSteps: 0,
  loopSteps: 16,
  channels: [{ name: 'drums', instrument: 'drums', layer: 'base', loop: rep('k . h .', 4) }],
  phases: id === 'boss' ? [{ bpm, transpose: 0 }, { bpm: bpm + 8, transpose: 1 }, { bpm: bpm + 16, transpose: 2 }] : undefined,
});

export const TRACKS: Record<TrackId, Song> = {
  title: placeholder('title', 100),
  sector1: placeholder('sector1', 132),
  sector2: placeholder('sector2', 140),
  boss: placeholder('boss', 150),
};

const blip = (id: StingerId, ends: boolean): Stinger => ({
  id,
  bpm: 120,
  stepsPerBeat: 4,
  ends,
  channels: [
    {
      name: 'lead',
      instrument: { wave: 'square', vol: 0.2, attack: 0.005, decay: 0.1, sustain: 0.5, release: 0.1 },
      notes: 'C5 E5 G5 -',
    },
  ],
});

export const STINGERS: Record<StingerId, Stinger> = {
  waveClear: blip('waveClear', false),
  upgrade: blip('upgrade', false),
  victory: blip('victory', true),
  gameOver: blip('gameOver', true),
};
