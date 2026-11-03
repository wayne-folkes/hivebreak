// Keyboard input from a terminal. Terminals send bytes, not key-down and key-up events, so this
// file has two halves:
//
// - KeyParser turns the raw bytes from stdin into key events. It understands the usual escape
//   codes (arrows, Enter, Esc, Backspace, Tab, printable characters, Ctrl+letter), bracketed
//   paste, and the kitty keyboard protocol (CSI u), which modern terminals (Ghostty, kitty,
//   WezTerm, Alacritty, foot, recent iTerm2) use to report key releases as well as presses.
// - KeyState keeps which game actions are held and which were just pressed. With release events
//   it is exact. Without them (Apple's Terminal, say) a key counts as held for a short time after
//   its last press or auto-repeat, which is the best a terminal can do.

/** press, an auto-repeat while held, or release (release only arrives under the kitty protocol). */
export type KeyEventKind = 'press' | 'repeat' | 'release';

export interface KeyEvent {
  /**
   * 'left' | 'right' | 'up' | 'down' | 'enter' | 'escape' | 'space' | 'tab' | 'backspace' |
   * 'delete' | 'shift' (kitty only: the Shift key on its own), a single lowercase character for
   * any other printable key ('a', 'x', '1', '-'), 'paste' for a bracketed paste, 'reply' for a
   * terminal's answer to a query (see `text`), or 'focusIn' / 'focusOut' when the terminal gains
   * or loses focus (sent only after FOCUS_ON). After a focusOut, key releases may have gone to
   * another app, so nothing can be trusted to still be held.
   */
  key: string;
  kind: KeyEventKind;
  ctrl: boolean;
  shift: boolean;
  /**
   * A printable key's character as typed (case kept: 'A' with Shift); a paste's text; for a
   * 'reply', 'kitty' (the answer to the kitty keyboard query) or 'da' (the answer to the
   * primary device attributes query). Space also carries ' ', so a text field can insert `text`
   * for every key that types something.
   */
  text?: string;
}

/** Asks whether the kitty keyboard protocol is supported. Supporting terminals answer CSI ? flags u; every terminal answers the DA query after it. */
export const KITTY_QUERY = '\x1b[?u\x1b[c';
/** Turns on: disambiguate (1), report event types (2), report alternate keys (4), report all keys as escape codes (8). */
export const KITTY_PUSH = '\x1b[>15u';
/** Restores the keyboard mode pushed by KITTY_PUSH. */
export const KITTY_POP = '\x1b[<u';
/** Asks the terminal to report window focus changes as CSI I (in) and CSI O (out). */
export const FOCUS_ON = '\x1b[?1004h';
/** Stops the focus reports started by FOCUS_ON. */
export const FOCUS_OFF = '\x1b[?1004l';

/**
 * How many flush() calls in a row, with no new bytes between them, it takes to give up on a paste
 * whose end marker never came. A paste is swallowed whole (it must never leak out as keystrokes),
 * so it gets far more patience than a lone ESC, which flush() resolves at once.
 */
export const PASTE_STALE_FLUSHES = 4;

const PASTE_END = '\x1b[201~';

// Kitty modifier bits (the `mods` field is 1 + these).
const MOD_SHIFT = 1;
const MOD_CTRL = 4;
const MOD_CAPS = 64;

const ARROWS: Record<string, string> = { A: 'up', B: 'down', C: 'right', D: 'left' };

/** Builds an event with the modifier bitfield unpacked. */
function makeEvent(key: string, kind: KeyEventKind, bits: number, text?: string): KeyEvent {
  const e: KeyEvent = { key, kind, ctrl: (bits & MOD_CTRL) !== 0, shift: (bits & MOD_SHIFT) !== 0 };
  if (text !== undefined) e.text = text;
  return e;
}

