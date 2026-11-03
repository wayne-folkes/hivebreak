import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  AMBIGUOUS_MAX,
  CHAIN_SLACK,
  DECIDE_MS,
  decideMsFor,
  INITIAL_WINDOW_DEFAULT,
  initialWindowFor,
  FOCUS_OFF,
  FOCUS_ON,
  KeyParser,
  KeyState,
  KITTY_POP,
  KITTY_PUSH,
  KITTY_QUERY,
  PASTE_STALE_FLUSHES,
  REPEAT_WINDOW_DEFAULT,
  repeatWindowFor,
  type Action,
  type KeyEvent,
  type KeyEventKind,
} from './keys';

/** The event a plain press of `key` produces. */
function k(key: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { key, kind: 'press', ctrl: false, shift: false, ...extra };
}

/** Feeds chunks to a fresh parser and collects everything. */
function parse(...chunks: string[]): KeyEvent[] {
  const p = new KeyParser();
  return chunks.flatMap((c) => p.feed(c));
}

describe('KeyParser: legacy keys', () => {
  it('reads printable characters, keeping the case in text', () => {
    expect(parse('a')).toEqual([k('a', { text: 'a' })]);
    expect(parse('A')).toEqual([k('a', { text: 'A', shift: true })]);
    expect(parse('1')).toEqual([k('1', { text: '1' })]);
    expect(parse('-')).toEqual([k('-', { text: '-' })]);
    expect(parse('é')).toEqual([k('é', { text: 'é' })]);
    expect(parse('😀')).toEqual([k('😀', { text: '😀' })]);
    expect(parse('abc').map((e) => e.key)).toEqual(['a', 'b', 'c']);
  });

  it('reads Enter, Tab, Backspace and Space', () => {
    expect(parse('\r')).toEqual([k('enter')]);
    expect(parse('\n')).toEqual([k('enter')]);
    expect(parse('\t')).toEqual([k('tab')]);
    expect(parse('\x7f')).toEqual([k('backspace')]);
    expect(parse('\b')).toEqual([k('backspace')]);
    expect(parse(' ')).toEqual([k('space', { text: ' ' })]);
  });

  it('reads Ctrl+letter, but not for Tab and Enter', () => {
    expect(parse('\x01')).toEqual([k('a', { ctrl: true })]);
    expect(parse('\x03')).toEqual([k('c', { ctrl: true })]);
    expect(parse('\x1a')).toEqual([k('z', { ctrl: true })]);
    expect(parse('\t')[0].ctrl).toBe(false);
    expect(parse('\r')[0].ctrl).toBe(false);
  });

  it('reads the arrows in both CSI and SS3 form', () => {
    expect(parse('\x1b[A\x1b[B\x1b[C\x1b[D').map((e) => e.key)).toEqual(['up', 'down', 'right', 'left']);
    expect(parse('\x1bOA\x1bOB\x1bOC\x1bOD').map((e) => e.key)).toEqual(['up', 'down', 'right', 'left']);
  });

  it('reads modified arrows, Delete and Shift+Tab', () => {
    expect(parse('\x1b[1;5A')).toEqual([k('up', { ctrl: true })]);
    expect(parse('\x1b[1;2C')).toEqual([k('right', { shift: true })]);
    expect(parse('\x1b[3~')).toEqual([k('delete')]);
    expect(parse('\x1b[Z')).toEqual([k('tab', { shift: true })]);
  });

  it('treats ESC plus a character as that character (Alt+key)', () => {
    expect(parse('\x1bx')).toEqual([k('x', { text: 'x' })]);
  });

  it('consumes unknown sequences without emitting them as text', () => {
    expect(parse('x\x1b[15~y').map((e) => e.key)).toEqual(['x', 'y']);
    expect(parse('x\x1b[1;5Hy').map((e) => e.key)).toEqual(['x', 'y']);
    expect(parse('x\x1bOPy').map((e) => e.key)).toEqual(['x', 'y']);
    expect(parse('x\x1b[<0;10;5My').map((e) => e.key)).toEqual(['x', 'y']);
    expect(parse('x\x1b[0 qy').map((e) => e.key)).toEqual(['x', 'y']);
  });

  it('survives a broken sequence without losing the next byte', () => {
    expect(parse('\x1b[1\x03').map((e) => e.key)).toEqual(['c']);
  });

  it('gives the same events however the input is split', () => {
    const input = 'a\x1b[Ab\x1bOD\x1b[1;5C\x1b[3~ \x1b[200~hi\x1b[0m\x1b[201~\x1b[97;1:3u\x1b[?0u\x1b[?62;c😀';
    const whole = parse(input);
    expect(whole.length).toBeGreaterThan(8);
    for (let i = 1; i < input.length; i++) {
      expect(parse(input.slice(0, i), input.slice(i))).toEqual(whole);
    }
    // And one character at a time.
    expect(parse(...[...input])).toEqual(whole);
  });
});

describe('KeyParser: Escape and incomplete input', () => {
  it('keeps a lone ESC until flushed', () => {
    const p = new KeyParser();
    expect(p.feed('\x1b')).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.flush()).toEqual([k('escape')]);
    expect(p.pending).toBe(false);
    expect(p.flush()).toEqual([]);
  });

  it('does not make an Escape of an ESC whose [ arrives in the next chunk', () => {
    const p = new KeyParser();
    expect(p.feed('\x1b')).toEqual([]);
    expect(p.feed('[')).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.feed('A')).toEqual([k('up')]);
    expect(p.pending).toBe(false);
  });

  it('reads two ESCs in a row as two Escapes', () => {
    const p = new KeyParser();
    expect(p.feed('\x1b\x1b')).toEqual([k('escape')]);
    expect(p.flush()).toEqual([k('escape')]);
  });

  it('reads ESC followed by Enter, Space, Backspace, Tab, Ctrl or ESC as an Escape tap plus that key', () => {
    expect(parse('\x1b\r')).toEqual([k('escape'), k('enter')]);
    expect(parse('\x1b\n')).toEqual([k('escape'), k('enter')]);
    expect(parse('\x1b\x7f')).toEqual([k('escape'), k('backspace')]);
    expect(parse('\x1b\t')).toEqual([k('escape'), k('tab')]);
    expect(parse('\x1b ')).toEqual([k('escape'), k('space', { text: ' ' })]);
    expect(parse('\x1b\x03')).toEqual([k('escape'), k('c', { ctrl: true })]);
    expect(parse('\x1b\x1b[A')).toEqual([k('escape'), k('up')]);
    // A printable key after ESC is still Alt+key.
    expect(parse('\x1bq').map((e) => e.key)).toEqual(['q']);
  });

  it('drops an unfinished sequence on flush', () => {
    const p = new KeyParser();
    expect(p.feed('\x1b[1;')).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.flush()).toEqual([]);
    expect(p.pending).toBe(false);
    expect(p.feed('a')).toEqual([k('a', { text: 'a' })]);
  });

  it('waits for the second half of a surrogate pair', () => {
    const p = new KeyParser();
    const emoji = '😀';
    expect(p.feed(emoji[0])).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.feed(emoji[1])).toEqual([k(emoji, { text: emoji })]);
  });
});

