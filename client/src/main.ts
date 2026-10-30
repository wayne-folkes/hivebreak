import { inject, pageview } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import './style.css';
import { autopilot } from './app/autopilot';
import { safeStorage } from './app/storage';
import { Sound, loadSoundSettings, saveSoundSettings } from './game/audio';
import { Controls } from './game/controls';
import { GamepadInput } from './game/gamepad';
import { Keyboard } from './game/input';
import { FIELD_WIDTH } from './game/playfield';
import { RECORDS_KEY, addRecord, bestScore, loadRecords } from './game/records';
import { WAVE_INTRO_SECONDS, createRun, pickUpgrade, stepRun } from './game/run';
import { TouchControls } from './game/touch';
import { NO_INPUT } from './game/types';
import type { RunEvent, RunState, ShipInput } from './game/types';
import { stackCount } from './game/upgrades';
import { GameView } from './render/view';
import {
  Banner,
  GameOverCard,
  HowToCard,
  Hud,
  PauseCard,
  RecordsCard,
  SettingsCard,
  TitleCard,
  UpgradeCard,
} from './ui';
import type { MenuCard, RunResult } from './ui';

// The game: the loop that steps the simulation and draws it, the input sources, sound, storage
// and the flow between screens (title, run, upgrade pick, pause, game over). The title plays an
// autopilot demo run behind it, silently.

inject();
injectSpeedInsights();

/** The fixed simulation step, seconds. */
const STEP = 1 / 120;
/** Longest frame the loop will catch up on, seconds. */
const MAX_FRAME = 0.25;
/** How long a finished run plays on before its result card opens, so the last explosion shows. */
const END_DELAY = 1.2;
/** How long a finished demo run lingers before the next one starts, seconds. */
const DEMO_RESTART = 2;

// Page views ---------------------------------------------------------------------------------

/**
 * The URL never changes, so each screen sends its own page view; otherwise every visit is one page
 * view and Web Analytics counts it as a bounce. The page load already counted the title as '/'.
 */
let screenPath = '/';
function screenView(path: string): void {
  if (path === screenPath) return;
  screenPath = path;
  pageview({ route: path, path });
}

// Services -----------------------------------------------------------------------------------

const storage = safeStorage();
const sound = new Sound(loadSoundSettings(storage));
const view = new GameView(document.getElementById('app')!);

const keyboard = new Keyboard();
const gamepad = new GamepadInput();
const touch = new TouchControls(document.body, () => view.fit.width / FIELD_WIDTH);
const controls = new Controls([keyboard, gamepad, touch]);

// Browsers only start audio from a real gesture; a touch's pointerdown isn't one, its end is.
// Asking again is harmless.
for (const type of ['keydown', 'pointerup', 'touchend', 'click']) {
  window.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
}

function saveSound(): void {
  saveSoundSettings(storage, { enabled: sound.enabled, volume: sound.volume });
}

function setSoundOn(on: boolean): void {
  sound.enabled = on;
  saveSound();
  hud.setMuted(!on);
  // M can be pressed with Settings open; its button would keep the old label.
  if (settingsCard.visible) settingsCard.syncSoundLabel();
}

const hud = new Hud(() => setSoundOn(!sound.enabled));
const banner = new Banner();

// Screens ------------------------------------------------------------------------------------

/** A card on the stack, with how to open it (again) and the page view it counts as. */
interface Screen {
  card: MenuCard;
  open(): void;
  path: string;
}

/** The cards in view, bottom first. Only the top one is shown and reads input. */
const stack: Screen[] = [];

function topScreen(): Screen | undefined {
  return stack[stack.length - 1];
}

/** Puts a card on top, hiding the one it covers. */
function enter(screen: Screen): void {
  topScreen()?.card.hide();
  stack.push(screen);
  screen.open();
  screenView(screen.path);
}

/** Closes the top card and shows the one under it again. */
function leave(): void {
  const closed = stack.pop();
  closed?.card.hide();
  // Keys and the d-pad move the volume slider without a 'change' event; save as the card closes.
  if (closed === settingsScreen) saveSound();
  const below = topScreen();
  if (!below) return;
  below.open();
  screenView(below.path);
}

function clearStack(): void {
  for (const s of stack) s.card.hide();
  stack.length = 0;
}

// Run state ----------------------------------------------------------------------------------

type Mode = 'title' | 'playing' | 'pick' | 'over';

/** `title`: the demo plays behind the title and its menus. `playing`: a real run, including the pause menu. */
let mode: Mode = 'title';
let run: RunState = createRun(1);
let paused = false;
let accumulator = 0;
/** Touch drag read since the last sim step; handed to the next step that runs (see ShipInput.drag). */
let carry = 0;
/** Events from outside the loop (a tapped upgrade), played with the next frame's. */
let pending: RunEvent[] = [];
let lostReason: 'lives' | 'invaded' | undefined;
/** Where the finished run landed in the records, once saved; null until then. */
let savedRank: number | null = null;
let lastResult: RunResult | null = null;