/** The character for a code point, or undefined for anything that is not a real character. */
function charFor(cp: number | undefined): string | undefined {
  if (cp === undefined || !Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return undefined;
  if (cp >= 0xd800 && cp <= 0xdfff) return undefined;
  return String.fromCodePoint(cp);
}

/** The lowercase key name for a printable character; guards the odd characters that lowercase to several. */
function lowerKey(ch: string): string {
  const lower = ch.toLowerCase();
  return [...lower].length === 1 ? lower : ch;
}

/** A printable character typed in legacy mode: the key is lowercase, `text` keeps the case, an uppercase letter means Shift. */
function printable(ch: string): KeyEvent {
  const key = lowerKey(ch);
  return { key, kind: 'press', ctrl: false, shift: key !== ch, text: ch };
}

/** Maps one legacy code point (not ESC) to an event, or undefined for bytes that mean nothing here. */
function legacyKey(cp: number): KeyEvent | undefined {
  // Enter and Tab are also Ctrl+M and Ctrl+I, and Backspace arrives as either DEL or Ctrl+H, so
  // they are named before the Ctrl+letter range is looked at.
  if (cp === 0x0d || cp === 0x0a) return makeEvent('enter', 'press', 0);
  if (cp === 0x09) return makeEvent('tab', 'press', 0);
  if (cp === 0x7f || cp === 0x08) return makeEvent('backspace', 'press', 0);
  if (cp === 0x20) return makeEvent('space', 'press', 0, ' ');
  if (cp >= 0x01 && cp <= 0x1a) return makeEvent(String.fromCharCode(0x60 + cp), 'press', MOD_CTRL);
  if (cp < 0x20 || (cp >= 0x80 && cp <= 0x9f)) return undefined;
  const ch = charFor(cp);
  return ch === undefined ? undefined : printable(ch);
}

/** One `;`-separated CSI field, split on `:` into numbers (undefined where empty or not a number). */
function parseField(field: string | undefined): (number | undefined)[] {
  if (field === undefined || field === '') return [];
  return field.split(':').map((part) => {
    if (part === '') return undefined;
    const n = Number(part);
    return Number.isFinite(n) ? n : undefined;
  });
}

function pasteEvent(text: string): KeyEvent {
  return { key: 'paste', kind: 'press', ctrl: false, shift: false, text };
}

export class KeyParser {
  private buf = '';
  private inPaste = false;
  private staleFlushes = 0;

  /** Parses a chunk of stdin. Incomplete sequences at the end are kept for the next chunk. */
  feed(chunk: string): KeyEvent[] {
    this.staleFlushes = 0;
    this.buf += chunk;
    return this.parse(false);
  }

  /**
   * Called when no more bytes came for a moment: a lone ESC kept back is the Escape key, and an
   * unfinished escape sequence is dropped. An unfinished paste is kept until this has been called
   * PASTE_STALE_FLUSHES times in a row with no bytes in between, then it ends as is. So while
   * `pending` is true, keep calling this every ~30 ms rather than once.
   */
  flush(): KeyEvent[] {
    if (this.inPaste) {
      this.staleFlushes += 1;
      if (this.staleFlushes < PASTE_STALE_FLUSHES) return [];
      const text = this.buf;
      this.buf = '';
      this.inPaste = false;
      this.staleFlushes = 0;
      return [pasteEvent(text)];
    }
    const out = this.parse(true);
    this.buf = '';
    return out;
  }

  /** True when bytes are kept back waiting for the rest of a sequence (the caller should flush soon). */
  get pending(): boolean {
    return this.inPaste || this.buf.length > 0;
  }

  /** Consumes this.buf as far as it can; with `final`, an incomplete tail is resolved instead of kept. */
  private parse(final: boolean): KeyEvent[] {
    const out: KeyEvent[] = [];
    const s = this.buf;
    let i = 0;
    while (i < s.length) {
      if (this.inPaste) {
        // Everything up to the end marker is paste text, escapes and all.
        const end = s.indexOf(PASTE_END, i);
        if (end < 0) break;
        out.push(pasteEvent(s.slice(i, end)));
        i = end + PASTE_END.length;
        this.inPaste = false;
        continue;
      }
      const code = s.charCodeAt(i);
      if (code === 0x1b) {
        const next = this.parseEscape(s, i, final, out);
        if (next < 0) break;
        i = next;
        continue;
      }
      // A high surrogate at the very end is half a character: wait for the other half.
      if (code >= 0xd800 && code <= 0xdbff && i + 1 >= s.length) {
        if (final) i = s.length;
        break;
      }
      const cp = s.codePointAt(i) as number;
      i += cp > 0xffff ? 2 : 1;
      const e = legacyKey(cp);
      if (e) out.push(e);
    }
    this.buf = s.slice(i);
    return out;
  }

  /** Handles the ESC at s[i]. Returns the index after what it consumed, or -1 if more bytes are needed. */
  private parseEscape(s: string, i: number, final: boolean, out: KeyEvent[]): number {
    if (i + 1 >= s.length) {
      if (!final) return -1;
      out.push(makeEvent('escape', 'press', 0));
      return s.length;
    }
    const next = s[i + 1];
    if (next === '[') return this.parseCsi(s, i, final, out);
    if (next === 'O') {
      if (i + 2 >= s.length) return final ? s.length : -1;
      const dir = ARROWS[s[i + 2]];
      if (dir) out.push(makeEvent(dir, 'press', 0));
      return i + 3;
    }
    const nextCode = s.charCodeAt(i + 1);
    if (nextCode < 0x20 || nextCode === 0x7f || nextCode === 0x20) {
      // Escape then Enter / Space / Backspace / Tab / another Escape / a Ctrl key, all in one
      // chunk: a quick Esc tap followed by a key is far likelier than Alt+Enter and friends, so
      // the Escape is a key of its own and the next byte is read as usual.
      out.push(makeEvent('escape', 'press', 0));
      return i + 1;
    }
    // ESC + a printable character is Alt+character; the game has no use for Alt, so it is just the character.
    const cp = s.codePointAt(i + 1) as number;
    const e = legacyKey(cp);
    if (e) out.push(e);
    return i + 1 + (cp > 0xffff ? 2 : 1);
  }

  /** Handles the CSI sequence starting at s[i] (ESC [). Returns the next index, or -1 if incomplete. */
  private parseCsi(s: string, i: number, final: boolean, out: KeyEvent[]): number {
    let j = i + 2;
    for (; j < s.length; j++) {
      const c = s.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) break; // the final byte
      // Parameters and intermediates are 0x20-0x3f. Anything else means a broken sequence: drop
      // what we saw and let the offending byte be read normally (it may be the start of another).
      if (c < 0x20 || c > 0x7e) return j;
    }
    if (j >= s.length) return final ? s.length : -1;
    this.handleCsi(s.slice(i + 2, j), s[j], out);
    return j + 1;
  }

  private handleCsi(params: string, fin: string, out: KeyEvent[]): void {
    const first = params[0];
    if (first === '?') {
      // Terminal replies to our startup queries: never keys.
      if (fin === 'u') out.push({ key: 'reply', kind: 'press', ctrl: false, shift: false, text: 'kitty' });
      else if (fin === 'c') out.push({ key: 'reply', kind: 'press', ctrl: false, shift: false, text: 'da' });
      return;
    }
    if (first === '<' || first === '=' || first === '>') return; // other private sequences
    if (/[\x20-\x2f]/.test(params)) return; // has intermediate bytes: not a key we know

    if (fin === '~' && params === '200') {
      this.inPaste = true;
      return;
    }

    if (params === '' && (fin === 'I' || fin === 'O')) {
      out.push(makeEvent(fin === 'I' ? 'focusIn' : 'focusOut', 'press', 0));
      return;
    }

    const fields = params.split(';').map(parseField);
    const mods = fields[1]?.[0] ?? 1;
    const bits = mods > 1 ? mods - 1 : 0;
    const eventType = fields[1]?.[1] ?? 1;
    const kind: KeyEventKind = eventType === 2 ? 'repeat' : eventType === 3 ? 'release' : 'press';

    if (fin === 'u') {
      this.handleKitty(fields[0] ?? [], bits, kind, out);
    } else if (ARROWS[fin]) {
      out.push(makeEvent(ARROWS[fin], kind, bits));
    } else if (fin === '~') {
      if (fields[0]?.[0] === 3) out.push(makeEvent('delete', kind, bits));
    } else if (fin === 'Z') {
      // Shift+Tab in legacy terminals.
      out.push(makeEvent('tab', kind, bits | MOD_SHIFT));
    }
    // Everything else (Home, End, F-keys, mouse, ...) is consumed and ignored.
  }

  /** `CSI code[:shifted[:base]] ; mods[:event] ; text u` */
  private handleKitty(codeField: (number | undefined)[], bits: number, kind: KeyEventKind, out: KeyEvent[]): void {
    const code = codeField[0];
    if (code === undefined) return;
    switch (code) {
      case 13:
        out.push(makeEvent('enter', kind, bits));
        return;
      case 9:
        out.push(makeEvent('tab', kind, bits));
        return;
      case 127:
      case 8:
        out.push(makeEvent('backspace', kind, bits));
        return;
      case 27:
        out.push(makeEvent('escape', kind, bits));
        return;
      case 32:
        out.push(makeEvent('space', kind, bits, ' '));
        return;
      case 57441: // left shift
      case 57447: // right shift
        out.push(makeEvent('shift', kind, bits));
        return;
    }
    // Other modifiers, keypad, media keys: private-use codes the game has no use for.
    if (code >= 57344 && code <= 63743) return;
    if (code < 32) return;
    const ch = charFor(code);
    if (ch === undefined) return;
    // Shift gives the shifted key (or the capital); Caps Lock capitalises letters only, and the
    // two together cancel out, as in any text field. Codes like HB1's are case-sensitive.
    const isLetter = ch.toLowerCase() !== ch.toUpperCase();
    const shiftHeld = (bits & MOD_SHIFT) !== 0;
    const capsHeld = (bits & MOD_CAPS) !== 0 && isLetter;
    let text = ch;
    if (shiftHeld && capsHeld) text = ch.toLowerCase();
    else if (shiftHeld) text = charFor(codeField[1]) ?? ch.toUpperCase();
    else if (capsHeld) text = ch.toUpperCase();
    out.push(makeEvent(lowerKey(ch), kind, bits, text));
  }
}