describe('KeyParser: bracketed paste', () => {
  it('emits one paste event', () => {
    expect(parse('\x1b[200~hello\x1b[201~')).toEqual([k('paste', { text: 'hello' })]);
  });

  it('keeps newlines and escape codes inside the paste as text', () => {
    expect(parse('\x1b[200~a\nb\x1b[Ac\x1b[201~')).toEqual([k('paste', { text: 'a\nb\x1b[Ac' })]);
  });

  it('spans chunks, including a split end marker', () => {
    const p = new KeyParser();
    expect(p.feed('\x1b[20')).toEqual([]);
    expect(p.feed('0~hel')).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.feed('lo\x1b[20')).toEqual([]);
    expect(p.feed('1~x')).toEqual([k('paste', { text: 'hello' }), k('x', { text: 'x' })]);
    expect(p.pending).toBe(false);
  });

  it('is not cut short by a lone flush, but ends after enough idle flushes', () => {
    const p = new KeyParser();
    p.feed('\x1b[200~abc');
    for (let i = 1; i < PASTE_STALE_FLUSHES; i++) expect(p.flush()).toEqual([]);
    expect(p.pending).toBe(true);
    expect(p.flush()).toEqual([k('paste', { text: 'abc' })]);
    expect(p.pending).toBe(false);
  });

  it('resets the idle count when more bytes arrive', () => {
    const p = new KeyParser();
    p.feed('\x1b[200~ab');
    for (let i = 1; i < PASTE_STALE_FLUSHES; i++) p.flush();
    p.feed('c');
    for (let i = 1; i < PASTE_STALE_FLUSHES; i++) expect(p.flush()).toEqual([]);
    expect(p.feed('\x1b[201~')).toEqual([k('paste', { text: 'abc' })]);
  });
});

describe('KeyParser: kitty keyboard protocol', () => {
  const kinds = (s: string) => parse(s).map((e) => e.kind);

  it('has the documented control strings', () => {
    expect(KITTY_QUERY).toBe('\x1b[?u\x1b[c');
    expect(KITTY_PUSH).toBe('\x1b[>15u');
    expect(KITTY_POP).toBe('\x1b[<u');
  });

  it('reads press, repeat and release of a letter', () => {
    expect(parse('\x1b[97u')).toEqual([k('a', { text: 'a' })]);
    expect(parse('\x1b[97;1:1u')).toEqual([k('a', { text: 'a' })]);
    expect(parse('\x1b[97;1:2u')).toEqual([k('a', { text: 'a', kind: 'repeat' })]);
    expect(parse('\x1b[97;1:3u')).toEqual([k('a', { text: 'a', kind: 'release' })]);
  });

  it('reads space, enter, tab, backspace and escape with their event types', () => {
    expect(parse('\x1b[32u')).toEqual([k('space', { text: ' ' })]);
    expect(kinds('\x1b[32;1:2u\x1b[32;1:3u')).toEqual(['repeat', 'release']);
    expect(parse('\x1b[13u')).toEqual([k('enter')]);
    expect(parse('\x1b[13;1:3u')).toEqual([k('enter', { kind: 'release' })]);
    expect(parse('\x1b[9u')).toEqual([k('tab')]);
    expect(parse('\x1b[127u')).toEqual([k('backspace')]);
    expect(parse('\x1b[27u')).toEqual([k('escape')]);
    expect(parse('\x1b[27;1:3u')).toEqual([k('escape', { kind: 'release' })]);
  });

  it('reads arrows and Delete with event types', () => {
    expect(parse('\x1b[A')).toEqual([k('up')]);
    expect(parse('\x1b[1;1A')).toEqual([k('up')]);
    expect(parse('\x1b[1;1:2D')).toEqual([k('left', { kind: 'repeat' })]);
    expect(parse('\x1b[1;1:3C')).toEqual([k('right', { kind: 'release' })]);
    expect(parse('\x1b[1;1:3B')).toEqual([k('down', { kind: 'release' })]);
    expect(parse('\x1b[3;1:3~')).toEqual([k('delete', { kind: 'release' })]);
  });

  it('reads the Shift key on its own, and ignores other modifier and keypad keys', () => {
    expect(parse('\x1b[57441;2u')).toEqual([k('shift', { shift: true })]);
    expect(parse('\x1b[57447;2:2u')).toEqual([k('shift', { shift: true, kind: 'repeat' })]);
    expect(parse('\x1b[57441;1:3u')).toEqual([k('shift', { kind: 'release' })]);
    expect(parse('\x1b[57442;5u')).toEqual([]); // left control
    expect(parse('\x1b[57399u')).toEqual([]); // keypad 0
    expect(parse('\x1b[57358u')).toEqual([]); // caps lock
  });

  it('gives shifted letters their typed text', () => {
    expect(parse('\x1b[97;2u')).toEqual([k('a', { text: 'A', shift: true })]);
    expect(parse('\x1b[97:65;2u')).toEqual([k('a', { text: 'A', shift: true })]);
    expect(parse('\x1b[49:33;2u')).toEqual([k('1', { text: '!', shift: true })]);
    expect(parse('\x1b[97;2:3u')).toEqual([k('a', { text: 'A', shift: true, kind: 'release' })]);
  });

  it('reads the all-keys form with a text field', () => {
    expect(parse('\x1b[97;1;97u')).toEqual([k('a', { text: 'a' })]);
  });

  it('reads Ctrl+C in both forms', () => {
    expect(parse('\x03')).toEqual([k('c', { ctrl: true })]);
    expect(parse('\x1b[99;5u')).toEqual([k('c', { ctrl: true, text: 'c' })]);
    expect(parse('\x1b[99;5u')[0]).toMatchObject({ key: 'c', ctrl: true, kind: 'press' });
    expect(parse('\x1b[99;5:3u')[0]).toMatchObject({ key: 'c', ctrl: true, kind: 'release' });
  });

  it('puts the Alt modifier aside', () => {
    expect(parse('\x1b[97;3u')).toEqual([k('a', { text: 'a' })]);
  });

  it('capitalises letters under Caps Lock, and Shift cancels it', () => {
    expect(parse('\x1b[97;65u')).toEqual([k('a', { text: 'A' })]); // caps lock
    expect(parse('\x1b[97;66u')).toEqual([k('a', { text: 'a', shift: true })]); // shift + caps lock
    expect(parse('\x1b[49;65u')).toEqual([k('1', { text: '1' })]); // caps lock does not touch digits
    expect(parse('\x1b[49:33;66u')).toEqual([k('1', { text: '!', shift: true })]);
    expect(parse('\x1b[97;2u')).toEqual([k('a', { text: 'A', shift: true })]);
  });

  it('survives being split anywhere', () => {
    const input = '\x1b[97:65;2:2u\x1b[1;1:3A\x1b[57441;1:3u';
    const whole = parse(input);
    expect(whole).toHaveLength(3);
    for (let i = 1; i < input.length; i++) expect(parse(input.slice(0, i), input.slice(i))).toEqual(whole);
  });
});

