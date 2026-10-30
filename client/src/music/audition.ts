// A dev-only audition page for the soundtrack (open /music.html under `npm run dev`). It isn't
// part of the production build: only index.html is built.
import { Music } from './music';
import type { StingerId, TrackId } from './song';
import { STINGERS, TRACKS } from './tracks';

const music = new Music({ enabled: true, volume: 0.6 });
let ctx: AudioContext | null = null;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const status = $('status');
const say = (text: string) => {
  status.textContent = text;
};

/** A row of toggle buttons where one is pressed at a time. */
function choices<T>(container: string, items: [string, T][], pick: (value: T) => void, initial = 0): void {
  const buttons = items.map(([label, value], i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(i === initial));
    button.addEventListener('click', () => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      pick(value);
    });
    $(container).append(button);
    return button;
  });
}

/** A row of one-shot buttons. */
function actions(container: string, items: [string, () => void][]): void {
  for (const [label, run] of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', run);
    $(container).append(button);
  }
}

function ensureAudio(): boolean {
  if (ctx) return true;
  say('Press "Start audio" first.');
  return false;
}

$('start').addEventListener('click', async () => {
  if (!ctx) {
    ctx = new AudioContext();
    music.attach(ctx);
  }
  await ctx.resume();
  say(`Audio running (${ctx.sampleRate} Hz).`);
});

$('stop').addEventListener('click', () => {
  music.play(null);
  say('Stopped.');
});

const volume = $<HTMLInputElement>('volume');
const showVolume = () => {
  music.volume = Number(volume.value) / 100;
  $('volume-value').textContent = `${volume.value}%`;
};
volume.addEventListener('input', showVolume);
showVolume();

actions(
  'tracks',
  (Object.keys(TRACKS) as TrackId[]).map((id) => [
    `${TRACKS[id].title} (${TRACKS[id].bpm} bpm)`,
    () => {
      if (!ensureAudio()) return;
      music.play(id);
      say(`Playing ${id}: ${TRACKS[id].bpm} bpm, ${TRACKS[id].loopSteps / TRACKS[id].stepsPerBar} bar loop.`);
    },
  ]),
);

actions(
  'stingers',
  (Object.keys(STINGERS) as StingerId[]).map((id) => [
    `${id}${STINGERS[id].ends ? ' (ends the track)' : ''}`,
    () => {
      if (!ensureAudio()) return;
      music.stinger(id);
      say(`Stinger ${id}.`);
    },
  ]),
);

choices(
  'intensity',
  [['0', 0], ['0.4', 0.4], ['0.8', 0.8]],
  (level) => music.setIntensity(level),
);
choices(
  'danger',
  [['Danger off', false], ['Danger on', true]],
  (on) => music.setDanger(on),
);
choices(
  'phase',
  [['Phase 1', 1], ['Phase 2', 2], ['Phase 3', 3]],
  (phase) => music.setBossPhase(phase),
);
choices(
  'scale',
  [['1 (normal)', 1], ['0.5 (Slow)', 0.5], ['0.25 (Time Stop)', 0.25]],
  (scale) => music.setTimeScale(scale),
);
choices(
  'pause',
  [['Not paused', false], ['Paused', true]],
  (paused) => music.setPaused(paused),
);

$('duck').addEventListener('click', () => {
  music.duck(2);
  say('Ducked for 2 s.');
});
