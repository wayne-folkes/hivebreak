import { homedir } from 'node:os';
import { autopilot } from '../src/app/autopilot';
import { loadLastShip, saveLastShip } from '../src/app/lastship';
import { RunLog } from '../src/app/runlog';
import {
  MILESTONES,
  bossRushUnlocked,
  emptyProgress,
  exportCode,
  importCode,
  loadProgress,
  saveProgress,
  unlockedShips,
  unlockedUpgrades,
} from '../src/game/progress';
import type { MilestoneDef, Progress } from '../src/game/progress';
import { RECORDS_KEY, addRecord, bestScore, loadRecords } from '../src/game/records';
import { WAVE_COUNT, chooseSpecial, createRun, pickUpgrade, rushBossesBeaten, stepRun } from '../src/game/run';
import { RUSH_RECORDS_KEY, addRushRecord, bestRushScore, loadRushRecords } from '../src/game/rushrecords';
import { SPECIAL_IDS } from '../src/game/special';
import { NO_INPUT } from '../src/game/types';
import type { RunEvent, RunMode, RunState, ShipId, ShipInput, SpecialId } from '../src/game/types';
import { FieldView } from './draw';
import { fileStorage, savePath } from './filestore';
import { Frame, encode } from './frame';
import { FOCUS_OFF, FOCUS_ON, KITTY_POP, KITTY_PUSH, KITTY_QUERY, KeyParser, KeyState, actionsFor } from './keys';
import type { KeyEvent, KeyMode } from './keys';
import { MIN_COLS, MIN_ROWS, computeLayout } from './layout';
import {
  backupMenu,
  drawTooSmall,
  gameOverMenu,
  howToMenu,
  pauseMenu,
  recordsMenu,
  shipMenu,
  specialMenu,
  titleMenu,
  unlockedMenu,
  unlocksMenu,
  upgradeMenu,
} from './menus';
import type { Menu, RunResult } from './menus';
import { clipboardSequence, colorModeFrom, openTerminal } from './term';

// Hivebreak in a terminal: the same simulation as the web game (src/game), drawn with half-block
// characters and played on the keyboard. This file is the loop and the flow between screens,
// mirroring src/main.ts: title (with the autopilot demo behind it), ship choice, Special choice,
// the run, upgrade picks, pause, the UNLOCKED moment and game over. Progress, records and the
// last ship are saved to a JSON file under the same keys the web game uses, so a backup code moves
// unlocks either way. There is no sound.
//
// Boss Rush (unlocked by the first win) goes through the same cards, with the rush's three starting
// picks as upgrade cards before the bosses; it has its own records and does not count towards the
// unlocks (no RunLog is started for it).

/** The fixed simulation step, seconds (as in the web game). */
const STEP = 1 / 120;
/** Longest frame the loop will catch up on, seconds. */
const MAX_FRAME = 0.25;
/** How long a finished run plays on before its result card opens, so the last explosion shows. */
const END_DELAY = 1.2;
/** How long a finished demo run lingers before the next one starts, seconds. */
const DEMO_RESTART = 2;
/** Milliseconds between frames: 60 a second. */
const FRAME_MS = 1000 / 60;
/** How long to wait for the rest of an escape sequence before a lone ESC counts as the Escape key. */
const ESC_WAIT_MS = 30;
/** How long to wait for the terminal to answer the kitty keyboard query. */
const KITTY_WAIT_MS = 400;

const USAGE = `Hivebreak: an arcade shooter for the terminal.

Usage: hivebreak [options]

  --keys repeat|release  Force how keys are read (default: detected)
  --wave N               Start runs at wave N (testing)
  --charged              Start runs with a full Special meter (testing)
  --unlock-all           Everything unlocked; progress is not saved (testing)
  --rush                 Open straight onto a Boss Rush's ship card (testing; implies --unlock-all)
  -h, --help             Show this help

Saves go to ~/.hivebreak/save.json (or $HIVEBREAK_HOME/save.json).
Set HIVEBREAK_COLOR=256 if colours look wrong.`;

// Options --------------------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