describe('KeyParser: terminal replies', () => {
  it('turns the kitty answer into a reply', () => {
    expect(parse('\x1b[?0u')).toEqual([k('reply', { text: 'kitty' })]);
    expect(parse('\x1b[?15u')).toEqual([k('reply', { text: 'kitty' })]);
  });

  it('turns the device attributes answer into a reply', () => {
    expect(parse('\x1b[?62;4;22c')).toEqual([k('reply', { text: 'da' })]);
    expect(parse('\x1b[?1;2c')).toEqual([k('reply', { text: 'da' })]);
  });

  it('gives both replies in order when a kitty terminal answers the query', () => {
    expect(parse('\x1b[?0u\x1b[?62;c').map((e) => e.text)).toEqual(['kitty', 'da']);
  });

  it('never lets a reply leak out as keys', () => {
    for (const reply of ['\x1b[?0u', '\x1b[?62;4c', '\x1b[>1;2;3c', '\x1b[?1;2c']) {
      expect(parse(reply).filter((e) => e.key !== 'reply')).toEqual([]);
    }
    // Even split in the middle.
    expect(parse('\x1b[?6', '2;4c').map((e) => e.key)).toEqual(['reply']);
  });
});

describe('KeyParser: focus reports', () => {
  it('has the documented control strings', () => {
    expect(FOCUS_ON).toBe('\x1b[?1004h');
    expect(FOCUS_OFF).toBe('\x1b[?1004l');
  });

  it('reads CSI I and CSI O', () => {
    expect(parse('\x1b[I')).toEqual([k('focusIn')]);
    expect(parse('\x1b[O')).toEqual([k('focusOut')]);
    expect(parse('a\x1b[Ob').map((e) => e.key)).toEqual(['a', 'focusOut', 'b']);
  });

  it('is not confused with SS3 sequences, and survives splitting', () => {
    expect(parse('\x1bOA').map((e) => e.key)).toEqual(['up']);
    expect(parse('\x1b', '[', 'O')).toEqual([k('focusOut')]);
  });

  it('stands for no action', () => {
    expect(actionsFor(k('focusIn'))).toEqual([]);
    expect(actionsFor(k('focusOut'))).toEqual([]);
  });
});

describe('actionsFor', () => {
  const table: Record<Action, string[]> = {
    left: ['left', 'a', 'h'],
    right: ['right', 'd', 'l'],
    fire: ['space', 'z', 'up'],
    special: ['x', 'shift'],
    up: ['up', 'w', 'k'],
    down: ['down', 's', 'j'],
    confirm: ['enter', 'space'],
    back: ['escape', 'p'],
    autofire: ['f'],
  };

  it('maps every key to its actions', () => {
    for (const [action, keys] of Object.entries(table)) {
      for (const key of keys) expect(actionsFor(k(key))).toContain(action);
    }
  });

  it('gives each key exactly the actions that list it', () => {
    const allKeys = new Set(Object.values(table).flat());
    for (const key of allKeys) {
      const expected = (Object.keys(table) as Action[]).filter((a) => table[a].includes(key));
      expect([...actionsFor(k(key))].sort()).toEqual([...expected].sort());
    }
    expect(actionsFor(k('space')).sort()).toEqual(['confirm', 'fire']);
    expect(actionsFor(k('up')).sort()).toEqual(['fire', 'up']);
  });

  it('ignores other keys, Ctrl combinations, pastes and replies', () => {
    expect(actionsFor(k('q'))).toEqual([]);
    expect(actionsFor(k('tab'))).toEqual([]);
    expect(actionsFor(k('a', { ctrl: true }))).toEqual([]);
    expect(actionsFor(k('c', { ctrl: true }))).toEqual([]);
    expect(actionsFor(k('paste', { text: 'a' }))).toEqual([]);
    expect(actionsFor(k('reply', { text: 'kitty' }))).toEqual([]);
    expect(actionsFor(k('constructor'))).toEqual([]);
  });

  it('does not let a caller change the bindings', () => {
    actionsFor(k('a')).push('fire');
    expect(actionsFor(k('a'))).toEqual(['left']);
  });

  it('treats a shifted letter as that letter', () => {
    expect(actionsFor(k('a', { shift: true, text: 'A' }))).toEqual(['left']);
  });
});