/** What the game reads from the keyboard. */
export type Action =
  | 'left'
  | 'right'
  | 'fire'
  | 'special'
  | 'up'
  | 'down'
  | 'confirm'
  | 'back'
  | 'autofire';

/** Key name -> actions. A table so the bindings are readable at a glance (and ↑ and space can serve two). */
const BINDINGS: Readonly<Record<string, readonly Action[]>> = {
  left: ['left'],
  a: ['left'],
  h: ['left'],
  right: ['right'],
  d: ['right'],
  l: ['right'],
  space: ['fire', 'confirm'],
  z: ['fire'],
  up: ['fire', 'up'],
  x: ['special'],
  shift: ['special'],
  w: ['up'],
  k: ['up'],
  down: ['down'],
  s: ['down'],
  j: ['down'],
  enter: ['confirm'],
  escape: ['back'],
  p: ['back'],
  f: ['autofire'],
};

/**
 * The actions a key event's key stands for:
 *   left: ← a h · right: → d l · fire: space z ↑ · special: x, shift (kitty) ·
 *   up: ↑ w k · down: ↓ s j · confirm: enter space · back: escape p · autofire: f
 * A key with Ctrl held stands for none (Ctrl+C and friends are not game keys).
 */
export function actionsFor(e: KeyEvent): Action[] {
  if (e.ctrl) return [];
  const actions = Object.hasOwn(BINDINGS, e.key) ? BINDINGS[e.key] : undefined;
  return actions ? [...actions] : [];
}