function option(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const OPT_WAVE = Number(option('--wave'));
const FIRST_WAVE = Number.isInteger(OPT_WAVE) && OPT_WAVE >= 1 && OPT_WAVE <= WAVE_COUNT ? OPT_WAVE - 1 : 0;
const CHARGED = args.includes('--charged');
const RUSH = args.includes('--rush');
const UNLOCK_ALL = args.includes('--unlock-all') || RUSH;
const FORCED_KEYS = option('--keys');
const forcedMode: KeyMode | null = FORCED_KEYS === 'repeat' || FORCED_KEYS === 'release' ? FORCED_KEYS : null;

// Services -------------------------------------------------------------------------------------

const storage = fileStorage(savePath(process.env, homedir()));
const term = ((): ReturnType<typeof openTerminal> => {
  try {
    return openTerminal();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
const colorMode = colorModeFrom(process.env);
const parser = new KeyParser();
const keys = new KeyState(forcedMode ?? 'repeat');
const view = new FieldView();

// Focus reports: switching away loses the key releases, so the keys are let go and the run pauses.
term.write(FOCUS_ON);
term.setRestorePrefix(FOCUS_OFF);

// Kitty keyboard protocol: ask, and switch to exact key releases if the terminal answers. A
// terminal without it answers only the device-attributes query that follows, or nothing at all.
let kittyAsked = false;
if (forcedMode !== 'repeat') {
  kittyAsked = true;
  term.write(KITTY_QUERY);
  setTimeout(() => {
    kittyAsked = false;
  }, KITTY_WAIT_MS);
}

function onReply(e: KeyEvent): void {
  if (!kittyAsked) return;
  if (e.text === 'kitty') {
    term.write(KITTY_PUSH);
    term.setRestorePrefix(KITTY_POP + FOCUS_OFF);
    keys.mode = 'release';
    keys.releaseAll();
  }
  // The DA answer comes after the kitty one, so either way the question is settled.
  kittyAsked = false;
}

// Screens --------------------------------------------------------------------------------------

/** A card on the stack. `kind` lets Esc and the loop know which card it is. */
interface Screen {
  kind: 'title' | 'howto' | 'records' | 'unlocks' | 'backup' | 'ship' | 'special' | 'pick' | 'pause' | 'unlocked' | 'over';
  menu: Menu;
}

/** The cards in view, bottom first. Only the top one is drawn and reads keys. */
const stack: Screen[] = [];
const top = (): Screen | undefined => stack[stack.length - 1];

function enter(screen: Screen): void {
  stack.push(screen);
  // A key held as a card opens (fire, say) mustn't carry on into play when it closes.
  keys.releaseAll();
}

function leave(): void {
  stack.pop();
  keys.releaseAll();
}

// Run state ------------------------------------------------------------------------------------

type Mode = 'title' | 'special' | 'playing' | 'pick' | 'over';
let mode: Mode = 'title';
let runShip: ShipId = 'breaker';
/** What kind of real run is being set up or played; the title demo is always a normal run. */
let runMode: RunMode = 'normal';
let run: RunState = createRun(1);
let paused = false;
let accumulator = 0;
/** A Special press, kept until a `playing` step has used it (see src/main.ts). */
let specialCarry = false;
/** Fire without holding a key, toggled with F. */
let autofire = false;
/** Events from outside the loop (a picked upgrade), played with the next frame's. */
let pending: RunEvent[] = [];
let lostReason: 'lives' | 'invaded' | undefined;
/** Boss Rush: the time bonus of the boss just beaten, for the pick card; null when it came in over par. */
let rushBonus: number | null = null;
let savedRank: number | null = null;
let lastResult: RunResult | null = null;
let lastMet: readonly MilestoneDef[] = [];

const demo = (): boolean => mode === 'title';
const live = (): boolean => mode === 'playing' && !paused && stack.length === 0;

let progress: Progress = UNLOCK_ALL ? { ...emptyProgress(), milestones: MILESTONES.map((m) => m.id) } : loadProgress(storage);
const runLog = new RunLog();

function setProgress(next: Progress): void {
  progress = next;
  if (!UNLOCK_ALL) saveProgress(storage, next);
}

/** Ends the recorded run if there is one, saving the progress; returns the milestones it met. */
function settleRun(): readonly MilestoneDef[] {
  const ended = runLog.end(progress);
  if (!ended) return [];
  setProgress(ended.progress);
  return ended.met;
}

function newRun(seed: number): void {
  run = demo()
    ? createRun(seed, 1, 0)
    : createRun(seed, 1, FIRST_WAVE, { mode: runMode, ships: [runShip], upgrades: unlockedUpgrades(progress) });
  if (demo()) chooseSpecial(run, SPECIAL_IDS[seed % SPECIAL_IDS.length]);
  accumulator = 0;
  specialCarry = false;
  lostReason = undefined;
  rushBonus = null;
  savedRank = null;
  view.reset();
}

function showTitle(): void {
  if (mode !== 'title' && (run.phase === 'won' || run.phase === 'lost')) saveRun();
  settleRun();
  mode = 'title';
  paused = false;
  stack.length = 0;
  newRun(Date.now());
  enter(titleScreen);
}

function startRun(kind: RunMode = 'normal'): void {
  // Boss Rush is dimmed on the title while locked, but a stale call shouldn't get past it.
  if (kind === 'bossRush' && !bossRushUnlocked(progress)) return;
  settleRun();
  stack.length = 0;
  const ships = unlockedShips(progress);
  runShip = loadLastShip(storage, progress) ?? ships[0];
  runMode = kind;
  mode = 'special';
  paused = false;
  newRun(Date.now());
  if (ships.length > 1) enter({ kind: 'ship', menu: shipMenu(progress, runShip, takeShip, showTitle) });
  else openSpecial();
}

function openSpecial(): void {
  // Back goes to the ship card when it is underneath, else to the title.
  const back = (): void => {
    if (stack.length > 1) leave();
    else showTitle();
  };
  enter({ kind: 'special', menu: specialMenu(progress, takeSpecial, back) });
}

function takeShip(ship: ShipId): void {
  if (mode !== 'special' || top()?.kind !== 'ship') return;
  saveLastShip(storage, ship);
  if (ship !== runShip) {
    runShip = ship;
    newRun(Date.now());
  }
  openSpecial();
}

function takeSpecial(special: SpecialId): void {
  if (mode !== 'special' || top()?.kind !== 'special') return;
  pending.push(...chooseSpecial(run, special));
  if (CHARGED) for (const p of run.players) p.specialCharge = 1;
  // A Boss Rush is not recorded for the unlocks: it plays only the bosses, so its totals and
  // milestones (waves cleared, kills, sector reached) would not mean what a normal run's do.
  if (run.mode === 'normal') runLog.start(runShip, special);
  mode = 'playing';
  stack.length = 0;
  keys.releaseAll();
}

function pauseRun(): void {
  paused = true;
  accumulator = 0;
  specialCarry = false;
  enter({ kind: 'pause', menu: pauseMenu({ resume: resumeRun, howTo: () => enter(howToScreen()), quit: showTitle }) });
}

function resumeRun(): void {
  paused = false;
  accumulator = 0;
  specialCarry = false;
  stack.length = 0;
  keys.releaseAll();
}

function openPick(): void {
  mode = 'pick';
  // The time bonus shows on the pick after a boss, not on a rush's starting picks.
  const afterBoss = run.rush !== null && run.rush.picksLeft === 0;
  enter({ kind: 'pick', menu: upgradeMenu(run, takeUpgrade, performance.now(), afterBoss ? rushBonus : null) });
}

function takeUpgrade(index: number): void {
  if (mode !== 'pick') return;
  pending.push(...pickUpgrade(run, index));
  mode = 'playing';
  specialCarry = false;
  leave();
}

/**
 * Saves the finished run to the records, once: a Boss Rush to its own table (time, bosses beaten),
 * a normal run to the normal one. Returns its place in the top 10 (-1 if it missed).
 */
function saveRun(): number {
  if (savedRank !== null) return savedRank;
  if (run.rush) {
    const { rank } = addRushRecord(storage, {
      score: run.score,
      time: run.rush.time,
      bosses: rushBossesBeaten(run),
      won: run.phase === 'won',
      date: new Date().toISOString(),
    });
    savedRank = rank;
    return rank;
  }
  const { rank } = addRecord(storage, {
    score: run.score,
    wave: run.wave + 1,
    waves: WAVE_COUNT,
    bestCombo: run.bestCombo,
    won: run.phase === 'won',
    date: new Date().toISOString(),
  });
  savedRank = rank;
  return rank;
}

function finishRun(): void {
  const rank = saveRun();
  lastResult = {
    won: run.phase === 'won',
    reason: lostReason,
    score: run.score,
    wave: run.wave + 1,
    bestCombo: run.bestCombo,
    rank,
    ...(run.rush ? { rush: { time: run.rush.time, bosses: rushBossesBeaten(run), total: run.rush.stages.length } } : {}),
  };
  mode = 'over';
  specialCarry = false;
  lastMet = settleRun();
  if (lastMet.length > 0) {
    term.write('\x07');
    enter({ kind: 'unlocked', menu: unlockedMenu(lastMet, showResult, performance.now()) });
  } else showResult();
}

function showResult(): void {
  if (!lastResult) return;
  stack.length = 0;
  enter({ kind: 'over', menu: gameOverMenu(lastResult, { playAgain: () => startRun(run.mode), title: showTitle }, performance.now()) });
}

const howToScreen = (): Screen => ({ kind: 'howto', menu: howToMenu(keys.mode, leave) });

const titleScreen: Screen = {
  kind: 'title',
  menu: titleMenu(
    {
      start: () => startRun('normal'),
      rush: () => startRun('bossRush'),
      howTo: () => enter(howToScreen()),
      records: () =>
        enter({
          kind: 'records',
          menu: recordsMenu(
            { normal: () => loadRecords(storage), rush: () => loadRushRecords(storage), rushOpen: () => bossRushUnlocked(progress) },
            { back: leave, reset: (tab) => storage.setItem(tab === 'rush' ? RUSH_RECORDS_KEY : RECORDS_KEY, '[]') },
          ),
        }),
      unlocks: () => enter({ kind: 'unlocks', menu: unlocksMenu(() => progress, leave) }),
      backup: () =>
        enter({
          kind: 'backup',
          menu: backupMenu({
            code: () => exportCode(progress),
            restore: (code) => {
              const restored = importCode(code);
              if (!restored) return false;
              setProgress(restored);
              return true;
            },
            copy: (text) => term.write(clipboardSequence(text)),
            back: leave,
          }),
        }),
      quit,
    },
    () => bestScore(storage),
    () => bossRushUnlocked(progress),
  ),
};

// Input ----------------------------------------------------------------------------------------

/** Key events read since the last frame, in order. */
let queued: KeyEvent[] = [];
let escTimer: NodeJS.Timeout | null = null;

/**
 * While the parser holds bytes back (a lone ESC, or a paste still arriving), flush it after a
 * short quiet spell, again and again until it lets go: a paste only ends after a few quiet flushes.
 */
function armFlush(): void {
  if (escTimer) clearTimeout(escTimer);
  escTimer = parser.pending
    ? setTimeout(() => {
        escTimer = null;
        queued.push(...parser.flush());
        armFlush();
      }, ESC_WAIT_MS)
    : null;
}

term.onData((chunk) => {
  queued.push(...parser.feed(chunk));
  armFlush();
});

/** Folds this frame's key events in: quitting, replies, the top card's keys, and pause in play. */
function handleKeys(now: number): void {
  // Presses the key state held back (a tap, or a hold's first repeat?) come out once decided.
  const events = [...keys.feed(queued, now), ...keys.poll(now)];
  queued = [];
  // Only a run that was live before these keys reads them: the Esc that closes the pause card
  // must not pause again in the same frame.
  const wasLive = live();
  for (const e of events) {
    if (e.key === 'reply') {
      onReply(e);
      continue;
    }
    if (e.ctrl && e.key === 'c') quit();
    if (e.key === 'focusOut') {
      if (live()) pauseRun();
      continue;
    }
    if (e.kind === 'release' || e.key === 'focusIn') continue;
    const screen = top();
    if (screen) {
      // A held key's auto-repeats only scroll; they never confirm or go back.
      const nav = actionsFor(e).some((a) => a === 'up' || a === 'down' || a === 'left' || a === 'right');
      if (e.kind === 'repeat' && !nav && e.key !== 'backspace') continue;
      screen.menu.key(e, now);
    }
  }
  if (wasLive && live()) {
    if (keys.pressed('back')) pauseRun();
    else {
      if (keys.pressed('special')) specialCarry = true;
      if (keys.pressed('autofire')) autofire = !autofire;
    }
  }
}

// The loop -------------------------------------------------------------------------------------

let frame: Frame | null = null;
let shown: Frame | null = null;

term.onResize(() => {
  shown = null;
  term.write('\x1b[0m\x1b[2J');
});

/** Takes `lost` to remember why the run was lost, and a Boss Rush's time bonus for the pick after the boss. */
function reactTo(events: readonly RunEvent[]): void {
  for (const e of events) {
    if (e.type === 'lost') lostReason = e.reason;
    else if (e.type === 'waveStart') rushBonus = null;
    else if (e.type === 'rushBonus') rushBonus = e.points;
  }
}

let last = performance.now();

function tick(): void {
  const now = performance.now();
  const frameDt = Math.max(0, Math.min((now - last) / 1000, MAX_FRAME));
  last = now;

  handleKeys(now);
  const ship: ShipInput = {
    move: (keys.held('right', now) ? 1 : 0) - (keys.held('left', now) ? 1 : 0),
    drag: 0,
    fire: autofire || keys.held('fire', now),
    special: false,
  };
  keys.endFrame();

  const events = pending;
  pending = [];
  if (!paused) {
    accumulator += frameDt;
    const inputs: ShipInput[] = [NO_INPUT];
    while (accumulator >= STEP) {
      if (demo()) inputs[0] = autopilot(run);
      else if (live()) inputs[0] = { ...ship, special: specialCarry };
      else inputs[0] = NO_INPUT;
      const consumes = live() && run.phase === 'playing';
      events.push(...stepRun(run, inputs, STEP));
      if (consumes) specialCarry = false;
      accumulator -= STEP;
    }
  }

  if (demo()) {
    if (run.phase === 'upgradePick') events.push(...pickUpgrade(run, 0));
    else if ((run.phase === 'won' || run.phase === 'lost') && run.phaseTime > DEMO_RESTART) newRun(Date.now());
  } else {
    runLog.record(events, run);
    reactTo(events);
    if (mode === 'playing' && !paused) {
      if (run.phase === 'upgradePick') openPick();
      else if ((run.phase === 'won' || run.phase === 'lost') && run.phaseTime >= END_DELAY) finishRun();
    }
  }
  view.events(events, run);
  render(paused ? 0 : frameDt, now);
}

function render(dt: number, now: number): void {
  const cols = term.cols;
  const rows = term.rows;
  if (!frame || frame.cols !== cols || frame.rows !== rows) frame = new Frame(cols, rows);
  else frame.clear();
  const layout = computeLayout(cols, rows);
  if (!layout) {
    // The run can't be seen, so it mustn't go on.
    if (live()) pauseRun();
    drawTooSmall(frame, MIN_COLS, MIN_ROWS);
  } else {
    view.draw(frame, layout, run, { best: run.mode === 'bossRush' ? bestRushScore(storage) : bestScore(storage), demo: demo(), autofire, keyMode: keys.mode }, dt);
    top()?.menu.draw(frame, layout, now);
  }
  const out = encode(shown, frame, colorMode);
  if (out !== '') term.write(out);
  // Keep the drawn frame and draw the next one into the other buffer.
  const drawn = frame;
  frame = shown;
  shown = drawn;
}

/** A run in progress counts towards the unlocks, as quitting to the title would; a finished one is saved to the records. */
function settleOnExit(): void {
  if (mode !== 'title' && (run.phase === 'won' || run.phase === 'lost')) saveRun();
  settleRun();
}

// Closing the window (SIGHUP) or a kill counts the run as Ctrl+C does.
term.onSignal(settleOnExit);

function quit(): never {
  settleOnExit();
  term.close();
  const best = bestScore(storage);
  console.log(best > 0 ? `Thanks for playing Hivebreak. Best score: ${best}.` : 'Thanks for playing Hivebreak.');
  process.exit(0);
}

showTitle();
// `--rush`: straight to a Boss Rush's ship card.
if (RUSH) startRun('bossRush');
setInterval(tick, FRAME_MS);