/** An event of the given kind, as KeyParser would produce it. */
const ev = (key: string, kind: KeyEventKind = 'press'): KeyEvent => k(key, { kind });

describe('KeyState: release mode', () => {
  it('holds from press to release, whatever the time', () => {
    const s = new KeyState('release');
    s.feed([ev('a')], 0);
    expect(s.held('left', 0)).toBe(true);
    expect(s.held('left', 60_000)).toBe(true);
    expect(s.held('right', 0)).toBe(false);
    s.feed([ev('a', 'release')], 100);
    expect(s.held('left', 100)).toBe(false);
  });

  it('keeps repeats held', () => {
    const s = new KeyState('release');
    s.feed([ev('a'), ev('a', 'repeat'), ev('a', 'repeat')], 0);
    expect(s.held('left', 5000)).toBe(true);
  });

  it('does not let releasing one key release another bound to the same action', () => {
    const s = new KeyState('release');
    s.feed([ev('a'), ev('left')], 0);
    s.feed([ev('left', 'release')], 10);
    expect(s.held('left', 10)).toBe(true);
    s.feed([ev('a', 'release')], 20);
    expect(s.held('left', 20)).toBe(false);
  });

  it('holds all actions of a key, and releases them together', () => {
    const s = new KeyState('release');
    s.feed([ev('space')], 0);
    expect(s.held('fire', 0) && s.held('confirm', 0)).toBe(true);
    s.feed([ev('space', 'release')], 5);
    expect(s.held('fire', 5) || s.held('confirm', 5)).toBe(false);
  });

  it('holds both directions at once (exact)', () => {
    const s = new KeyState('release');
    s.feed([ev('a'), ev('d')], 0);
    expect(s.held('left', 1) && s.held('right', 1)).toBe(true);
  });

  it('holds special while the Shift key is down', () => {
    const s = new KeyState('release');
    s.feed([ev('shift')], 0);
    expect(s.held('special', 1)).toBe(true);
    s.feed([ev('shift', 'release')], 2);
    expect(s.held('special', 2)).toBe(false);
  });

  it('reports presses once, and only direction repeats', () => {
    const s = new KeyState('release');
    s.feed([ev('space'), ev('left')], 0);
    expect(s.pressed('fire')).toBe(true);
    expect(s.pressed('confirm')).toBe(true);
    expect(s.pressed('left')).toBe(true);
    s.endFrame();
    expect(s.pressed('fire')).toBe(false);
    s.feed([ev('space', 'repeat'), ev('left', 'repeat'), ev('f', 'repeat')], 50);
    expect(s.pressed('fire')).toBe(false);
    expect(s.pressed('confirm')).toBe(false);
    expect(s.pressed('autofire')).toBe(false);
    expect(s.pressed('left')).toBe(true);
    s.endFrame();
    expect(s.pressed('left')).toBe(false);
  });

  it('ignores Ctrl combinations, pastes and replies', () => {
    const s = new KeyState('release');
    s.feed([k('a', { ctrl: true }), k('paste', { text: 'a' }), k('reply', { text: 'da' })], 0);
    expect(s.held('left', 0)).toBe(false);
    expect(s.pressed('left')).toBe(false);
  });

  it('releaseAll forgets held keys', () => {
    const s = new KeyState('release');
    s.feed([ev('a'), ev('x')], 0);
    s.releaseAll();
    expect(s.held('left', 1) || s.held('special', 1)).toBe(false);
  });

  it('passes the events through unchanged', () => {
    const s = new KeyState('release');
    const events = [ev('a'), ev('a', 'repeat'), ev('a', 'release'), k('paste', { text: 'x' })];
    expect(s.feed(events, 0)).toEqual(events);
  });
});