/** 'release': key releases are reported (kitty protocol). 'repeat': only presses and auto-repeats. */
export type KeyMode = 'release' | 'repeat';

// --- Repeat mode timing -------------------------------------------------------------------------
//
// Without release events, a held key looks like: one press, a pause (the OS's initial repeat
// delay, typically 250-660 ms), then repeats every 30-90 ms. We treat a key as held for a window
// after each event. The window after a press must outlast the initial delay or the key would let
// go in the gap before its first repeat; the window after a repeat only needs to outlast the
// interval. Long windows make taps sluggish, short ones make holds stutter, so both are learned
// from the user's own keyboard.

/** Held-for after a press, before anything has been learned. Covers a typical 250-350 ms initial delay. */
export const INITIAL_WINDOW_DEFAULT = 300;
/** The learned initial window never goes below this... */
export const INITIAL_WINDOW_MIN = 120;
/** ...or above this: a longer window would make every tap feel stuck. */
export const INITIAL_WINDOW_MAX = 650;
/** Added to the observed initial delay so jitter in event delivery doesn't open a gap. */
export const INITIAL_WINDOW_PAD = 50;
/** Held-for after an auto-repeat, before anything has been learned. */
export const REPEAT_WINDOW_DEFAULT = 140;
export const REPEAT_WINDOW_MIN = 60;
export const REPEAT_WINDOW_MAX = 200;
/** The repeat window is this many times the observed repeat interval, so one late repeat doesn't drop the key. */
export const REPEAT_WINDOW_FACTOR = 2.5;

