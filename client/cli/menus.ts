import type { Frame, Rgb } from './frame';
import type { KeyEvent, KeyMode } from './keys';
import { FIELD_ROWS, type Layout } from './layout';
import type { MilestoneDef, Progress } from '../src/game/progress';
import type { RunRecord } from '../src/game/records';
import { completesSynergy } from '../src/game/synergies';
import type { Rarity, RunState, ShipId, SpecialId } from '../src/game/types';
import { stackCount, upgradeDef } from '../src/game/upgrades';
import type { RushRecord } from '../src/game/rushrecords';
import { RUSH_START_PICKS } from '../src/game/run';
import { WAVE_COUNT } from '../src/game/waves';
import {
  BOSS_RUSH_LOCK_HINT,
  RUSH_HEADING,
  bossDownHeading,
  comboLabel,
  endTitle,
  formatClock,
  formatScore,
  pickReady,
  pickTags,
  rankBadge,
  recordRowText,
  rushEndTitle,
  rushPickAsk,
  rushRecordRowText,
  rushTimeLabel,
  stackLabel,
  timeBonusLabel,
  waveClearHeading,
  waveLabel,
} from '../src/ui/format';
import { focusEntry, shipEntries, specialEntries, unlockedEntries, unlocksOverview } from '../src/ui/unlockview';

// The terminal game's cards: title, ship choice, Special choice, upgrade pick, pause, the
// UNLOCKED moment, game over, records, unlocks, how to play and progress backup. Each one draws
// itself over the field (centred) and reads key events. The text comes from the same helpers as
// the web cards (src/ui/format.ts, src/ui/unlockview.ts), so the wording matches.
//
// Every card is a navy panel with a thin border, a bold title, the content, and a dim hint line
// at the bottom. The selected option is marked with '▸' on a highlighted bar; locked options are
// dimmed with what unlocks them. Panels are sized to their content and clipped to the frame, so
// they stay inside the smallest terminal the game runs in (62x42).

export interface Menu {
  /** Draws the card over the frame (the field is already drawn underneath). */
  draw(frame: Frame, layout: Layout, nowMs: number): void;
  /** One key event: presses and auto-repeats (releases are not passed). */
  key(e: KeyEvent, nowMs: number): void;
}

export interface RunResult {
  won: boolean;
  reason?: 'lives' | 'invaded';
  score: number;
  /** The wave reached, counting from 1. */
  wave: number;
  bestCombo: number;
  /** Place in the top 10: 0 is the best, -1 means it missed the list. */
  rank: number;
  /** Set for a Boss Rush: seconds it took (or lasted), the bosses beaten and how many there are. Its rank is on the Boss Rush table. */
  rush?: { time: number; bosses: number; total: number };
}

/**
 * Seconds after the UNLOCKED card opens during which Continue is ignored, so mashing fire as the
 * run ends can't skip it. Copied from UNLOCKED_GUARD_SECONDS in src/ui/unlocked.ts, which pulls
 * in the DOM and so can't be imported here.
 */
export const UNLOCKED_GUARD_SECONDS = 0.6;

// Look ------------------------------------------------------------------------------------------

const C = {
  panel: 0x0b1230,
  edge: 0x2f4f9a,
  card: 0x111b40,
  select: 0x15506e,
  accent: 0x38e8ff,
  amber: 0xffb83d,
  text: 0xdfe8ff,
  dim: 0x7081ad,
  good: 0x5be3a0,
  bad: 0xff6b7a,
  common: 0xc4d0ee,
  uncommon: 0x5be3a0,
};

/** The colour of a rarity's name and tag: amber for rare, as the web cards' gold. */
const RARITY_COLOR: Record<Rarity, Rgb> = { common: C.common, uncommon: C.uncommon, rare: C.amber };

/** What a menu key stands for. */
type Nav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

/**
 * The menu meaning of a key event, or null. This is deliberately not `actionsFor` from keys.ts:
 * the cards only need the menu keys, and keeping the mapping here means they behave the same (and
 * test the same) whatever the game's own bindings do. Arrows and w/s/k/j move, a/d/h/l go
 * sideways, Enter and Space confirm, Escape goes back. Releases and Ctrl chords are never menu keys.
 */
function navFor(e: KeyEvent): Nav | null {
  if (e.kind === 'release' || e.ctrl) return null;
  switch (e.key) {
    case 'up':
    case 'w':
    case 'k':
      return 'up';
    case 'down':
    case 's':
    case 'j':
      return 'down';
    case 'left':
    case 'a':
    case 'h':
      return 'left';
    case 'right':
    case 'd':
    case 'l':
      return 'right';
    case 'enter':
    case 'space':
      return 'confirm';
    case 'escape':
      return 'back';
    default:
      return null;
  }
}

/** Moving through a list does repeat while a key is held; choosing and going back only count a fresh press. */
function isPress(e: KeyEvent): boolean {
  return e.kind === 'press';
}

/** The index after moving up (-1) or down (+1) through `count` items, wrapping round. */
function stepIndex(index: number, dir: number, count: number): number {
  if (count <= 0) return 0;
  return (((index + dir) % count) + count) % count;
}

/** The next index in `dir` whose item is enabled, wrapping round; the same index if none is. */
function stepEnabled(index: number, dir: number, enabled: readonly boolean[]): number {
  for (let i = 1; i <= enabled.length; i++) {
    const j = stepIndex(index, dir * i, enabled.length);
    if (enabled[j]) return j;
  }
  return index;
}

// Text helpers ----------------------------------------------------------------------------------

/** `s` cut to `width` characters, with an ellipsis if it was longer. */
function clip(s: string, width: number): string {
  const chars = [...s];
  if (chars.length <= width) return s;
  if (width <= 0) return '';
  return chars.slice(0, width - 1).join('') + '…';
}

/** Word-wraps `s` to lines of at most `width` characters; a word longer than that is split. */
export function wrap(s: string, width: number): string[] {
  const w = Math.max(1, Math.floor(width));
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/).filter((x) => x !== '')) {
    let rest = [...word];
    // A word that can't fit even on a line of its own is broken up.
    while (rest.length > w) {
      if (line !== '') {
        lines.push(line);
        line = '';
      }
      lines.push(rest.slice(0, w).join(''));
      rest = rest.slice(w);
    }
    const piece = rest.join('');
    if (line === '') line = piece;
    else if ([...line].length + 1 + rest.length <= w) line += ` ${piece}`;
    else {
      lines.push(line);
      line = piece;
    }
  }
  if (line !== '') lines.push(line);
  return lines.length > 0 ? lines : [''];
}