describe('KeyState: repeat mode', () => {
  it('starts with the documented windows', () => {
    const s = new KeyState('repeat');
    expect(s.initialWindow).toBe(INITIAL_WINDOW_DEFAULT);
    expect(s.repeatWindow).toBe(REPEAT_WINDOW_DEFAULT);
    expect(INITIAL_WINDOW_DEFAULT).toBe(300);
    expect(REPEAT_WINDOW_DEFAULT).toBe(140);
  });

  it('holds a tap for the initial window, then lets go', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 1000);
    expect(s.held('left', 1000)).toBe(true);
    expect(s.held('left', 1299)).toBe(true);
    expect(s.held('left', 1300)).toBe(false);
    expect(s.held('right', 1100)).toBe(false);
  });

  it('does not learn from a lone tap', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    expect(s.initialWindow).toBe(INITIAL_WINDOW_DEFAULT);
    expect(s.repeatWindow).toBe(REPEAT_WINDOW_DEFAULT);
  });

  it('learns the delay and interval from a hold, then holds without a gap', () => {
    const s = new KeyState('repeat');
    // First hold: 400 ms initial delay, then a repeat every 30 ms. The window (300 ms) is too
    // short for it, so there is a gap before the first repeat; that is what teaches the delay.
    s.feed([ev('a')], 0);
    expect(s.held('left', 350)).toBe(false);
    s.feed([ev('a')], 400);
    s.feed([ev('a')], 430);
    expect(s.initialWindow).toBe(450); // 400 + 50
    expect(s.repeatWindow).toBe(75); // 2.5 * 30
    for (let t = 460; t <= 700; t += 30) s.feed([ev('a')], t);

    // Second hold, a few seconds later: no gap at all.
    const T = 5000;
    s.feed([ev('a')], T);
    s.feed([ev('a')], T + 400);
    for (let t = T + 430; t <= T + 800; t += 30) s.feed([ev('a')], t);
    for (let t = T; t <= T + 800; t += 5) {
      // Only check times when the terminal has delivered everything up to t.
      expect(s.held('left', t), `held at +${t - T}`).toBe(true);
    }
    // And it lets go once the repeats stop, within the repeat window.
    expect(s.held('left', T + 790 + 74)).toBe(true);
    expect(s.held('left', T + 790 + 75)).toBe(false);
  });

  it('is not fooled by a double tap', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.feed([ev('a')], 150);
    s.feed([ev('d')], 2000);
    s.feed([ev('d')], 2150);
    expect(s.initialWindow).toBe(INITIAL_WINDOW_DEFAULT);
    expect(s.repeatWindow).toBe(REPEAT_WINDOW_DEFAULT);
  });

  it('is not fooled by two slow taps and a third quickly after', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.feed([ev('a')], 600);
    s.feed([ev('a')], 1700);
    expect(s.initialWindow).toBe(INITIAL_WINDOW_DEFAULT);
  });

  it('learns a delay shorter than the default window straight away', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.feed([ev('a')], 250);
    s.feed([ev('a')], 290);
    expect(s.initialWindow).toBe(300); // 250 + 50
    expect(s.repeatWindow).toBe(100); // 2.5 * 40
  });

  it('keeps the smallest of the recent delays and averages the intervals', () => {
    const s = new KeyState('repeat');
    let t = 0;
    const hold = (delay: number, interval: number) => {
      s.feed([ev('a')], t);
      s.feed([ev('a')], t + delay);
      s.feed([ev('a')], t + delay + interval);
      t += 5000;
    };
    hold(500, 40);
    expect(s.initialWindow).toBe(550);
    hold(480, 40);
    expect(s.initialWindow).toBe(530);
    hold(600, 60);
    expect(s.initialWindow).toBe(530);
    // 40, 40, 60 -> mean 46.67
    expect(s.repeatWindow).toBeCloseTo(2.5 * (140 / 3), 5);
  });

  it('clamps the learned windows', () => {
    // The pure functions, over their whole range.
    expect(initialWindowFor(10)).toBe(120);
    expect(initialWindowFor(100)).toBe(150);
    expect(initialWindowFor(400)).toBe(450);
    expect(initialWindowFor(1000)).toBe(650);
    expect(repeatWindowFor(5)).toBe(60);
    expect(repeatWindowFor(30)).toBe(75);
    expect(repeatWindowFor(100)).toBe(200);
    expect(repeatWindowFor(500)).toBe(200);

    // And as learned: a very slow start, a very fast repeat.
    const slow = new KeyState('repeat');
    slow.feed([ev('a')], 0);
    slow.feed([ev('a')], 1000);
    slow.feed([ev('a')], 1030);
    expect(slow.initialWindow).toBe(650);

    const fast = new KeyState('repeat');
    fast.feed([ev('a')], 0);
    fast.feed([ev('a')], 200);
    fast.feed([ev('a')], 210);
    expect(fast.repeatWindow).toBe(60);

    const sluggish = new KeyState('repeat');
    sluggish.feed([ev('a')], 0);
    sluggish.feed([ev('a')], 400);
    sluggish.feed([ev('a')], 500);
    expect(sluggish.repeatWindow).toBe(200);
  });

  it('lets the opposite direction cancel at once', () => {
    const s = new KeyState('repeat');
    s.feed([ev('d')], 0);
    expect(s.held('right', 10)).toBe(true);
    s.feed([ev('a')], 50);
    expect(s.held('right', 50)).toBe(false);
    expect(s.held('left', 50)).toBe(true);
    // Arrows too, and across different keys for the same direction.
    s.feed([ev('right')], 100);
    expect(s.held('left', 100)).toBe(false);
    expect(s.held('right', 100)).toBe(true);
  });

  it('does not cancel unrelated actions', () => {
    const s = new KeyState('repeat');
    s.feed([ev('d')], 0);
    s.feed([ev('z')], 10);
    expect(s.held('right', 10) && s.held('fire', 10)).toBe(true);
    s.feed([ev('s')], 20);
    s.feed([ev('w')], 30);
    expect(s.held('right', 30)).toBe(true);
  });

  it('reports a fresh press once, and not a held key repeating', () => {
    const s = new KeyState('repeat');
    s.feed([ev('space')], 0);
    expect(s.pressed('fire')).toBe(true);
    expect(s.pressed('confirm')).toBe(true);
    s.endFrame();
    expect(s.pressed('fire')).toBe(false);
    s.feed([ev('space')], 400); // after the OS delay: a repeat, not a press...
    s.feed([ev('space')], 430);
    s.feed([ev('space')], 460);
    s.endFrame();
    // (The first hold teaches the delay; after that, repeats are recognised on arrival.)
    s.feed([ev('space')], 5000);
    s.endFrame();
    s.feed([ev('space')], 5400);
    expect(s.pressed('fire')).toBe(false);
    expect(s.pressed('confirm')).toBe(false);
    s.feed([ev('space')], 5430);
    expect(s.pressed('fire')).toBe(false);
  });

  it('counts direction repeats as presses, for menu scrolling', () => {
    const s = new KeyState('repeat');
    s.feed([ev('down')], 0);
    s.endFrame();
    s.feed([ev('down')], 100);
    expect(s.pressed('down')).toBe(true);
    expect(s.pressed('fire')).toBe(false);
    s.endFrame();
    s.feed([ev('down')], 180);
    expect(s.pressed('down')).toBe(true);
    expect(s.pressed('fire')).toBe(false); // down arrow is not fire
    s.endFrame();
    expect(s.pressed('down')).toBe(false);
  });

  it('reports a new press after the key has been let go', () => {
    const s = new KeyState('repeat');
    s.feed([ev('f')], 0);
    expect(s.pressed('autofire')).toBe(true);
    s.endFrame();
    s.feed([ev('f')], 2000);
    expect(s.pressed('autofire')).toBe(true);
    s.endFrame();
    s.feed([ev('f')], 3000);
    expect(s.pressed('autofire')).toBe(true);
  });

  it('does not report a press for a repeat chain that is stopped and resumed late', () => {
    const s = new KeyState('repeat');
    s.feed([ev('f')], 0);
    s.feed([ev('f')], 400);
    s.feed([ev('f')], 430);
    s.feed([ev('f')], 460);
    s.endFrame();
    // A repeat arriving a little late (within the slack) is still a repeat.
    s.feed([ev('f')], 460 + s.repeatWindow + CHAIN_SLACK);
    expect(s.pressed('autofire')).toBe(false);
    s.endFrame();
    // But a much later one is a press.
    s.feed([ev('f')], 460 + 2000);
    expect(s.pressed('autofire')).toBe(true);
  });

  it('releaseAll stops held keys counting, and a press after a pause works normally', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a'), ev('x')], 0);
    s.endFrame();
    s.releaseAll();
    expect(s.held('left', 10)).toBe(false);
    expect(s.held('special', 10)).toBe(false);
    s.feed([ev('x')], 2000);
    expect(s.pressed('special')).toBe(true);
    expect(s.held('special', 2000)).toBe(true);
  });

  it('endFrame clears pressed but not held', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    expect(s.pressed('left')).toBe(true);
    s.endFrame();
    expect(s.pressed('left')).toBe(false);
    expect(s.held('left', 100)).toBe(true);
  });

  it('tracks several keys independently', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.feed([ev('z')], 100);
    expect(s.held('left', 350)).toBe(false);
    expect(s.held('fire', 350)).toBe(true);
    expect(s.held('fire', 400)).toBe(false);
  });

  it('honours release events if it is given any', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.feed([ev('a', 'release')], 10);
    expect(s.held('left', 20)).toBe(false);
  });

  it('forgets everything held when the mode changes', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    s.mode = 'release';
    expect(s.mode).toBe('release');
    expect(s.held('left', 1)).toBe(false);
    s.feed([ev('a')], 2);
    expect(s.held('left', 1_000_000)).toBe(true);
    s.mode = 'repeat';
    expect(s.held('left', 3)).toBe(false);
  });
});