/** How far past the repeat window a key's next event still continues its repeat chain. */
export const CHAIN_SLACK = 60;
/**
 * A second event of a key this long after the previous one (or less, but more than a repeat chain
 * allows) could be the first auto-repeat of a hold or a deliberate second tap, and nothing but
 * what follows can tell. KeyState holds such an event back until it knows (see DECIDE_MS). macOS
 * defaults to a 375 ms initial delay, so this has to be well above that.
 */
export const AMBIGUOUS_MAX = 700;
/** Once the initial delay is known, a gap this much shorter than it is plainly a fresh tap, decided at once. */
export const AMBIGUOUS_TOLERANCE = 60;
/**
 * How long a held-back event waits for the next event of its key: if one comes sooner, it was a
 * hold and both are auto-repeats; if not, it was a fresh tap (poll() then releases it as a press).
 * This is the default; once the repeat interval is learned it is `decideMsFor(interval)`, which
 * `KeyState.decideMs` gives. It needs to outlast one repeat interval plus jitter, but every
 * millisecond is a delay on a deliberate second tap, hence the bounds.
 */
export const DECIDE_MS = 120;
export const DECIDE_MS_MIN = 60;
export const DECIDE_MS_MAX = 150;
/** Gaps up to this long between events of one key are still looked at for learning; longer ones are plainly separate presses. */
export const FORGET_MS = 1200;
/**
 * Gaps outside these bounds are not taken as timing samples. Real initial delays start around
 * 225 ms, so a shorter gap is a double tap (mashing fire), not a repeat delay; real repeat
 * intervals are 8-150 ms.
 */
export const INITIAL_DELAY_SAMPLE_MIN = 180;
export const INTERVAL_SAMPLE_MIN = 8;
export const INTERVAL_SAMPLE_MAX = 150;
/** The initial delay is the smallest of this many recent samples (a delay can only be mis-measured upwards). */
const INITIAL_SAMPLES_KEPT = 5;
/** The repeat interval is the mean of this many recent samples. */
const INTERVAL_SAMPLES_KEPT = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The held-for window after a press, given an observed initial repeat delay. */
export function initialWindowFor(initialDelayMs: number): number {
  return clamp(initialDelayMs + INITIAL_WINDOW_PAD, INITIAL_WINDOW_MIN, INITIAL_WINDOW_MAX);
}

/** The held-for window after an auto-repeat, given an observed repeat interval. */
export function repeatWindowFor(intervalMs: number): number {
  return clamp(intervalMs * REPEAT_WINDOW_FACTOR, REPEAT_WINDOW_MIN, REPEAT_WINDOW_MAX);
}

/** How long to wait for a held-back event's follow-up, given an observed repeat interval. */
export function decideMsFor(intervalMs: number): number {
  return clamp(intervalMs * REPEAT_WINDOW_FACTOR, DECIDE_MS_MIN, DECIDE_MS_MAX);
}

const DIRECTIONAL: ReadonlySet<Action> = new Set<Action>(['left', 'right', 'up', 'down']);
const OPPOSITE: Partial<Record<Action, Action>> = { left: 'right', right: 'left' };

/** One physical key that is down (release mode) or recently seen (repeat mode). */
interface Track {
  actions: Action[];
  /** When its last event arrived. */
  last: number;
  /** Held while now < until. Infinity in release mode: it stays until its release event. */
  until: number;
  /** Repeat mode: auto-repeats seen since the press that began this hold. */
  repeats: number;
  /**
   * Repeat mode: a gap that might have been the initial repeat delay, waiting to be confirmed.
   * It counts only if the next event follows quickly (a real hold goes press, pause, repeat,
   * repeat...; a double tap goes press, pause, press and stops).
   */
  candidate?: number;
  /**
   * releaseAll() was called while this key was down. It keeps its place in the repeat chain (so
   * its auto-repeats are still recognised as repeats) but counts as neither held nor pressed
   * until it is released (release mode) or its chain lapses (repeat mode).
   */
  suppressed: boolean;
}

/** Events that are not keys being typed: they never take part in held / repeat tracking. */
const NOT_KEYS: ReadonlySet<string> = new Set(['paste', 'reply', 'focusIn', 'focusOut']);

/** An event held back because it might be a hold's first auto-repeat or a deliberate second tap. */
interface Pending {
  event: KeyEvent;
  actions: Action[];
  /** When it arrived. */
  time: number;
  /** Time since the key's previous event: the initial delay, if this turns out to be a hold. */
  gap: number;
  /** At or after this time with nothing more from the key, it was a fresh tap. */
  decideAt: number;
}