// The panel -------------------------------------------------------------------------------------

interface Card {
  /** The panel's outer rectangle. */
  col: number;
  row: number;
  width: number;
  height: number;
  /** Where content goes: left edge and width (two cells in from the border). */
  ix: number;
  iw: number;
  /** The first content row, and how many content rows there is room for. */
  top: number;
  rows: number;
}

interface CardOptions {
  width: number;
  /** The content rows wanted; fewer are given if the frame is too short. */
  rows: number;
  title: string;
  hints: readonly string[];
  titleColor?: Rgb;
}

/**
 * Draws an empty panel, centred across the frame and (when it fits) over the field vertically,
 * with its title and hint lines, and says where the content goes. The panel shrinks to fit a
 * small frame, so callers must use `rows` rather than the number they asked for.
 */
function openCard(frame: Frame, layout: Layout, o: CardOptions): Card {
  // Top: border, title, a blank row. Bottom: a blank row, the hints, the border.
  const chrome = 3 + 1 + o.hints.length + 1;
  const width = Math.max(4, Math.min(o.width, frame.cols));
  const height = Math.min(chrome + o.rows, frame.rows);
  const rows = Math.max(0, height - chrome);
  const col = Math.floor((frame.cols - width) / 2);
  const row =
    height <= FIELD_ROWS
      ? Math.max(0, layout.fieldRow + Math.floor((FIELD_ROWS - height) / 2))
      : Math.max(0, Math.floor((frame.rows - height) / 2));
  frame.fillCells(col, row, width, height, C.panel);
  frame.box(col, row, width, height, C.edge, C.panel);
  const ix = col + 2;
  const iw = width - 4;
  if (o.title !== '') frame.textCentered(col, row + 1, width, clip(o.title, iw), o.titleColor ?? C.accent, null, true);
  const hintTop = row + 3 + rows + 1;
  o.hints.forEach((hint, i) => {
    if (hintTop + i < row + height - 1) frame.textCentered(col, hintTop + i, width, clip(hint, iw), C.dim);
  });
  return { col, row, width, height, ix, iw, top: row + 3, rows };
}

/** Highlights a row across the panel: the selected option's bar. */
function bar(frame: Frame, card: Card, row: number, selected: boolean, height = 1): void {
  if (selected) frame.fillCells(card.col + 1, row, card.width - 2, height, C.select);
}

/** A short list of options, one per row, in a bar `barWidth` wide centred in the panel. */
function drawOptions(frame: Frame, card: Card, top: number, labels: readonly string[], selected: number, barWidth: number, ready = true): void {
  const w = Math.min(barWidth, card.iw);
  const col = card.col + Math.floor((card.width - w) / 2);
  labels.forEach((label, i) => {
    const row = top + i;
    if (row >= card.top + card.rows) return;
    const sel = i === selected;
    if (sel) frame.fillCells(col, row, w, 1, C.select);
    frame.text(col + 1, row, sel ? '▸' : ' ', C.accent, null, true);
    frame.text(col + 3, row, clip(label, w - 4), sel ? (ready ? 0xffffff : C.dim) : C.text, null, sel && ready);
  });
}

// Title -----------------------------------------------------------------------------------------