describe('KeyState.feed return value', () => {
  it('marks a press that is really an auto-repeat as a repeat, without touching the input', () => {
    const s = new KeyState('repeat');
    const second = ev('space');
    expect(s.feed([ev('space')], 0)).toEqual([ev('space')]);
    // 400 ms later: a hold's first repeat or a second tap? Held back until the next event says.
    expect(s.feed([second], 400)).toEqual([]);
    const out = s.feed([ev('space')], 430);
    expect(out).toEqual([ev('space', 'repeat'), ev('space', 'repeat')]);
    expect(out[0]).not.toBe(second);
    expect(second.kind).toBe('press');
  });

  it('marks every event of a hold after the first', () => {
    const s = new KeyState('repeat');
    const kinds: KeyEventKind[] = [];
    for (const t of [0, 400, 430, 460, 490]) kinds.push(...s.feed([ev('left')], t).map((e) => e.kind));
    expect(kinds).toEqual(['press', 'repeat', 'repeat', 'repeat', 'repeat']);
  });

  it('keeps a fresh press, a release, a paste and a reply as they are', () => {
    const s = new KeyState('repeat');
    const events = [ev('a'), ev('d'), ev('a', 'release'), k('paste', { text: 'x' }), k('reply', { text: 'da' })];
    expect(s.feed(events, 0)).toEqual(events);
    // A tap well after the last one is a new press.
    expect(s.feed([ev('d')], 3000)).toEqual([ev('d')]);
  });

  it('can return held-back events late, ahead of the event that settled them', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a'), ev('s')], 0);
    // a and s come back after a pause: held back; q (never seen before) is a press at once.
    expect(s.feed([ev('s'), ev('a'), ev('q')], 400).map((e) => [e.key, e.kind])).toEqual([['q', 'press']]);
    expect(s.feed([ev('s'), ev('a')], 430).map((e) => [e.key, e.kind])).toEqual([
      ['s', 'repeat'],
      ['s', 'repeat'],
      ['a', 'repeat'],
      ['a', 'repeat'],
    ]);
    expect(s.feed([], 440)).toEqual([]);
  });

  it('leaves the kinds alone in release mode', () => {
    const s = new KeyState('release');
    const events = [ev('a'), ev('a'), ev('a', 'repeat'), ev('a', 'release')];
    expect(s.feed(events, 0).map((e) => e.kind)).toEqual(['press', 'press', 'repeat', 'release']);
  });
});

describe('KeyState: unbound keys in repeat mode', () => {
  it('recognises the auto-repeats of keys the game has no use for', () => {
    const s = new KeyState('repeat');
    const kinds = (events: KeyEvent[], t: number) => s.feed(events, t).map((e) => e.kind);
    expect(kinds([ev('r')], 0)).toEqual(['press']);
    expect(kinds([ev('r')], 400)).toEqual([]);
    expect(kinds([ev('r')], 430)).toEqual(['repeat', 'repeat']);
    expect(kinds([ev('r')], 460)).toEqual(['repeat']);
    expect(kinds([ev('7')], 470)).toEqual(['press']);
    expect(kinds([ev('r')], 3000)).toEqual(['press']);
    for (const a of ['left', 'right', 'fire', 'up', 'confirm'] as Action[]) expect(s.held(a, 3000)).toBe(false);
  });

  it('does not track pastes, replies, focus reports or Ctrl chords as repeating keys', () => {
    const s = new KeyState('repeat');
    for (const e of [k('paste', { text: 'x' }), k('reply', { text: 'da' }), k('focusIn'), k('c', { ctrl: true })]) {
      expect(s.feed([e], 0)[0].kind).toBe('press');
      expect(s.feed([e], 50)[0].kind).toBe('press');
    }
  });
});

