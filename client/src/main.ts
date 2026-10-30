import { inject, pageview } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import './style.css';
import { autopilot } from './app/autopilot';
import { duckFor, musicState, stingerFor } from './app/director';
import type { Mode } from './app/director';
import { safeStorage } from './app/storage';
import { Sound, loadMusicSettings, loadSoundSettings, saveMusicSettings, saveSoundSettings } from './game/audio';
import { Controls } from './game/controls';
import { GamepadInput } from './game/gamepad';
import { Keyboard } from './game/input';
import { FIELD_WIDTH } from './game/playfield';
import { RECORDS_KEY, addRecord, bestScore, loadRecords } from './game/records';
import { WAVE_COUNT, WAVE_INTRO_SECONDS, chooseSpecial, createRun, pickUpgrade, stepRun } from './game/run';
import { TouchControls } from './game/touch';
import { NO_INPUT } from './game/types';
import type { RunEvent, RunState, ShipInput, SpecialId } from './game/types';
import { SPECIAL_IDS } from './game/special';
import { completesSynergy } from './game/synergies';
import { stackCount } from './game/upgrades';
import { WAVES } from './game/waves';
import { Music } from './music/music';
import { GameView } from './render/view';
import {
  Banner,
  GameOverCard,
  HowToCard,
  Hud,
  PauseCard,
  RecordsCard,
  SettingsCard,
  SpecialCard,
  TitleCard,
  UpgradeCard,
  bossDownHeading,
} from './ui';
import type { MenuCard, RunResult } from './ui';

// The game: the loop that steps the simulation and draws it, the input sources, sound, storage
// and the flow between screens (title, Special choice, run, upgrade pick, pause, game over). The title plays an
// autopilot demo run behind it, silently. Music follows the screen and the run: every frame the
// director (app/director.ts) says which track, how intense, and so on, and the real run's events
// become stingers and ducks. The music attaches to the sound effects' audio context on the same
// gesture that unlocks it.

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
const music = new Music(loadMusicSettings(storage));
music.soundOn = sound.enabled;
const view = new GameView(document.getElementById('app')!);

const keyboard = new Keyboard();
const gamepad = new GamepadInput();
const touch = new TouchControls(document.body, () => view.fit.width / FIELD_WIDTH);
const controls = new Controls([keyboard, gamepad, touch]);

// Browsers only start audio from a real gesture; a touch's pointerdown isn't one, its end is.
// Asking again is harmless.
// The music plays through the same audio context; attaching again with the same context is harmless.
function unlockAudio(): void {
  sound.unlock();
  if (sound.context) music.attach(sound.context);
}
for (const type of ['keydown', 'pointerup', 'touchend', 'click']) {
  window.addEventListener(type, unlockAudio, { capture: true, passive: true });
}

function saveSound(): void {
  saveSoundSettings(storage, { enabled: sound.enabled, volume: sound.volume });
}

function saveMusic(): void {
  saveMusicSettings(storage, { enabled: music.enabled, volume: music.volume });
}