const demo = (): boolean => mode === 'title';
/** The ship answers the player: a real run, not paused and not behind a card. */
const live = (): boolean => mode === 'playing' && !paused;

function newRun(seed: number): void {
  run = createRun(seed);
  accumulator = 0;
  carry = 0;
  lostReason = undefined;
  savedRank = null;
  view.reset();
  view.stepped(run);
}

function showTitle(): void {
  // Quitting during the moment before the result card still counts the run.
  if (mode !== 'title' && (run.phase === 'won' || run.phase === 'lost')) saveRun();
  mode = 'title';
  paused = false;
  clearStack();
  banner.hide();
  hud.setVisible(false);
  newRun(Date.now());
  enter(titleScreen);
}

function startRun(): void {
  clearStack();
  mode = 'playing';
  paused = false;
  newRun(Date.now());
  hud.setBest(bestScore(storage));
  hud.setVisible(true);
  hud.update(run);
  controls.holdFireUntilReleased();
  screenView('/play');
}

function pauseRun(): void {
  paused = true;
  accumulator = 0;
  carry = 0;
  banner.hide();
  enter(pauseScreen);
}

function resumeRun(): void {
  paused = false;
  accumulator = 0;
  carry = 0;
  clearStack();
  controls.holdFireUntilReleased();
  // The wave banner was cut short by the pause; show what is left of it.
  if (run.phase === 'waveIntro') banner.show(`WAVE ${run.wave + 1}`, Math.max(0.3, WAVE_INTRO_SECONDS - run.phaseTime));
  screenView('/play');
}

function openPick(): void {
  mode = 'pick';
  enter(pickScreen);
}

function takeUpgrade(index: number): void {
  if (mode !== 'pick') return;
  pending.push(...pickUpgrade(run, index));
  mode = 'playing';
  leave();
  controls.holdFireUntilReleased();
  screenView('/play');
}

/** Saves the finished run to the records, once. Returns its place in the top 10 (0 is best, -1 if it missed). */
function saveRun(): number {
  if (savedRank !== null) return savedRank;
  const { rank } = addRecord(storage, {
    score: run.score,
    wave: run.wave + 1,
    bestCombo: run.bestCombo,
    won: run.phase === 'won',
    date: new Date().toISOString(),
  });
  savedRank = rank;
  hud.setBest(bestScore(storage));
  return rank;
}

/** The run is over and its last moments have played: save it and show the result. */
function finishRun(): void {
  const rank = saveRun();
  lastResult = {
    won: run.phase === 'won',
    reason: lostReason,
    score: run.score,
    wave: run.wave + 1,
    bestCombo: run.bestCombo,
    rank,
  };
  mode = 'over';
  carry = 0;
  banner.hide();
  enter(overScreen);
}

// Cards --------------------------------------------------------------------------------------

const titleCard = new TitleCard(
  {
    start: startRun,
    howToPlay: () => enter(howtoScreen),
    settings: () => enter(settingsScreen),
    records: () => enter(recordsScreen),
  },
  () => bestScore(storage),
);
const howtoCard = new HowToCard(leave);
const settingsCard = new SettingsCard(
  {
    getSound: () => sound.enabled,
    setSound: setSoundOn,
    getVolume: () => sound.volume,
    // Applied live as the slider moves; saved when it is let go (see the 'change' listener below).
    setVolume: (volume) => {
      sound.volume = volume;
    },
    resetRecords: () => {
      storage.setItem(RECORDS_KEY, '[]');
      hud.setBest(0);
    },
  },
  leave,
);
document.getElementById('settings-volume')?.addEventListener('change', saveSound);
const recordsCard = new RecordsCard(() => loadRecords(storage), leave);
const pauseCard = new PauseCard({ resume: resumeRun, settings: () => enter(settingsScreen), quit: showTitle });
const upgradeCard = new UpgradeCard(takeUpgrade);
const overCard = new GameOverCard({ playAgain: startRun, title: showTitle });

const titleScreen: Screen = { card: titleCard, open: () => titleCard.show(), path: '/' };
const howtoScreen: Screen = { card: howtoCard, open: () => howtoCard.show(), path: '/howto' };
const settingsScreen: Screen = { card: settingsCard, open: () => settingsCard.show(), path: '/settings' };
const recordsScreen: Screen = { card: recordsCard, open: () => recordsCard.show(), path: '/records' };
const pauseScreen: Screen = { card: pauseCard, open: () => pauseCard.show(), path: '/paused' };
const pickScreen: Screen = {
  card: upgradeCard,
  open: () => upgradeCard.show(run.offer, run.wave + 1, (id) => stackCount(run.players[0], id)),
  path: '/pick',
};
const overScreen: Screen = {
  card: overCard,
  open: () => {
    if (lastResult) overCard.show(lastResult);
  },
  path: '/over',
};