describe('KeyState.releaseAll: keys still down stay ignored', () => {
  it('repeat mode: the auto-repeats still read as repeats but neither hold nor press, until the chain lapses', () => {
    const s = new KeyState('repeat');
    s.feed([ev('space'), ev('left')], 0);
    s.endFrame();
    s.releaseAll();
    expect(s.held('fire', 10) || s.held('confirm', 10) || s.held('left', 10)).toBe(false);
    // The first repeat is held back; the key stays ignored meanwhile, and the next event settles it.
    expect(s.feed([ev('space'), ev('left')], 400)).toEqual([]);
    expect(s.held('fire', 410) || s.held('left', 410)).toBe(false);
    expect(s.poll(410)).toEqual([]);
    for (const t of [430, 460, 490]) {
      const kinds = s.feed([ev('space'), ev('left')], t).map((e) => e.kind);
      expect(kinds.every((kind) => kind === 'repeat')).toBe(true);
      expect(kinds.length).toBe(t === 430 ? 4 : 2);
      expect(s.pressed('fire') || s.pressed('confirm') || s.pressed('left')).toBe(false);
      expect(s.held('fire', t) || s.held('left', t)).toBe(false);
    }
    // Another key is unaffected.
    s.feed([ev('z')], 500);
    expect(s.pressed('fire')).toBe(true);
    expect(s.held('fire', 500)).toBe(true);
    s.endFrame();
    // The chain lapses (key let go); a genuinely new press works.
    expect(s.feed([ev('space')], 2500)[0].kind).toBe('press');
    expect(s.pressed('confirm')).toBe(true);
    expect(s.held('fire', 2500)).toBe(true);
  });

  it('release mode: stays ignored until released, then works again', () => {
    const s = new KeyState('release');
    s.feed([ev('space'), ev('right')], 0);
    s.endFrame();
    s.releaseAll();
    expect(s.held('fire', 1) || s.held('confirm', 1) || s.held('right', 1)).toBe(false);
    const out = s.feed([ev('space', 'repeat'), ev('right', 'repeat')], 50);
    expect(out.map((e) => e.kind)).toEqual(['repeat', 'repeat']);
    expect(s.held('fire', 50) || s.held('right', 50)).toBe(false);
    expect(s.pressed('fire') || s.pressed('right')).toBe(false);
    s.feed([ev('space', 'release'), ev('right', 'release')], 100);
    s.feed([ev('space')], 200);
    expect(s.held('fire', 200)).toBe(true);
    expect(s.pressed('confirm')).toBe(true);
  });

  it('release mode: a fresh press of a suppressed key works at once', () => {
    const s = new KeyState('release');
    s.feed([ev('space')], 0);
    s.releaseAll();
    s.feed([ev('space')], 10);
    expect(s.held('fire', 10)).toBe(true);
  });

  it('a key that was already let go before releaseAll is not suppressed (repeat mode)', () => {
    const s = new KeyState('repeat');
    s.feed([ev('x')], 0);
    s.held('special', 1000); // time has passed: the tap's window is long over
    s.releaseAll();
    s.feed([ev('x')], 1100);
    expect(s.pressed('special')).toBe(true);
  });
});

describe('KeyState: focus loss', () => {
  it('forgets everything held in repeat mode', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a'), ev('z')], 0);
    expect(s.feed([k('focusOut')], 10)).toEqual([k('focusOut')]);
    expect(s.held('left', 20) || s.held('fire', 20)).toBe(false);
    // Nothing is remembered about the keys, so the next press is fresh.
    expect(s.feed([ev('a')], 50)[0].kind).toBe('press');
  });

  it('forgets everything held in release mode, including suppressed keys', () => {
    const s = new KeyState('release');
    s.feed([ev('a'), ev('d')], 0);
    s.releaseAll();
    s.feed([k('focusOut')], 10);
    expect(s.held('left', 20) || s.held('right', 20)).toBe(false);
    s.feed([ev('a', 'repeat')], 30); // no track left: counts as down again
    expect(s.held('left', 30)).toBe(true);
    s.feed([k('focusOut')], 40);
    expect(s.held('left', 50)).toBe(false);
  });

  it('keeps focusIn from doing anything', () => {
    const s = new KeyState('release');
    s.feed([ev('a')], 0);
    s.feed([k('focusIn')], 5);
    expect(s.held('left', 6)).toBe(true);
  });
});