export class KeyState {
  private tracks = new Map<string, Track>();
  private justPressed = new Set<Action>();
  private initialSamples: number[] = [];
  private intervalSamples: number[] = [];
  private _mode: KeyMode;
  /** The latest time seen (in feed or held): releaseAll() has no clock of its own to tell which keys are still live. */
  private clock = 0;
  /** Repeat mode: events held back until it is known whether they are repeats or fresh taps (one per key). */
  private pending = new Map<string, Pending>();

  constructor(mode: KeyMode) {
    this._mode = mode;
  }

  get mode(): KeyMode {
    return this._mode;
  }

  /** Switching mode (the game does once it finds kitty support) forgets held keys: the two modes track them differently. */
  set mode(mode: KeyMode) {
    if (mode === this._mode) return;
    this._mode = mode;
    this.tracks.clear();
    this.pending.clear();
  }

  /** Repeat mode: how long a fresh press counts as held (learned from the user's keyboard). */
  get initialWindow(): number {
    return this.initialSamples.length === 0
      ? INITIAL_WINDOW_DEFAULT
      : initialWindowFor(Math.min(...this.initialSamples));
  }

  /** Repeat mode: how long an auto-repeat counts as held (learned from the user's keyboard). */
  get repeatWindow(): number {
    if (this.intervalSamples.length === 0) return REPEAT_WINDOW_DEFAULT;
    const mean = this.intervalSamples.reduce((a, b) => a + b, 0) / this.intervalSamples.length;
    return repeatWindowFor(mean);
  }

  /** Repeat mode: how long a held-back event waits for its follow-up (learned from the user's keyboard). */
  get decideMs(): number {
    if (this.intervalSamples.length === 0) return DECIDE_MS;
    const mean = this.intervalSamples.reduce((a, b) => a + b, 0) / this.intervalSamples.length;
    return decideMsFor(mean);
  }

  /**
   * Folds in key events (as they arrive), at time `nowMs`. Returns the events to act on, with
   * `kind` corrected: in 'repeat' mode, where the parser can only say 'press', a press this judges
   * to be an auto-repeat comes back as 'repeat' (a copy; the input is not changed), so a menu can
   * ignore a held Space. In 'release' mode the parser's kinds are already right and pass through
   * as is.
   *
   * In 'repeat' mode a key's second event can be a hold's first auto-repeat or a deliberate second
   * tap, and nothing but what follows can tell. Such an event is held back (the key still counts
   * as held meanwhile): the next event of the key within decideMs makes both repeats, returned
   * together here; otherwise it is a fresh tap and comes out of poll() (or of a later feed()) as a
   * press. So the result can hold more or fewer events than `events`, and not in arrival order.
   */
  feed(events: readonly KeyEvent[], nowMs: number): KeyEvent[] {
    this.clock = Math.max(this.clock, nowMs);
    const out: KeyEvent[] = [];
    if (this._mode === 'repeat') this.releaseDue(nowMs, out);
    for (const e of events) {
      if (this._mode === 'release') out.push(this.feedExact(e, nowMs));
      else this.feedTimed(e, nowMs, out);
    }
    if (this._mode === 'repeat') {
      // Keep a key's track a little past its window: the next event's gap is what teaches the timings.
      for (const [key, t] of this.tracks) if (nowMs - t.last > FORGET_MS) this.tracks.delete(key);
    }
    return out;
  }

  /**
   * Repeat mode: the held-back events whose decision time has passed at `nowMs`, as presses (they
   * were fresh taps, not repeats), counted by pressed() from now. Call once per frame right after
   * feed() and treat the events like feed()'s. Always empty in release mode.
   */
  poll(nowMs: number): KeyEvent[] {
    this.clock = Math.max(this.clock, nowMs);
    const out: KeyEvent[] = [];
    this.releaseDue(nowMs, out);
    return out;
  }

  /** Whether an action is held at `nowMs`. */
  held(action: Action, nowMs: number): boolean {
    this.clock = Math.max(this.clock, nowMs);
    for (const t of this.tracks.values()) {
      if (!t.suppressed && nowMs < t.until && t.actions.includes(action)) return true;
    }
    return false;
  }