// Input --------------------------------------------------------------------------------------

/** Esc, P, Start or the touch pause button: backs out of a card, resumes, or pauses a live run. */
function pressPause(): void {
  const top = topScreen();
  if (!top) {
    if (live()) pauseRun();
    return;
  }
  if (top.card.dismiss()) {
    sound.ui('back');
    return;
  }
  if (top === pauseScreen) {
    sound.ui('back');
    resumeRun();
  } else if (top === howtoScreen || top === settingsScreen || top === recordsScreen) {
    sound.ui('back');
    leave();
  }
  // The title, the upgrade pick and the result card have nothing to go back to.
}

function handleInput(): void {
  if (controls.pressed('mute')) setSoundOn(!sound.enabled);
  if (controls.pressed('pause')) {
    pressPause();
    return;
  }
  const top = topScreen();
  if (!top) return;
  if (controls.pressed('confirm')) sound.ui('confirm');
  else if (controls.pressed('up') || controls.pressed('down') || controls.pressed('left') || controls.pressed('right')) {
    sound.ui('move');
  }
  top.card.handle(controls);
}

// Taps and clicks on a menu button sound like a confirm. (A key press that clicks a button has
// no click count and already played its own sound.)
document.addEventListener('click', (e) => {
  if (e.detail > 0 && (e.target as Element).closest('.menu button, .menu a')) sound.ui('confirm');
});

// A hidden tab stops animating anyway; stop the run too, so it is waiting when the player comes back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && live() && !topScreen()) pauseRun();
});

// Layout -------------------------------------------------------------------------------------

function layout(): void {
  view.layout();
  hud.layout(view.fit);
  banner.layout(view.fit);
}
window.addEventListener('resize', layout);

// The loop -----------------------------------------------------------------------------------

/** What the real run reacts to besides sound: the wave banner, rumble, and why the run was lost. */
function reactTo(events: readonly RunEvent[]): void {
  for (const e of events) {
    if (e.type === 'waveStart') banner.show(`WAVE ${e.wave + 1}`, WAVE_INTRO_SECONDS);
    else if (e.type === 'playerHit') controls.rumble(0.8, 250);
    else if (e.type === 'shieldHit') controls.rumble(0.3, 120);
    else if (e.type === 'lost') lostReason = e.reason;
  }
}

let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  // rAF timestamps can be a little earlier than performance.now(), so the gap can be negative.
  const frameDt = Math.max(0, Math.min((now - last) / 1000, MAX_FRAME));
  last = now;

  controls.poll();
  // Gamepad buttons don't count as the interaction browsers need to start audio, but a key or tap
  // earlier will have; keep asking while a pad is in use.
  if (controls.lastUsed === 'gamepad' && controls.used()) sound.unlock();
  handleInput();
  touch.setVisible(live());
  // Read exactly once per frame: reading drains the touch drag.
  const ship = controls.shipInput();
  controls.endFrame();
  if (live()) carry += ship.drag;

  const events = pending;
  pending = [];
  const idle = paused;
  if (!idle) {
    accumulator += frameDt;
    const inputs: ShipInput[] = [NO_INPUT];
    while (accumulator >= STEP) {
      if (demo()) inputs[0] = autopilot(run);
      else if (live()) {
        inputs[0] = { move: ship.move, drag: carry, fire: ship.fire, special: false };
        carry = 0;
      } else inputs[0] = NO_INPUT;
      events.push(...stepRun(run, inputs, STEP));
      view.stepped(run);
      accumulator -= STEP;
    }
  }

  if (demo()) {
    if (run.phase === 'upgradePick') events.push(...pickUpgrade(run, 0));
    else if ((run.phase === 'won' || run.phase === 'lost') && run.phaseTime > DEMO_RESTART) newRun(Date.now());
  } else {
    reactTo(events);
    sound.handle(events);
    if (mode === 'playing' && !paused) {
      if (run.phase === 'upgradePick') openPick();
      else if ((run.phase === 'won' || run.phase === 'lost') && run.phaseTime >= END_DELAY) finishRun();
    }
    hud.update(run);
  }

  // Paused, the picture and its effects stand still.
  view.render(run, events, idle ? 1 : accumulator / STEP, idle ? 0 : frameDt);
}

async function start(): Promise<void> {
  await view.load();
  layout();
  hud.setMuted(!sound.enabled);
  hud.setBest(bestScore(storage));
  showTitle();
  last = performance.now();
  requestAnimationFrame(frame);
}

/** The models failed to load (offline, say): say so, instead of leaving a black screen. */
function showLoadError(error: unknown): void {
  console.error(error);
  const menu = document.createElement('div');
  menu.className = 'menu';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'alert');
  const text = document.createElement('p');
  text.className = 'text';
  text.textContent = "Couldn't load the game. Check your connection and reload.";
  panel.append(text);
  menu.append(panel);
  document.body.append(menu);
}

start().catch(showLoadError);