describe('KeyState: telling a second tap from a hold\'s first auto-repeat', () => {
  /** A state that has seen a 400 ms initial delay and 33 ms repeats (decideMs 82.5). */
  function trained() {
    const s = new KeyState('repeat');
    s.feed([ev('f')], 0);
    s.feed([ev('f')], 400);
    s.feed([ev('f')], 433);
    s.endFrame();
    return s;
  }

  it('has documented defaults', () => {
    const s = new KeyState('repeat');
    expect(DECIDE_MS).toBe(120);
    expect(s.decideMs).toBe(DECIDE_MS);
    expect(decideMsFor(10)).toBe(60);
    expect(decideMsFor(33)).toBeCloseTo(82.5);
    expect(decideMsFor(100)).toBe(150);
    expect(AMBIGUOUS_MAX).toBe(700);
    expect(trained().decideMs).toBeCloseTo(82.5);
  });

  it('treats a hold (press, a 400 ms pause, repeats every 33 ms) as nothing but repeats after the first press', () => {
    const s = new KeyState('repeat');
    const all: KeyEvent[] = [];
    all.push(...s.feed([ev('enter')], 0));
    for (let t = 400; t <= 1000; t += 33) {
      all.push(...s.feed([ev('enter')], t));
      all.push(...s.poll(t));
    }
    all.push(...s.poll(2000));
    expect(all[0].kind).toBe('press');
    expect(all.slice(1).every((e) => e.kind === 'repeat')).toBe(true);
    expect(all.length).toBe(1 + Math.floor(600 / 33) + 1);
    // Confirm was pressed once, by the first press only.
    expect(s.pressed('confirm')).toBe(true);
    s.endFrame();
    s.feed([ev('enter')], 1033);
    expect(s.pressed('confirm')).toBe(false);
  });

  it('holds a deliberate second tap back, and releases it from poll() as a press after DECIDE_MS', () => {
    const s = new KeyState('repeat');
    expect(s.feed([ev('enter')], 0)).toEqual([ev('enter')]);
    expect(s.pressed('confirm')).toBe(true);
    s.endFrame();
    expect(s.feed([ev('enter')], 380)).toEqual([]);
    expect(s.pressed('confirm')).toBe(false);
    expect(s.poll(380 + DECIDE_MS - 1)).toEqual([]);
    expect(s.pressed('confirm')).toBe(false);
    expect(s.poll(380 + DECIDE_MS)).toEqual([ev('enter')]);
    expect(s.pressed('confirm')).toBe(true);
    s.endFrame();
    expect(s.poll(380 + DECIDE_MS + 50)).toEqual([]); // only once
    expect(s.pressed('confirm')).toBe(false);
  });

  it('counts a held-back key as held meanwhile, so movement does not stutter', () => {
    const s = new KeyState('repeat');
    s.feed([ev('a')], 0);
    expect(s.held('left', 299)).toBe(true);
    s.feed([ev('a')], 400);
    for (let t = 400; t < 700; t += 10) expect(s.held('left', t), `held at ${t}`).toBe(true);
    s.poll(520);
    expect(s.held('left', 520)).toBe(true);
  });

  it('turns the held-back event into a repeat when the next one comes in time, and learns from both', () => {
    const s = new KeyState('repeat');
    s.feed([ev('d')], 0);
    expect(s.feed([ev('d')], 400)).toEqual([]);
    expect(s.feed([ev('d')], 433).map((e) => e.kind)).toEqual(['repeat', 'repeat']);
    expect(s.initialWindow).toBe(450);
    expect(s.repeatWindow).toBeCloseTo(82.5);
    expect(s.poll(1000)).toEqual([]);
  });

  it('does not wait on a quick double tap: it is a press at once', () => {
    const s = new KeyState('repeat');
    s.feed([ev('f')], 0);
    expect(s.feed([ev('f')], 150)).toEqual([ev('f')]);
    expect(s.pressed('autofire')).toBe(true);
  });

  it('after the delay is learned, a gap well short of it is a fresh tap at once, and near it is held back', () => {
    const s = trained();
    expect(s.initialWindow).toBe(450);
    s.feed([ev('f')], 5000);
    expect(s.feed([ev('f')], 5250)).toEqual([ev('f')]); // 250 < 400 - 60
    s.endFrame();
    s.feed([ev('f')], 8000);
    s.endFrame();
    expect(s.feed([ev('f')], 8345)).toEqual([]); // 345 >= 340
    expect(s.poll(8345 + 83)).toEqual([ev('f')]);
    expect(s.pressed('autofire')).toBe(true);
  });

  it('presses at once past AMBIGUOUS_MAX', () => {
    const s = new KeyState('repeat');
    s.feed([ev('f')], 0);
    expect(s.feed([ev('f')], AMBIGUOUS_MAX + 100)).toEqual([ev('f')]);
  });

  it('releases a due held-back event first thing in the next feed() as well', () => {
    const s = new KeyState('repeat');
    s.feed([ev('enter')], 0);
    s.feed([ev('enter')], 380);
    s.endFrame();
    // No poll in between: the next feed brings it out, ahead of the new event.
    expect(s.feed([ev('q')], 1000)).toEqual([ev('enter'), ev('q')]);
    expect(s.pressed('confirm')).toBe(true);
  });

  it('counts a direction repeat as pressed once it is known to be one, but not a fire repeat', () => {
    const s = new KeyState('repeat');
    s.feed([ev('left'), ev('space')], 0);
    s.endFrame();
    s.feed([ev('left'), ev('space')], 400);
    expect(s.pressed('left')).toBe(false);
    s.feed([ev('left'), ev('space')], 433);
    expect(s.pressed('left')).toBe(true);
    expect(s.pressed('fire')).toBe(false);
    expect(s.pressed('confirm')).toBe(false);
  });

  it('a fresh tap released by poll() un-suppresses a key suppressed by releaseAll()', () => {
    const s = new KeyState('repeat');
    s.feed([ev('enter')], 0); // confirms a card; the game clears input
    s.releaseAll();
    s.endFrame();
    expect(s.feed([ev('enter')], 380)).toEqual([]);
    expect(s.held('confirm', 390)).toBe(false); // still suppressed while undecided
    expect(s.poll(380 + DECIDE_MS)).toEqual([ev('enter')]);
    expect(s.pressed('confirm')).toBe(true);
    expect(s.held('confirm', 380 + DECIDE_MS)).toBe(true);
  });

  it('a held key suppressed by releaseAll() stays suppressed when its held-back event proves to be a repeat', () => {
    const s = new KeyState('repeat');
    s.feed([ev('enter')], 0);
    s.releaseAll();
    s.endFrame();
    s.feed([ev('enter')], 400);
    expect(s.feed([ev('enter')], 433).map((e) => e.kind)).toEqual(['repeat', 'repeat']);
    expect(s.pressed('confirm')).toBe(false);
    expect(s.held('confirm', 440)).toBe(false);
  });

  it('lets a release event, a Ctrl chord or the opposite direction settle a held-back event as a press', () => {
    const s = new KeyState('repeat');
    s.feed([ev('r')], 0);
    s.feed([ev('r')], 400);
    expect(s.feed([ev('r', 'release')], 410).map((e) => e.kind)).toEqual(['press', 'release']);

    s.feed([ev('d')], 2000);
    s.feed([ev('d')], 2400); // held back
    const out = s.feed([ev('a')], 2410);
    expect(out.map((e) => [e.key, e.kind])).toEqual([
      ['d', 'press'],
      ['a', 'press'],
    ]);
    expect(s.held('right', 2410)).toBe(false);
    expect(s.held('left', 2410)).toBe(true);
  });

  it('drops held-back events on focus loss and mode change', () => {
    const s = new KeyState('repeat');
    s.feed([ev('r')], 0);
    s.feed([ev('r')], 400);
    s.feed([k('focusOut')], 410);
    expect(s.poll(2000)).toEqual([]);

    s.feed([ev('r')], 3000);
    s.feed([ev('r')], 3400);
    s.mode = 'release';
    expect(s.poll(5000)).toEqual([]);
  });

  it('poll() is empty in release mode', () => {
    const s = new KeyState('release');
    s.feed([ev('a')], 0);
    expect(s.poll(1000)).toEqual([]);
  });
});