/** The logo's letters as 5-wide pixel grids (K is 4); 6 pixels tall, drawn two pixels to a cell row with half blocks. */
const GLYPHS: Record<string, readonly string[]> = {
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  V: ['X...X', 'X...X', 'X...X', 'X...X', '.X.X.', '..X..'],
  E: ['XXXX', 'X...', 'XXX.', 'X...', 'X...', 'XXXX'],
  B: ['XXXX.', 'X...X', 'XXXX.', 'X...X', 'X...X', 'XXXX.'],
  R: ['XXXX.', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  A: ['.XXX.', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X'],
  K: ['X..X', 'X.X.', 'XX..', 'X.X.', 'X..X', 'X..X'],
};

/** Colours of the logo's three cell rows, top to bottom. */
const LOGO_COLORS: readonly Rgb[] = [0x6af2ff, 0x38b6ff, 0x3a7bff];

/** "HIVEBREAK" as three rows of block characters, one cell per pixel across (48 cells wide). */
export function logoRows(): string[] {
  const letters = [...'HIVEBREAK'].map((ch) => GLYPHS[ch]);
  const rows: string[] = [];
  for (let pair = 0; pair < 3; pair++) {
    let out = '';
    letters.forEach((glyph, n) => {
      if (n > 0) out += ' ';
      for (let x = 0; x < glyph[0].length; x++) {
        const top = glyph[pair * 2][x] === 'X';
        const bottom = glyph[pair * 2 + 1][x] === 'X';
        out += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
      }
    });
    rows.push(out);
  }
  return rows;
}

const TITLE_LABELS = ['Start', 'Boss Rush', 'How to play', 'Records', 'Unlocks', 'Backup', 'Quit'] as const;
const RUSH_INDEX = 1;

/**
 * The title card. Boss Rush is dimmed, with what unlocks it under it, until `rushOpen()` says it
 * is open (a win); the highlight skips it while it is locked, as the web title's focus does.
 */
export function titleMenu(
  actions: { start(): void; rush(): void; howTo(): void; records(): void; unlocks(): void; backup(): void; quit(): void },
  best: () => number,
  rushOpen: () => boolean = () => true,
): Menu {
  let sel = 0;
  const run = [actions.start, actions.rush, actions.howTo, actions.records, actions.unlocks, actions.backup, actions.quit];
  const enabled = (): boolean[] => TITLE_LABELS.map((_, i) => i !== RUSH_INDEX || rushOpen());
  return {
    draw(frame, layout) {
      const logo = logoRows();
      const open = rushOpen();
      const card = openCard(frame, layout, {
        width: 58,
        // The logo, a gap, the tagline, the best score, a gap, the options, and the lock's hint row.
        rows: logo.length + 1 + 1 + 1 + 1 + TITLE_LABELS.length + (open ? 0 : 1),
        title: '',
        hints: ['↑↓ choose · Enter select · Q quit'],
      });
      let row = card.top;
      logo.forEach((line, i) => frame.textCentered(card.col, row + i, card.width, line, LOGO_COLORS[i], null, true));
      row += logo.length + 1;
      frame.textCentered(card.col, row, card.width, 'Break the hive, one wave at a time.', C.dim);
      const score = best();
      if (score > 0) frame.textCentered(card.col, row + 1, card.width, `BEST ${formatScore(score)}`, C.amber, null, true);
      const barWidth = Math.min(28, card.iw);
      const barCol = card.col + Math.floor((card.width - barWidth) / 2);
      let at = row + 3;
      TITLE_LABELS.forEach((label, i) => {
        if (at >= card.top + card.rows) return;
        const locked = i === RUSH_INDEX && !open;
        const on = i === sel;
        if (on) frame.fillCells(barCol, at, barWidth, 1, C.select);
        frame.text(barCol + 1, at, on ? '▸' : ' ', C.accent, null, true);
        frame.text(barCol + 3, at, clip(label, barWidth - 4), locked ? C.dim : on ? 0xffffff : C.text, null, on && !locked);
        at++;
        // A locked Boss Rush says what unlocks it on the row under it.
        if (locked && at < card.top + card.rows) {
          frame.textCentered(card.col, at, card.width, clip(BOSS_RUSH_LOCK_HINT, card.iw), C.amber);
          at++;
        }
      });
    },
    key(e) {
      if (e.kind === 'release') return;
      if (e.key === 'q' && !e.ctrl) {
        if (isPress(e)) actions.quit();
        return;
      }
      const nav = navFor(e);
      const ok = enabled();
      // The locked Boss Rush can't hold the highlight (the dev flags or a restored save may have moved it).
      if (!ok[sel]) sel = stepEnabled(sel, 1, ok);
      if (nav === 'up' || nav === 'left') sel = stepEnabled(sel, -1, ok);
      else if (nav === 'down' || nav === 'right') sel = stepEnabled(sel, 1, ok);
      else if (nav === 'confirm' && isPress(e) && ok[sel]) run[sel]();
    },
  };
}

// Ship and Special choice -----------------------------------------------------------------------

/** Draws `label ■■■□□` at (col, row); returns the column after it. */
function drawMeter(frame: Frame, col: number, row: number, label: string, lit: number, color: Rgb, trailing = ''): number {
  frame.text(col, row, label, C.dim);
  let c = col + [...label].length + 1;
  frame.text(c, row, '■'.repeat(lit), color);
  frame.text(c + lit, row, '□'.repeat(Math.max(0, 5 - lit)), C.edge);
  c += 5;
  if (trailing !== '') {
    frame.text(c + 1, row, trailing, color);
    c += 1 + [...trailing].length;
  }
  return c;
}

export function shipMenu(progress: Progress, last: ShipId | null, take: (ship: ShipId) => void, back: () => void): Menu {
  const entries = shipEntries(progress);
  const enabled = entries.map((e) => e.unlocked);
  const start = focusEntry(entries, last);
  let sel = start ? entries.indexOf(start) : 0;
  return {
    draw(frame, layout) {
      const card = openCard(frame, layout, {
        width: 60,
        rows: entries.length * 4 - 1,
        title: 'CHOOSE YOUR SHIP · FOR THIS RUN',
        hints: ['↑↓ choose · Enter take · Esc back', 'locked ships show what unlocks them'],
      });
      entries.forEach((entry, i) => {
        const row = card.top + i * 4;
        if (row + 2 >= card.top + card.rows + 1) return;
        const on = entry.unlocked;
        const selected = i === sel;
        bar(frame, card, row, selected, 3);
        frame.text(card.ix, row, selected ? '▸' : ' ', C.accent, null, true);
        frame.text(card.ix + 2, row, entry.name, on ? (selected ? 0xffffff : C.text) : C.dim, null, on);
        if (!on) frame.text(card.ix + card.iw - 6, row, 'LOCKED', C.dim);
        const blurb = on ? entry.description : entry.hint ? `Unlock: ${entry.hint}` : 'Locked';
        frame.text(card.ix + 2, row + 1, clip(blurb, card.iw - 2), on ? C.dim : C.amber);
        const lit = on ? C.accent : C.dim;
        let c = drawMeter(frame, card.ix + 2, row + 2, 'Speed', entry.pips.speed, lit);
        c = drawMeter(frame, c + 2, row + 2, 'Fire', entry.pips.fireRate, lit);
        drawMeter(frame, c + 2, row + 2, 'Lives', entry.pips.lives, lit, String(entry.lives));
      });
    },
    key(e) {
      const nav = navFor(e);
      if (nav === 'up' || nav === 'left') sel = stepEnabled(sel, -1, enabled);
      else if (nav === 'down' || nav === 'right') sel = stepEnabled(sel, 1, enabled);
      else if (nav === 'confirm' && isPress(e) && enabled[sel]) take(entries[sel].id);
      else if (nav === 'back' && isPress(e)) back();
    },
  };
}

export function specialMenu(progress: Progress, take: (special: SpecialId) => void, back: () => void): Menu {
  const entries = specialEntries(progress);
  const enabled = entries.map((e) => e.unlocked);
  let sel = Math.max(0, enabled.indexOf(true));
  return {
    draw(frame, layout) {
      const iw = Math.min(60, frame.cols) - 4;
      // Each Special: its name, then its description (or what unlocks it), then a blank row.
      const blocks = entries.map((entry) => wrap(entry.unlocked ? entry.description : entry.hint ? `Unlock: ${entry.hint}` : 'Locked', iw - 2));
      const card = openCard(frame, layout, {
        width: 60,
        rows: blocks.reduce((sum, b) => sum + 2 + b.length, 0) - 1,
        title: 'CHOOSE YOUR SPECIAL · FOR THIS RUN',
        hints: ['↑↓ choose · Enter take · Esc back', 'kills fill the meter · X fires it when full'],
      });
      let row = card.top;
      entries.forEach((entry, i) => {
        const lines = blocks[i];
        const on = entry.unlocked;
        const selected = i === sel;
        bar(frame, card, row, selected, 1 + lines.length);
        frame.text(card.ix, row, selected ? '▸' : ' ', C.accent, null, true);
        frame.text(card.ix + 2, row, entry.name, on ? (selected ? 0xffffff : C.text) : C.dim, null, on);
        if (!on) frame.text(card.ix + card.iw - 6, row, 'LOCKED', C.dim);
        lines.forEach((line, n) => frame.text(card.ix + 2, row + 1 + n, line, on ? C.dim : C.amber));
        row += 2 + lines.length;
      });
    },
    key(e) {
      const nav = navFor(e);
      if (nav === 'up' || nav === 'left') sel = stepEnabled(sel, -1, enabled);
      else if (nav === 'down' || nav === 'right') sel = stepEnabled(sel, 1, enabled);
      else if (nav === 'confirm' && isPress(e) && enabled[sel]) take(entries[sel].id);
      else if (nav === 'back' && isPress(e)) back();
    },
  };
}

// Upgrade pick ----------------------------------------------------------------------------------

/** Terminal width from which the three upgrade cards sit side by side; narrower, they stack. */
const PICK_SIDE_BY_SIDE_COLS = 78;
const PICK_CARD_WIDTH = 24;

interface PickInfo {
  name: string;
  description: string;
  rarity: Rarity;
  /** The rarity word to show (a synergy hint replaces it, except for a rare), or null. */
  rarityWord: string | null;
  synergy: string | null;
  stacks: string;
}

function pickInfo(run: RunState, id: RunState['offer'][number]): PickInfo {
  const def = upgradeDef(id);
  const player = run.players[0];
  const tags = pickTags(def.rarity, player ? completesSynergy(player, id) : null);
  return {
    name: def.name,
    description: def.description,
    rarity: def.rarity,
    rarityWord: tags.rarity ? tags.rarity.toUpperCase() : null,
    synergy: tags.synergy,
    stacks: stackLabel(player ? stackCount(player, id) : 0, def.maxStacks),
  };
}

/** The frame and fill of one pick card; a selected card has the accent border and a lit background. */
function pickFrame(frame: Frame, col: number, row: number, width: number, height: number, info: PickInfo, selected: boolean): void {
  const bg = selected ? C.select : C.card;
  frame.fillCells(col, row, width, height, bg);
  frame.box(col, row, width, height, selected ? C.accent : info.rarity === 'rare' ? C.amber : C.edge, bg);
}

/**
 * The upgrade pick. In a Boss Rush the three starting picks read "BOSS RUSH · PICK 1 OF 3" and the
 * pick after a boss names the boss as usual, with `rushBonus` (the time bonus of the boss just
 * beaten, null when it came in over par) on the line under the heading.
 */
export function upgradeMenu(run: RunState, take: (index: number) => void, openedAtMs: number, rushBonus: number | null = null): Menu {
  let sel = 0;
  const count = () => run.offer.length;
  const startingPick = () => run.rush !== null && run.rush.picksLeft > 0;
  const heading = () =>
    run.rush && startingPick()
      ? `${RUSH_HEADING} · ${rushPickAsk(run.rush.picksLeft, RUSH_START_PICKS)}`
      : run.boss
        ? bossDownHeading(run.boss.kind)
        : waveClearHeading(run.wave + 1);
  /** The time bonus line, drawn in the blank row under the heading. */
  const drawBonus = (frame: Frame, card: Card): void => {
    if (rushBonus === null || startingPick()) return;
    frame.textCentered(card.col, card.row + 2, card.width, clip(timeBonusLabel(rushBonus), card.iw), C.amber, null, true);
  };
  return {
    draw(frame, layout) {
      const infos = run.offer.map((id) => pickInfo(run, id));
      const side = frame.cols >= PICK_SIDE_BY_SIDE_COLS;
      const hints = [
        side ? '←→ choose · Enter take · 1 2 3 pick directly' : '↑↓ choose · Enter take · 1 2 3 pick directly',
      ];
      if (infos.length === 0) {
        const card = openCard(frame, layout, { width: 60, rows: 1, title: heading(), hints: [] });
        frame.textCentered(card.col, card.top, card.width, 'Nothing on offer.', C.dim);
        return;
      }
      const selected = Math.min(sel, infos.length - 1);
      if (side) {
        const cardW = PICK_CARD_WIDTH;
        const innerW = cardW - 4;
        const descs = infos.map((i) => wrap(i.description, innerW));
        const syn = infos.map((i) => (i.synergy ? wrap(i.synergy, innerW).slice(0, 2) : []));
        const d = Math.max(...descs.map((x) => x.length));
        const sy = Math.max(...syn.map((x) => x.length));
        // border, name, rarity, blank, description, blank, the synergy rows (if any), stacks, border.
        const cardH = 2 + 3 + d + 1 + sy + 1;
        const card = openCard(frame, layout, { width: 78, rows: cardH, title: heading(), hints });
        drawBonus(frame, card);
        const total = infos.length * cardW + (infos.length - 1);
        const left = card.ix + Math.floor((card.iw - total) / 2);
        infos.forEach((info, i) => {
          const col = left + i * (cardW + 1);
          const row = card.top;
          const on = i === selected;
          pickFrame(frame, col, row, cardW, Math.min(cardH, card.rows), info, on);
          const color = RARITY_COLOR[info.rarity];
          frame.text(col + 2, row + 1, clip(`${on ? '▸' : ' '}${i + 1} ${info.name}`, innerW), color, null, true);
          if (info.rarityWord) frame.text(col + 2, row + 2, info.rarityWord, color);
          descs[i].forEach((line, n) => frame.text(col + 2, row + 4 + n, line, C.text));
          syn[i].forEach((line, n) => frame.text(col + 2, row + 5 + d + n, line, C.accent, null, true));
          frame.text(col + 2, row + cardH - 2, `${info.stacks} taken`, C.dim);
        });
      } else {
        const innerW = Math.min(60, frame.cols) - 8;
        const descs = infos.map((i) => wrap(i.description, innerW));
        const heights = descs.map((x) => 2 + 2 + x.length);
        const card = openCard(frame, layout, { width: 60, rows: heights.reduce((a, b) => a + b, 0), title: heading(), hints });
        drawBonus(frame, card);
        let row = card.top;
        infos.forEach((info, i) => {
          const on = i === selected;
          const bottom = card.top + card.rows;
          if (row + heights[i] > bottom) return;
          pickFrame(frame, card.ix, row, card.iw, heights[i], info, on);
          const color = RARITY_COLOR[info.rarity];
          frame.text(card.ix + 2, row + 1, clip(`${on ? '▸' : ' '}${i + 1} ${info.name}`, innerW - 8), color, null, true);
          const stacks = `${info.stacks} taken`;
          frame.text(card.ix + 2 + innerW - [...stacks].length, row + 1, stacks, C.dim);
          let c = card.ix + 2;
          if (info.rarityWord) {
            frame.text(c, row + 2, info.rarityWord, color);
            c += [...info.rarityWord].length;
            if (info.synergy) {
              frame.text(c, row + 2, ' · ', C.dim);
              c += 3;
            }
          }
          if (info.synergy) frame.text(c, row + 2, clip(info.synergy, innerW - (c - card.ix - 2)), C.accent, null, true);
          descs[i].forEach((line, n) => frame.text(card.ix + 2, row + 3 + n, line, C.text));
          row += heights[i];
        });
      }
    },
    key(e, nowMs) {
      const nav = navFor(e);
      const n = count();
      if (n === 0) return;
      if (nav === 'left' || nav === 'up') sel = stepIndex(Math.min(sel, n - 1), -1, n);
      else if (nav === 'right' || nav === 'down') sel = stepIndex(Math.min(sel, n - 1), 1, n);
      else if (nav === 'confirm' && isPress(e) && pickReady(openedAtMs, nowMs)) take(Math.min(sel, n - 1));
      else if (isPress(e) && !e.ctrl && /^[1-9]$/.test(e.key) && pickReady(openedAtMs, nowMs)) {
        const index = Number(e.key) - 1;
        if (index < n) take(index);
      }
    },
  };
}

// Pause -----------------------------------------------------------------------------------------

export function pauseMenu(actions: { resume(): void; howTo(): void; quit(): void }): Menu {
  let sel = 0;
  const labels = ['Resume', 'How to play', 'Quit to title'];
  const run = [actions.resume, actions.howTo, actions.quit];
  return {
    draw(frame, layout) {
      const card = openCard(frame, layout, { width: 36, rows: labels.length, title: 'PAUSED', hints: ['↑↓ choose · Enter select · Esc resume'] });
      drawOptions(frame, card, card.top, labels, sel, 26);
    },
    key(e) {
      // P resumes as well as Esc, as it pauses.
      if (isPress(e) && !e.ctrl && e.key === 'p') {
        actions.resume();
        return;
      }
      const nav = navFor(e);
      if (nav === 'up' || nav === 'left') sel = stepIndex(sel, -1, run.length);
      else if (nav === 'down' || nav === 'right') sel = stepIndex(sel, 1, run.length);
      else if (nav === 'confirm' && isPress(e)) run[sel]();
      else if (nav === 'back' && isPress(e)) actions.resume();
    },
  };
}

// UNLOCKED --------------------------------------------------------------------------------------

/** The UNLOCKED moment. Continue (or Esc) works only after UNLOCKED_GUARD_SECONDS from `openedAtMs`. */
export function unlockedMenu(met: readonly MilestoneDef[], cont: () => void, openedAtMs: number): Menu {
  const entries = unlockedEntries(met);
  return {
    draw(frame, layout, nowMs) {
      const iw = Math.min(60, frame.cols) - 4;
      // Each reward: "Ship · Lancer", then why, then a blank row. Rewards that don't fit are counted instead.
      const blocks = entries.map((entry) => wrap(entry.reason, iw - 2));
      // The card's own chrome is 6 rows (border, title, gap, gap, hint, border), and Continue takes one.
      const room = Math.max(0, frame.rows - 2 - 6 - 1);
      let shown = 0;
      let used = 0;
      for (let i = 0; i < blocks.length; i++) {
        const need = 2 + blocks[i].length;
        // Leave a row for "+N more" unless this is the last reward.
        if (used + need + (i < blocks.length - 1 ? 1 : 0) > room) break;
        used += need;
        shown++;
      }
      const more = entries.length - shown;
      const card = openCard(frame, layout, {
        width: 60,
        rows: used + (more > 0 ? 1 : 0) + 1,
        title: 'UNLOCKED',
        titleColor: C.amber,
        hints: ['Enter continue'],
      });
      let row = card.top;
      for (let i = 0; i < shown; i++) {
        const entry = entries[i];
        frame.text(card.ix, row, entry.kind, C.dim);
        frame.text(card.ix + [...entry.kind].length + 1, row, `· ${entry.name}`, C.amber, null, true);
        blocks[i].forEach((line, n) => frame.text(card.ix + 2, row + 1 + n, line, C.text));
        row += 2 + blocks[i].length;
      }
      if (more > 0) {
        frame.text(card.ix, row, `+${more} more`, C.dim);
        row++;
      }
      drawOptions(frame, card, row, ['Continue'], 0, 20, pickReady(openedAtMs, nowMs, UNLOCKED_GUARD_SECONDS));
    },
    key(e, nowMs) {
      const nav = navFor(e);
      if ((nav === 'confirm' || nav === 'back') && isPress(e) && pickReady(openedAtMs, nowMs, UNLOCKED_GUARD_SECONDS)) cont();
    },
  };
}

// Game over -------------------------------------------------------------------------------------

export function gameOverMenu(result: RunResult, actions: { playAgain(): void; title(): void }, openedAtMs: number): Menu {
  let sel = 0;
  const labels = ['Play again', 'Title'];
  const rush = result.rush;
  const rank = rankBadge(result.rank);
  // A Boss Rush's rank is on its own table, so the badge says which.
  const badge = rank !== null && rush ? `${rank} · Boss Rush` : rank;
  return {
    draw(frame, layout, nowMs) {
      // A rush shows the clear time and the bosses beaten in place of the wave reached.
      const stats: [string, string, Rgb][] = rush
        ? [
            ['Score', formatScore(result.score), 0xffffff],
            [rushTimeLabel(result.won), formatClock(rush.time), C.text],
            ['Bosses beaten', `${rush.bosses} / ${rush.total}`, C.text],
            ['Best combo', comboLabel(result.bestCombo), C.text],
          ]
        : [
            ['Score', formatScore(result.score), 0xffffff],
            ['Wave', waveLabel(result.wave, WAVE_COUNT), C.text],
            ['Best combo', comboLabel(result.bestCombo), C.text],
          ];
      const card = openCard(frame, layout, {
        width: 44,
        rows: stats.length + (badge ? 2 : 1) + labels.length,
        title: rush ? rushEndTitle(result.won, result.reason) : endTitle(result.won, result.reason),
        titleColor: result.won ? C.amber : C.bad,
        hints: ['↑↓ choose · Enter select'],
      });
      let row = card.top;
      for (const [label, value, color] of stats) {
        frame.text(card.ix + 4, row, label, C.dim);
        frame.text(card.ix + card.iw - 4 - [...value].length, row, value, color, null, true);
        row++;
      }
      if (badge) {
        frame.textCentered(card.col, row, card.width, clip(badge, card.iw), C.amber, null, true);
        row++;
      }
      drawOptions(frame, card, row + 1, labels, sel, 26, pickReady(openedAtMs, nowMs));
    },
    key(e, nowMs) {
      const nav = navFor(e);
      if (nav === 'up' || nav === 'left') sel = stepIndex(sel, -1, labels.length);
      else if (nav === 'down' || nav === 'right') sel = stepIndex(sel, 1, labels.length);
      else if (!pickReady(openedAtMs, nowMs)) return;
      else if (nav === 'confirm' && isPress(e)) (sel === 0 ? actions.playAgain : actions.title)();
      else if (nav === 'back' && isPress(e)) actions.title();
    },
  };
}

// Records ---------------------------------------------------------------------------------------

/** What the records card reads: the normal list, the Boss Rush list, and whether Boss Rush is open (for its empty message). */
export interface RecordSources {
  normal(): readonly RunRecord[];
  rush(): readonly RushRecord[];
  rushOpen(): boolean;
}

export type RecordsTab = 'normal' | 'rush';
const RECORD_TABS: readonly RecordsTab[] = ['normal', 'rush'];
const TAB_NAMES: Record<RecordsTab, string> = { normal: 'Normal', rush: 'Boss Rush' };

/**
 * The records card, in two tabs (Normal and Boss Rush; Left and Right switch). R then Y erases the
 * list on show; `reset` is told which tab it was.
 */
export function recordsMenu(sources: RecordSources, actions: { back(): void; reset(tab: RecordsTab): void }): Menu {
  // R asks; Y erases. A different key from the one that asks, so holding R can't answer its own question.
  // Anything else (Esc included) cancels the question.
  let confirming = false;
  let tab: RecordsTab = 'normal';
  return {
    draw(frame, layout) {
      const normal = sources.normal().slice(0, 10);
      const rush = sources.rush().slice(0, 10);
      const list = tab === 'normal' ? normal : rush;
      // The tabs and a gap, then the header and rule and one row per record (or the empty message),
      // then a row for the erase question. Sized for the longer list so the card doesn't jump between tabs.
      const longest = Math.max(normal.length, rush.length);
      const body = 2 + (longest > 0 ? 2 + longest : 3);
      const card = openCard(frame, layout, {
        width: 52,
        rows: body + 2,
        title: 'RECORDS',
        hints: [confirming ? 'Y erase · any other key keeps them' : '←→ switch list · R reset · Esc back'],
      });
      // The tab bar: the open tab on a highlighted bar.
      let c = card.ix;
      for (const t of RECORD_TABS) {
        const label = ` ${TAB_NAMES[t]} `;
        const on = t === tab;
        frame.text(c, card.top, label, on ? 0xffffff : C.dim, on ? C.select : null, on);
        c += [...label].length + 1;
      }
      const top = card.top + 2;
      if (list.length === 0) {
        const message =
          tab === 'normal'
            ? 'No runs yet. Finish one and it lands here.'
            : sources.rushOpen()
              ? 'No Boss Rush runs yet. Finish one and it lands here.'
              : 'Boss Rush is locked. Win a run to open it.';
        wrap(message, card.iw).forEach((line, i) => frame.textCentered(card.col, top + 2 + i, card.width, line, C.dim));
      } else if (tab === 'normal') {
        const cols = [0, 4, 13, 21, 27, 33];
        ['#', 'SCORE', 'WAVE', 'COMBO', '', 'DATE'].forEach((h, i) => frame.text(card.ix + cols[i], top, h, C.dim));
        frame.text(card.ix, top + 1, '─'.repeat(card.iw), C.edge);
        normal.forEach((record, i) => {
          const t = recordRowText(i, record);
          const row = top + 2 + i;
          const best = i === 0;
          frame.text(card.ix + cols[0], row, t.rank, best ? C.amber : C.dim, null, best);
          frame.text(card.ix + cols[1], row, t.score, best ? C.amber : 0xffffff, null, best);
          frame.text(card.ix + cols[2], row, t.wave, C.text);
          frame.text(card.ix + cols[3], row, t.combo, C.text);
          frame.text(card.ix + cols[4], row, t.result, record.won ? C.good : C.dim);
          frame.text(card.ix + cols[5], row, t.date, C.dim);
        });
      } else {
        // Rank, score, clear time, bosses beaten (3/3 in green) and the date.
        const cols = [0, 4, 13, 21, 29];
        ['#', 'SCORE', 'TIME', 'BOSSES', 'DATE'].forEach((h, i) => frame.text(card.ix + cols[i], top, h, C.dim));
        frame.text(card.ix, top + 1, '─'.repeat(card.iw), C.edge);
        rush.forEach((record, i) => {
          const t = rushRecordRowText(i, record);
          const row = top + 2 + i;
          const best = i === 0;
          frame.text(card.ix + cols[0], row, t.rank, best ? C.amber : C.dim, null, best);
          frame.text(card.ix + cols[1], row, t.score, best ? C.amber : 0xffffff, null, best);
          frame.text(card.ix + cols[2], row, t.time, C.text);
          frame.text(card.ix + cols[3], row, t.bosses, record.won ? C.good : C.text);
          frame.text(card.ix + cols[4], row, t.date, C.dim);
        });
      }
      if (confirming) {
        const what = tab === 'normal' ? 'Erase every saved record?' : 'Erase every Boss Rush record?';
        frame.textCentered(card.col, card.top + body + 1, card.width, clip(`${what} This cannot be undone.`, card.iw), C.amber, null, true);
      }
    },
    key(e) {
      if (e.kind === 'release' || e.ctrl) return;
      // Left and right switch tabs (arrows repeat harmlessly: they stop at the ends); not while the erase question is open.
      const nav = navFor(e);
      if (!confirming && (nav === 'left' || nav === 'right')) {
        tab = RECORD_TABS[Math.min(RECORD_TABS.length - 1, Math.max(0, RECORD_TABS.indexOf(tab) + (nav === 'right' ? 1 : -1)))];
        return;
      }
      if (!isPress(e)) return;
      if (confirming && e.key === 'y') {
        confirming = false;
        actions.reset(tab);
        return;
      }
      if (e.key === 'r' && !confirming) {
        confirming = true;
        return;
      }
      if (confirming) {
        confirming = false;
        return;
      }
      if (nav === 'back') actions.back();
    },
  };
}

// Scrolling cards: unlocks and how to play -----------------------------------------------------

interface StyledLine {
  t: string;
  fg: Rgb;
  bold?: boolean;
}

const blank: StyledLine = { t: '', fg: C.text };

/** Wraps `text` into styled lines; later lines are indented by `hang` (and the first by `indent`). */
function paragraph(text: string, width: number, fg: Rgb, indent = 0, hang = indent, bold = false): StyledLine[] {
  const lines = wrap(text, Math.max(1, width - Math.max(indent, hang)));
  return lines.map((t, i) => ({ t: ' '.repeat(i === 0 ? indent : hang) + t, fg, bold }));
}

/** A card whose content may be taller than the terminal: Up and Down scroll it, with a bar at the right when it does. */
function scrollMenu(o: { title: string; width: number; lines: (width: number) => StyledLine[]; back(): void }): Menu {
  let offset = 0;
  let maxOffset = 0;
  return {
    draw(frame, layout) {
      const width = Math.min(o.width, frame.cols);
      // Text leaves a column for the scroll bar and one for a gap.
      const lines = o.lines(width - 6);
      // Leave two rows of the terminal free; the card's chrome (with one hint line) is 6.
      const maxRows = Math.max(1, frame.rows - 2 - 6);
      const scrolls = lines.length > maxRows;
      const card = openCard(frame, layout, { width, rows: Math.min(lines.length, maxRows), title: o.title, hints: [scrolls ? '↑↓ scroll · Esc back' : 'Esc back'] });
      maxOffset = Math.max(0, lines.length - card.rows);
      offset = Math.min(offset, maxOffset);
      lines.slice(offset, offset + card.rows).forEach((line, i) => frame.text(card.ix, card.top + i, clip(line.t, card.iw - 2), line.fg, null, line.bold ?? false));
      if (maxOffset > 0 && card.rows > 0) {
        const thumb = Math.max(1, Math.round((card.rows * card.rows) / lines.length));
        const thumbTop = Math.round((offset / maxOffset) * (card.rows - thumb));
        for (let i = 0; i < card.rows; i++) {
          const on = i >= thumbTop && i < thumbTop + thumb;
          frame.text(card.ix + card.iw - 1, card.top + i, on ? '█' : '│', on ? C.accent : C.edge);
        }
      }
    },
    key(e) {
      const nav = navFor(e);
      if (nav === 'up') offset = Math.max(0, offset - 1);
      else if (nav === 'down') offset = Math.min(maxOffset, offset + 1);
      else if (nav === 'back' && isPress(e)) o.back();
    },
  };
}

export function unlocksMenu(progress: () => Progress, back: () => void): Menu {
  return scrollMenu({
    title: 'UNLOCKS',
    width: 60,
    back,
    lines(width) {
      const overview = unlocksOverview(progress());
      const lines: StyledLine[] = [{ t: overview.countText, fg: C.accent, bold: true }, blank];
      if (overview.goals.length > 0) {
        lines.push({ t: 'NEXT GOALS', fg: C.amber, bold: true });
        for (const goal of overview.goals) {
          const tail = goal.progress ? ` (${goal.progress.text})` : '';
          lines.push(...paragraph(`${goal.reward}: ${goal.description}${tail}`, width, C.text, 0, 2));
        }
        lines.push(blank);
      }
      overview.sections.forEach((section, n) => {
        if (n > 0) lines.push(blank);
        lines.push({ t: section.title.toUpperCase(), fg: C.accent, bold: true });
        for (const row of section.rows) {
          if (row.unlocked) {
            lines.push({ t: `● ${row.name}${row.starter ? '  (from the start)' : ''}`, fg: C.text });
          } else {
            lines.push({ t: `○ ${row.name}`, fg: C.dim });
            if (row.hint) lines.push(...paragraph(`${row.hint}${row.progress ? ` (${row.progress.text})` : ''}`, width, C.amber, 4));
          }
        }
      });
      return lines;
    },
  });
}

/** A "Key   what it does" pair, the second part wrapped under itself. */
function binding(key: string, what: string, width: number): StyledLine[] {
  const keyW = 11;
  const parts = wrap(what, Math.max(1, width - keyW));
  return parts.map((t, i) => ({ t: (i === 0 ? key.padEnd(keyW) : ' '.repeat(keyW)) + t, fg: C.text, bold: false }));
}

export function howToMenu(keyMode: KeyMode, back: () => void): Menu {
  return scrollMenu({
    title: 'HOW TO PLAY',
    width: 60,
    back,
    lines(width) {
      const lines: StyledLine[] = [
        ...paragraph(
          'Clear all fifteen waves of the hive, across three sectors; each ends in a boss. After each wave pick one of three upgrades. Every hit in a row raises your combo; a miss resets it, so aim rather than spray. Lose your last life, or let the formation reach your row, and the run is over.',
          width,
          C.text,
        ),
        blank,
        { t: 'CONTROLS', fg: C.accent, bold: true },
        ...binding('Move', '← → or A D (H L too)', width),
        ...binding('Fire', 'Space, Z or ↑, hold to keep firing', width),
        ...binding('Auto-fire', 'F toggles it', width),
        ...binding('Special', 'X or Shift, when the meter is full', width),
        ...binding('Pause', 'Esc or P', width),
        ...binding('Quit', 'Ctrl+C, any time', width),
        ...binding('Menus', 'Arrows and Enter', width),
      ];
      if (keyMode === 'repeat') {
        lines.push(
          blank,
          { t: 'KEY REPEAT', fg: C.amber, bold: true },
          ...paragraph(
            "This terminal doesn't report key releases, so movement uses key repeat. For the smoothest controls use a terminal with the kitty keyboard protocol (Ghostty, kitty, WezTerm, iTerm2, Alacritty) or shorten \"Delay until repeat\" in your OS keyboard settings.",
            width,
            C.amber,
          ),
        );
      }
      lines.push(
        blank,
        { t: 'YOUR SPECIAL', fg: C.accent, bold: true },
        ...paragraph('Pick one Special before wave 1. Kills fill its meter; when it reads READY, fire it for a burst moment. Milestones unlock more (see Unlocks on the title screen).', width, C.text),
        blank,
        { t: 'BUNKERS', fg: C.accent, bold: true },
        ...paragraph("Bunkers stop shots from both sides, and every hit chews a piece away, your own included. Don't fire into your cover for nothing.", width, C.text),
        blank,
        { t: 'POWER-UPS AND UPGRADES', fg: C.accent, bold: true },
        ...paragraph(
          'Aliens drop glowing pickups for a few seconds of Spread, Laser, Time slow or a Helper. Rare upgrades are marked in amber. The right pair of upgrades combine into a synergy; a card that would complete one says "completes ...".',
          width,
          C.text,
        ),
        blank,
        { t: 'THE HIVE MIND', fg: C.accent, bold: true },
        ...paragraph('The second boss hides its core inside a turning ring of shields. Aim through the gaps, and take cover from its beams behind a bunker.', width, C.text),
        blank,
        { t: 'THE HIVE HEART', fg: C.accent, bold: true },
        ...paragraph(
          'The last boss is a huge heart fed by four veins. Cut the veins first: while one stands, shots at the heart are stopped. Every beat it sends out a ring of shots with a gap in it, so slip through the gap. Once exposed it launches aliens and beats faster; when it is nearly dead it fires double rings and sinks towards you.',
          width,
          C.text,
        ),
        blank,
        { t: 'BOSS RUSH', fg: C.accent, bold: true },
        ...paragraph(
          'Win a run to open Boss Rush on the title screen: pick a ship and a Special, take three upgrades, then fight the bosses back to back with a pick between them. A clock runs the whole way, and every boss beaten under its par time scores a time bonus. It has its own records, and it does not count towards unlocks.',
          width,
          C.text,
        ),
      );
      return lines;
    },
  });
}

// Backup ----------------------------------------------------------------------------------------

/** The longest code the restore field takes, so a runaway paste can't grow without end. */
const MAX_CODE_LENGTH = 4000;

/**
 * Progress backup: shows the export code (C copies it to the clipboard through `copy`), and takes
 * a pasted or typed code to restore (`restore` returns false for a bad code). C only copies while
 * the field is empty: a code starts with "HB1-", so typing one never begins with a C, and from
 * the first character on every letter goes into the field.
 */
export function backupMenu(actions: { code(): string; restore(code: string): boolean; copy(text: string): void; back(): void }): Menu {
  let code = actions.code();
  let field = '';
  let message: { text: string; ok: boolean } | null = null;
  return {
    draw(frame, layout) {
      const iw = Math.min(60, frame.cols) - 4;
      const intro = wrap('Your unlock progress as a code. Keep it somewhere safe; restoring it brings the unlocks back on any device.', iw);
      const maxCodeRows = 6;
      let codeRows = chunk(code, iw);
      if (codeRows.length === 0) codeRows = [''];
      const truncated = codeRows.length > maxCodeRows;
      if (truncated) codeRows = [...codeRows.slice(0, maxCodeRows - 1), clip(codeRows[maxCodeRows - 1] ?? '', iw - 1) + '…'];
      const rows = intro.length + 1 + codeRows.length + 1 + 1 + 1 + 1 + 1 + 1 + 1;
      const card = openCard(frame, layout, {
        width: 60,
        rows,
        title: 'BACKUP',
        hints: [field !== '' ? 'Enter restore · Esc clear' : 'C copy · Enter restore · Esc back'],
      });
      let row = card.top;
      for (const line of intro) frame.text(card.ix, row++, line, C.dim);
      row++;
      for (const line of codeRows) frame.text(card.ix, row++, line, C.accent);
      row++;
      frame.text(card.ix, row, 'C', C.accent, null, true);
      frame.text(card.ix + 2, row, 'Copy to clipboard', C.text);
      row += 2;
      frame.text(card.ix, row++, 'Paste or type a code, then Enter to restore', C.text);
      frame.fillCells(card.ix, row, card.iw, 1, C.card);
      const room = card.iw - 3;
      const chars = [...field];
      const shown = chars.length > room ? '…' + chars.slice(chars.length - room + 1).join('') : field;
      frame.text(card.ix + 1, row, `${shown}▌`, 0xffffff, C.card);
      row += 2;
      if (message) frame.text(card.ix, row, clip(message.text, card.iw), message.ok ? C.good : C.bad, null, true);
    },
    key(e) {
      if (e.kind === 'release' || e.ctrl) return;
      if (e.key === 'paste') {
        // Codes have no spaces, so a paste with line breaks or padding is joined up.
        field = (field + (e.text ?? '').replace(/\s+/g, '')).slice(0, MAX_CODE_LENGTH);
        message = null;
        return;
      }
      if (e.key === 'enter') {
        if (!isPress(e) || field === '') return;
        if (actions.restore(field)) {
          message = { text: 'Progress restored', ok: true };
          field = '';
          code = actions.code();
        } else message = { text: "That code isn't valid", ok: false };
        return;
      }
      if (e.key === 'escape') {
        if (!isPress(e)) return;
        message = null;
        if (field !== '') field = '';
        else actions.back();
        return;
      }
      if (e.key === 'backspace') {
        field = [...field].slice(0, -1).join('');
        message = null;
        return;
      }
      if (field === '' && e.key === 'c') {
        if (isPress(e)) {
          actions.copy(code);
          message = { text: 'Sent to the clipboard, if this terminal allows it', ok: true };
        }
        return;
      }
      // A typed character: its text if the terminal sent one (case kept), else the key itself.
      const ch = e.text !== undefined && [...e.text].length === 1 ? e.text : [...e.key].length === 1 ? e.key : '';
      if (ch !== '' && ch.trim() !== '' && field.length < MAX_CODE_LENGTH) {
        field += ch;
        message = null;
      }
    },
  };
}

/** `s` cut into pieces of `width` characters (no word breaks: a backup code has none). */
function chunk(s: string, width: number): string[] {
  const chars = [...s];
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += width) out.push(chars.slice(i, i + width).join(''));
  return out;
}

// Too small -------------------------------------------------------------------------------------

/** The whole screen when the terminal is too small: what size it needs and what it has. */
export function drawTooSmall(frame: Frame, needCols: number, needRows: number): void {
  frame.clear(C.panel);
  const message = `Hivebreak needs a terminal at least ${needCols}×${needRows}. This one is ${frame.cols}×${frame.rows}. Make the window bigger or the font smaller.`;
  const width = Math.max(1, frame.cols - 2);
  const lines = wrap(message, width);
  const top = Math.max(0, Math.floor((frame.rows - lines.length) / 2));
  lines.forEach((line, i) => frame.textCentered(0, top + i, frame.cols, line, C.text, C.panel));
}