function setSoundOn(on: boolean): void {
  sound.enabled = on;
  music.soundOn = on;
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
  // Keys and the d-pad move the volume sliders without a 'change' event; save as the card closes.
  if (closed === settingsScreen) {
    saveSound();
    saveMusic();
  }
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

/**
 * `title`: the demo plays behind the title and its menus. `special`: a real run waiting on the
 * Special card. `playing`: a real run, including the pause menu.
 */
let mode: Mode = 'title';
let run: RunState = createRun(1);
let paused = false;
let accumulator = 0;
/** Touch drag read since the last sim step; handed to the next step that runs (see ShipInput.drag). */
let carry = 0;
/**
 * A Special press read since a `playing` step last ran; handed to the next steps until one of
 * them has used it (the wave intro ignores it), then cleared. Pressing with the meter not full
 * is simply consumed there.
 */
let specialCarry = false;
/** Events from outside the loop (a tapped upgrade), played with the next frame's. */
let pending: RunEvent[] = [];
let lostReason: 'lives' | 'invaded' | undefined;
/** Where the finished run landed in the records, once saved; null until then. */
let savedRank: number | null = null;
let lastResult: RunResult | null = null;

const demo = (): boolean => mode === 'title';
/** The ship answers the player: a real run, not paused and not behind a card. */
const live = (): boolean => mode === 'playing' && !paused;

/**
 * Dev server only, for testing: `?wave=5` starts real runs at that wave (1-based), and
 * `?charged` starts them with a full Special meter. Production builds drop both.
 */
const DEV_PARAMS = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
const DEV_WAVE = Number(DEV_PARAMS?.get('wave'));
const DEV_FIRST_WAVE = Number.isFinite(DEV_WAVE) && DEV_WAVE >= 1 ? DEV_WAVE - 1 : 0;
const DEV_CHARGED = DEV_PARAMS?.has('charged') ?? false;

function newRun(seed: number): void {
  run = createRun(seed, 1, mode === 'title' ? 0 : DEV_FIRST_WAVE);
  // The title demo picks its Special itself, silently; a real run waits for the Special card.
  if (demo()) chooseSpecial(run, SPECIAL_IDS[seed % SPECIAL_IDS.length]);
  accumulator = 0;
  carry = 0;
  specialCarry = false;
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

/** Starts a real run: it opens on the Special card, and the wave intro begins once one is picked. */
function startRun(): void {
  clearStack();
  mode = 'special';
  paused = false;
  newRun(Date.now());
  hud.setBest(bestScore(storage));
  hud.setVisible(true);
  hud.update(run, controls.lastUsed);
  controls.holdFireUntilReleased();
  enter(specialScreen);
}

function takeSpecial(special: SpecialId): void {
  if (mode !== 'special') return;
  pending.push(...chooseSpecial(run, special));
  // Choosing resets the meter, so the dev `?charged` fill comes after it.
  if (DEV_CHARGED) for (const p of run.players) p.specialCharge = 1;
  mode = 'playing';
  leave();
  controls.holdFireUntilReleased();
  screenView('/play');
}

function pauseRun(): void {
  paused = true;
  accumulator = 0;
  carry = 0;
  specialCarry = false;
  banner.hide();
  enter(pauseScreen);
}

/** The wave whose intro announced a sector, so a resumed intro shows the same banner. */
let sectorWave = -1;

function resumeRun(): void {
  paused = false;
  accumulator = 0;
  carry = 0;
  specialCarry = false;
  clearStack();
  controls.holdFireUntilReleased();
  // The wave banner was cut short by the pause; show what is left of it.
  if (run.phase === 'waveIntro') {
    const seconds = Math.max(0.3, WAVE_INTRO_SECONDS - run.phaseTime);
    // A wave that opened a sector (the sim's sectorStart, which also covers a run that starts
    // mid-sector) got the sector banner, not the plain one.
    if (run.wave !== sectorWave || !banner.sector(WAVES[run.wave].sector, seconds, run.wave + 1)) banner.show(`WAVE ${run.wave + 1}`, seconds);
  }
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
  specialCarry = false;
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
    waves: WAVE_COUNT,
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
  specialCarry = false;
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
    getMusic: () => music.enabled,
    setMusic: (on) => {
      music.enabled = on;
      saveMusic();
    },
    getMusicVolume: () => music.volume,
    // Saved on the slider's 'change' event and when the card closes, like the sound volume.
    setMusicVolume: (volume) => {
      music.volume = volume;
    },
    resetRecords: () => {
      storage.setItem(RECORDS_KEY, '[]');
      hud.setBest(0);
    },
  },
  leave,
);
document.getElementById('settings-volume')?.addEventListener('change', saveSound);
document.getElementById('settings-music-volume')?.addEventListener('change', saveMusic);
const recordsCard = new RecordsCard(() => loadRecords(storage), leave);
const pauseCard = new PauseCard({ resume: resumeRun, settings: () => enter(settingsScreen), quit: showTitle });
const specialCard = new SpecialCard(takeSpecial);
const upgradeCard = new UpgradeCard(takeUpgrade);
const overCard = new GameOverCard({ playAgain: startRun, title: showTitle });

const titleScreen: Screen = { card: titleCard, open: () => titleCard.show(), path: '/' };
const howtoScreen: Screen = { card: howtoCard, open: () => howtoCard.show(), path: '/howto' };
const settingsScreen: Screen = { card: settingsCard, open: () => settingsCard.show(), path: '/settings' };
const recordsScreen: Screen = { card: recordsCard, open: () => recordsCard.show(), path: '/records' };
const pauseScreen: Screen = { card: pauseCard, open: () => pauseCard.show(), path: '/paused' };
const specialScreen: Screen = { card: specialCard, open: () => specialCard.show(), path: '/special' };
const pickScreen: Screen = {
  card: upgradeCard,
  open: () => {
    const player = run.players[0];
    // run.boss is only set on a boss wave, and stays until the next wave starts.
    upgradeCard.show(run.offer, run.wave + 1, (id) => stackCount(player, id), {
      ...(run.boss ? { heading: bossDownHeading(run.boss.kind) } : {}),
      completes: (id) => completesSynergy(player, id),
    });
  },
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
  } else if (top === specialScreen) {
    // Backing out before a Special is chosen abandons the run; nothing has been played yet.
    sound.ui('back');
    showTitle();
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
  touch.layout(view.fit);
}
window.addEventListener('resize', layout);

// The loop -----------------------------------------------------------------------------------

/** What the real run reacts to besides sound: the wave banner, rumble, the synergy toast, and why the run was lost. */
function reactTo(events: readonly RunEvent[]): void {
  // A sector's first wave gets the sector banner; its waveStart comes right after in the same
  // step and must not overwrite it. Sector 1 has no banner, so its first wave shows the plain one.
  let sectorBanner = false;
  for (const e of events) {
    if (e.type === 'sectorStart') {
      sectorWave = run.wave;
      sectorBanner = banner.sector(e.sector, WAVE_INTRO_SECONDS, run.wave + 1);
    }
    else if (e.type === 'waveStart') {
      if (!sectorBanner) banner.show(`WAVE ${e.wave + 1}`, WAVE_INTRO_SECONDS);
      sectorBanner = false;
    }
    else if (e.type === 'playerHit') controls.rumble(0.8, 250);
    else if (e.type === 'shieldHit') controls.rumble(0.3, 120);
    else if (e.type === 'bossKilled') controls.rumble(1, 500);
    else if (e.type === 'specialFired') controls.rumble(0.6, 200);
    else if (e.type === 'bossPartDestroyed') controls.rumble(0.4, 150);
    else if (e.type === 'bossBeam' && e.state === 'fire') controls.rumble(0.2, 80);
    else if (e.type === 'synergyUnlocked') hud.synergyUnlocked(e.synergy);
    else if (e.type === 'lost') lostReason = e.reason;
  }
}

/** The real run's stingers and ducks. Stingers go first so an ending one finds the track still playing. */
function scoreEvents(events: readonly RunEvent[]): void {
  for (const e of events) {
    const stinger = stingerFor(e);
    if (stinger) music.stinger(stinger);
    const duck = duckFor(e);
    if (duck) music.duck(duck.seconds, duck.depth);
  }
}

/** Steers the music from the screen and the run, every frame; each call is a no-op when nothing changed. */
function conductMusic(): void {
  const state = musicState(mode, run);
  music.play(state.track);
  music.setIntensity(state.intensity);
  music.setDanger(state.danger);
  music.setBossPhase(state.bossPhase);
  music.setTimeScale(state.timeScale);
  music.setPaused(paused && mode === 'playing');
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
  if (controls.lastUsed === 'gamepad' && controls.used()) unlockAudio();
  handleInput();
  // Special is read like any action, and only from a live run: cards never see it, so it can't
  // double as a menu button.
  if (live() && controls.pressed('special')) specialCarry = true;
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
        inputs[0] = { move: ship.move, drag: carry, fire: ship.fire, special: specialCarry };
        carry = 0;
      } else inputs[0] = NO_INPUT;
      // The wave intro ignores the press, so keep it until a playing step has had it.
      const consumes = live() && run.phase === 'playing';
      events.push(...stepRun(run, inputs, STEP));
      if (consumes) specialCarry = false;
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
    scoreEvents(events);
    if (mode === 'playing' && !paused) {
      if (run.phase === 'upgradePick') openPick();
      else if ((run.phase === 'won' || run.phase === 'lost') && run.phaseTime >= END_DELAY) finishRun();
    }
    hud.update(run, controls.lastUsed);
    const player = run.players[0];
    touch.setSpecial(player.special === null ? null : player.specialCharge);
  }

  // The demo behind the title has no stingers, but the title track follows the mode below.
  conductMusic();

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