  /** Whether an action was pressed since endFrame(). Up, down, left and right also count auto-repeats; the rest count only presses. */
  pressed(action: Action): boolean {
    return this.justPressed.has(action);
  }

  /**
   * Stops everything held from counting, e.g. when a card changes so a held Space or Enter
   * doesn't confirm the next card or keep firing. A key that is down stays ignored (its
   * auto-repeats still come back from feed() as kind 'repeat') until it is released, or in repeat
   * mode until its auto-repeats stop; after that a new press works normally.
   */
  releaseAll(): void {
    for (const [key, t] of this.tracks) {
      if (this.clock < t.until) t.suppressed = true;
      else if (this._mode === 'release') this.tracks.delete(key);
    }
  }

  /** Lets the held-back events that have waited long enough out as presses. */
  private releaseDue(nowMs: number, out: KeyEvent[]): void {
    for (const [key, p] of this.pending) if (nowMs >= p.decideAt) this.releasePending(key, p, out);
  }

  /** A held-back event turned out to be a fresh tap: it is a press, and a suppressed key is suppressed no more. */
  private releasePending(key: string, p: Pending, out: KeyEvent[]): void {
    this.pending.delete(key);
    const t = this.tracks.get(key);
    if (t) t.suppressed = false;
    this.markPressed(p.actions, false);
    out.push(p.event);
  }

  /** Call once per frame, after reading pressed(). */
  endFrame(): void {
    this.justPressed.clear();
  }

  private markPressed(actions: readonly Action[], isRepeat: boolean): void {
    for (const a of actions) {
      // A held Enter must not confirm every frame, but a held arrow should keep scrolling a menu.
      if (!isRepeat || DIRECTIONAL.has(a)) this.justPressed.add(a);
    }
  }

  /** Release mode: held from press until release. Tracked per key so two keys bound to one action don't release each other. */
  private feedExact(e: KeyEvent, nowMs: number): KeyEvent {
    if (e.key === 'focusOut') {
      this.tracks.clear();
      return e;
    }
    if (e.kind === 'release') {
      this.tracks.delete(e.key);
      return e;
    }
    const actions = actionsFor(e);
    if (actions.length === 0) {
      this.tracks.delete(e.key);
      return e;
    }
    const prev = this.tracks.get(e.key);
    if (e.kind === 'repeat' && prev?.suppressed) {
      prev.last = nowMs; // still down after releaseAll(): stays ignored
      return e;
    }
    this.tracks.set(e.key, { actions, last: nowMs, until: Infinity, repeats: 0, suppressed: false });
    this.markPressed(actions, e.kind === 'repeat');
    return e;
  }

  /** Repeat mode: guess from timing whether this event is a new press or an auto-repeat, learn the timings, and set the held window. */
  private feedTimed(e: KeyEvent, nowMs: number, out: KeyEvent[]): void {
    if (e.key === 'focusOut') {
      // The key-ups go to another app, so nothing can be told to still be held.
      this.tracks.clear();
      this.pending.clear();
      out.push(e);
      return;
    }
    const waiting = this.pending.get(e.key);
    if (e.kind === 'release' || e.ctrl) {
      // Not something a hold's follow-up looks like: whatever was held back was a tap.
      if (waiting) this.releasePending(e.key, waiting, out);
      this.tracks.delete(e.key);
      out.push(e);
      return;
    }
    if (NOT_KEYS.has(e.key)) {
      out.push(e);
      return;
    }
    // Every other key is tracked, bound or not: a held R must be recognised as repeating too, or
    // its auto-repeats would reach menus as fresh presses.
    const actions = actionsFor(e);

    const prev = this.tracks.get(e.key);
    let isRepeat = false;
    let repeats = 0;
    let candidate: number | undefined;

    if (waiting) {
      // The key again, within decideMs of the held-back event: a hold. The held-back event was
      // its first auto-repeat (its gap from the press is the initial delay) and this is the second.
      this.pending.delete(e.key);
      if (waiting.gap >= INITIAL_DELAY_SAMPLE_MIN) this.learnInitial(waiting.gap);
      this.learnInterval(nowMs - waiting.time);
      if (prev?.suppressed !== true) this.markPressed(waiting.actions, true);
      out.push({ ...waiting.event, kind: 'repeat' });
      isRepeat = true;
      repeats = 2;
    } else if (e.kind === 'repeat') {
      // Not something the parser produces without release events, but trust it if it does.
      isRepeat = true;
      repeats = (prev?.repeats ?? 0) + 1;
    } else if (prev) {
      const gap = nowMs - prev.last;
      const chainLimit = this.repeatWindow + CHAIN_SLACK;
      if (prev.repeats >= 1) {
        // Already auto-repeating: the next event is another repeat unless the gap is too long.
        if (gap <= chainLimit) {
          isRepeat = true;
          repeats = prev.repeats + 1;
          if (prev.candidate !== undefined) this.learnInitial(prev.candidate);
          this.learnInterval(gap);
        }
      } else if (prev.candidate !== undefined && gap <= chainLimit) {
        // The previous event came after a very long pause and this one follows quickly: it was
        // the first auto-repeat after all, arriving later than anything could be held back for.
        isRepeat = true;
        repeats = 1;
        this.learnInitial(prev.candidate);
        this.learnInterval(gap);
      } else if (this.isAmbiguous(gap, chainLimit)) {
        this.holdBack(e, actions, prev, nowMs, gap);
        return;
      } else if (gap <= FORGET_MS && (gap > AMBIGUOUS_MAX || (this.initialSamples.length === 0 && gap >= INITIAL_DELAY_SAMPLE_MIN))) {
        // A press that might still turn out to have been a repeat (a very slow initial delay, or
        // a very quick one): remember the gap and see whether the next event follows quickly.
        candidate = gap;
      }
    }

    // A key still down after releaseAll() stays ignored until its chain lapses.
    const suppressed = isRepeat && prev?.suppressed === true;

    if (!suppressed) this.cancelOpposite(e.key, actions, out);

    const until = nowMs + (isRepeat ? this.repeatWindow : this.initialWindow);
    this.tracks.set(e.key, { actions, last: nowMs, until, repeats, candidate, suppressed });
    if (!suppressed) this.markPressed(actions, isRepeat);
    out.push(isRepeat && e.kind !== 'repeat' ? { ...e, kind: 'repeat' } : e);
  }

  /**
   * Whether an event `gap` ms after the key's last one could be a hold's first auto-repeat as well
   * as a deliberate second tap. Not if it is soon enough to be a repeat chain's next beat (then
   * it is no first repeat: initial delays are over 200 ms), nor, once the user's initial delay is
   * known, if it is clearly shorter than that: a fast double tap is a press at once.
   */
  private isAmbiguous(gap: number, chainLimit: number): boolean {
    if (gap <= chainLimit || gap > AMBIGUOUS_MAX) return false;
    if (this.initialSamples.length === 0) return true;
    return gap >= Math.min(...this.initialSamples) - AMBIGUOUS_TOLERANCE;
  }

  /** Holds an event back for decideMs. Meanwhile the key counts as held, as after any press. */
  private holdBack(e: KeyEvent, actions: Action[], prev: Track, nowMs: number, gap: number): void {
    this.pending.set(e.key, { event: e, actions, time: nowMs, gap, decideAt: nowMs + this.decideMs });
    if (!prev.suppressed) this.cancelOpposite(e.key, actions, []);
    this.tracks.set(e.key, {
      actions,
      last: nowMs,
      until: nowMs + this.initialWindow,
      repeats: 0,
      suppressed: prev.suppressed,
    });
  }

  /**
   * Terminals repeat only the last key pressed, so a direction pressed against the other one
   * means the other is let go (what it had held back, if anything, was a tap and comes out now).
   */
  private cancelOpposite(key: string, actions: readonly Action[], out: KeyEvent[]): void {
    for (const a of actions) {
      const opposite = OPPOSITE[a];
      if (!opposite) continue;
      for (const [otherKey, t] of this.tracks) {
        if (otherKey === key || !t.actions.includes(opposite)) continue;
        const p = this.pending.get(otherKey);
        if (p) this.releasePending(otherKey, p, out);
        this.tracks.delete(otherKey);
      }
    }
  }

  private learnInitial(delay: number): void {
    this.initialSamples.push(delay);
    if (this.initialSamples.length > INITIAL_SAMPLES_KEPT) this.initialSamples.shift();
  }

  private learnInterval(gap: number): void {
    if (gap < INTERVAL_SAMPLE_MIN || gap > INTERVAL_SAMPLE_MAX) return;
    this.intervalSamples.push(gap);
    if (this.intervalSamples.length > INTERVAL_SAMPLES_KEPT) this.intervalSamples.shift();
  }
}
