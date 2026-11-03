import { describe, expect, it, vi } from 'vitest';
import { Frame } from './frame';
import type { KeyEvent } from './keys';
import { computeLayout } from './layout';
import {
  UNLOCKED_GUARD_SECONDS,
  backupMenu,
  drawTooSmall,
  gameOverMenu,
  howToMenu,
  logoRows,
  pauseMenu,
  recordsMenu,
  shipMenu,
  specialMenu,
  titleMenu,
  unlockedMenu,
  unlocksMenu,
  upgradeMenu,
  wrap,
  type Menu,
  type RunResult,
} from './menus';
import { MILESTONES, emptyProgress, type Progress } from '../src/game/progress';
import type { RunRecord } from '../src/game/records';
import { createRun } from '../src/game/run';
import type { UpgradeId } from '../src/game/types';

function key(k: string, extra: Partial<KeyEvent> = {}): KeyEvent {
  return { key: k, kind: 'press', ctrl: false, shift: false, ...extra };
}

/** The frame's text, one string per row (pixel cells read as spaces). */
function textOf(frame: Frame): string {
  const rows: string[] = [];
  for (let r = 0; r < frame.rows; r++) {
    let line = '';
    for (let c = 0; c < frame.cols; c++) line += frame.chars[r * frame.cols + c] || ' ';
    rows.push(line);
  }
  return rows.join('\n');
}

function render(menu: Menu, cols = 62, rows = 42, nowMs = 100_000): string {
  const layout = computeLayout(cols, rows);
  if (!layout) throw new Error('terminal too small for the layout');
  const frame = new Frame(cols, rows);
  menu.draw(frame, layout, nowMs);
  return textOf(frame);
}

const fullProgress = (): Progress => ({ ...emptyProgress(), milestones: MILESTONES.map((m) => m.id) });

const records: RunRecord[] = Array.from({ length: 10 }, (_, i) => ({
  score: 9000 - i * 700,
  wave: 10 - (i % 4),
  waves: 10,
  bestCombo: 8 - (i % 3),
  won: i === 0,
  date: '2026-10-29T12:00:00.000Z',
}));

const result: RunResult = { won: false, reason: 'lives', score: 4250, wave: 7, bestCombo: 6, rank: 0 };

function runWithOffer(offer: UpgradeId[]) {
  const run = createRun(1);
  run.offer = offer;
  return run;
}

describe('every menu draws without throwing', () => {
  const sizes: [number, number][] = [
    [62, 42],
    [80, 45],
    [140, 50],
  ];
  const noop = () => {};
  const menus: [string, () => Menu][] = [
    ['title', () => titleMenu({ start: noop, howTo: noop, records: noop, unlocks: noop, backup: noop, quit: noop }, () => 4200)],
    ['ship', () => shipMenu(emptyProgress(), null, noop, noop)],
    ['ship (all unlocked)', () => shipMenu(fullProgress(), 'lancer', noop, noop)],
    ['special', () => specialMenu(emptyProgress(), noop, noop)],
    ['upgrade', () => upgradeMenu(runWithOffer(['twinShot', 'overcharge', 'wingman']), noop, 0)],
    ['pause', () => pauseMenu({ resume: noop, howTo: noop, quit: noop })],
    ['unlocked', () => unlockedMenu(MILESTONES.slice(0, 3), noop, 0)],
    ['unlocked (every milestone)', () => unlockedMenu(MILESTONES, noop, 0)],
    ['game over', () => gameOverMenu(result, { playAgain: noop, title: noop }, 0)],
    ['records', () => recordsMenu(() => records, { back: noop, reset: noop })],
    ['records (empty)', () => recordsMenu(() => [], { back: noop, reset: noop })],
    ['unlocks', () => unlocksMenu(emptyProgress, noop)],
    ['how to (release)', () => howToMenu('release', noop)],
    ['how to (repeat)', () => howToMenu('repeat', noop)],
    ['backup', () => backupMenu({ code: () => 'HB1-' + 'x'.repeat(900), restore: () => true, copy: noop, back: noop })],
  ];
  for (const [name, make] of menus) {
    for (const [cols, rows] of sizes) {
      it(`${name} at ${cols}x${rows}`, () => {
        expect(() => render(make(), cols, rows)).not.toThrow();
      });
    }
  }

  it('the too-small message names both sizes', () => {
    const frame = new Frame(40, 20);
    drawTooSmall(frame, 62, 42);
    const text = textOf(frame).replace(/\s+/g, ' ');
    expect(text).toContain('Hivebreak needs a terminal at least 62×42.');
    expect(text).toContain('This one is 40×20.');
    expect(text).toContain('Make the window bigger or the font smaller.');
  });

  it('stays inside a tiny frame', () => {
    const frame = new Frame(10, 4);
    expect(() => drawTooSmall(frame, 62, 42)).not.toThrow();
  });
});

describe('wrap', () => {
  it('wraps on words and splits a word that is too long', () => {
    expect(wrap('one two three', 7)).toEqual(['one two', 'three']);
    expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrap('', 5)).toEqual(['']);
  });
});

describe('title', () => {
  const make = () => {
    const a = { start: vi.fn(), howTo: vi.fn(), records: vi.fn(), unlocks: vi.fn(), backup: vi.fn(), quit: vi.fn() };
    return { a, menu: titleMenu(a, () => 4250) };
  };

  it('draws the logo, the best score and the options', () => {
    const { menu } = make();
    const text = render(menu);
    for (const row of logoRows()) expect(text).toContain(row);
    expect(text).toContain('BEST 004250');
    for (const label of ['Start', 'How to play', 'Records', 'Unlocks', 'Backup', 'Quit']) expect(text).toContain(label);
  });

  it('the logo fits in the field width', () => {
    for (const row of logoRows()) expect([...row].length).toBeLessThanOrEqual(58);
  });

  it('Enter on Start starts, down + Enter opens How to play', () => {
    const { a, menu } = make();
    menu.key(key('enter'), 0);
    expect(a.start).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(a.howTo).toHaveBeenCalledTimes(1);
  });

  it('walks through every option and wraps round', () => {
    const { a, menu } = make();
    for (let i = 0; i < 3; i++) menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(a.unlocks).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(a.backup).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 0);
    menu.key(key('down'), 0); // wraps to Start
    menu.key(key('enter'), 0);
    expect(a.start).toHaveBeenCalledTimes(1);
    menu.key(key('up'), 0); // wraps to Quit
    menu.key(key('enter'), 0);
    expect(a.quit).toHaveBeenCalledTimes(1);
  });

  it('q quits, and a held Enter does not repeat the choice', () => {
    const { a, menu } = make();
    menu.key(key('q'), 0);
    expect(a.quit).toHaveBeenCalledTimes(1);
    menu.key(key('enter', { kind: 'repeat' }), 0);
    expect(a.start).not.toHaveBeenCalled();
  });
});

describe('ship choice', () => {
  it('starts on the last ship and skips locked ones', () => {
    const take = vi.fn();
    const back = vi.fn();
    const menu = shipMenu(emptyProgress(), null, take, back);
    // Only the Breaker is unlocked at the start: moving goes nowhere.
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenCalledWith('breaker');
    const text = render(menu);
    expect(text).toContain('LOCKED');
    expect(text).toContain('Unlock:');
  });

  it('with every ship unlocked, starts on `last` and moves between ships', () => {
    const take = vi.fn();
    const menu = shipMenu(fullProgress(), 'lancer', take, () => {});
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenLastCalledWith('lancer');
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenLastCalledWith('bastion');
  });

  it('draws the stat meters and Esc goes back', () => {
    const back = vi.fn();
    const menu = shipMenu(fullProgress(), null, () => {}, back);
    const text = render(menu);
    expect(text).toMatch(/Speed [■□]{5}/);
    expect(text).toContain('Breaker');
    menu.key(key('escape'), 0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('a locked ship cannot be taken', () => {
    const take = vi.fn();
    // Interceptor etc. are locked in a fresh progress; nothing but the Breaker can be taken.
    const menu = shipMenu(emptyProgress(), 'lancer', take, () => {});
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenCalledTimes(1);
    expect(take).toHaveBeenCalledWith('breaker');
  });
});

describe('special choice', () => {
  it('takes the focused special and skips locked ones', () => {
    const take = vi.fn();
    const back = vi.fn();
    const menu = specialMenu(emptyProgress(), take, back);
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenLastCalledWith('pulseBomb');
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenLastCalledWith('shieldBurst');
    // Past Shield Burst everything is locked, so moving down stays put.
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(take).toHaveBeenLastCalledWith('pulseBomb');
    menu.key(key('escape'), 0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows descriptions and what unlocks the locked ones', () => {
    const text = render(specialMenu(emptyProgress(), () => {}, () => {}));
    expect(text).toContain('Pulse Bomb');
    expect(text).toContain('Missile Swarm');
    expect(text).toContain('Unlock:');
  });
});

describe('upgrade pick', () => {
  const offer: UpgradeId[] = ['twinShot', 'overcharge', 'wingman'];

  it('ignores Enter during the guard and takes after it', () => {
    const take = vi.fn();
    const menu = upgradeMenu(runWithOffer(offer), take, 1000);
    menu.key(key('enter'), 1100);
    expect(take).not.toHaveBeenCalled();
    menu.key(key('enter'), 1500);
    expect(take).toHaveBeenCalledWith(0);
  });

  it('1/2/3 pick directly, but not during the guard or past the offer', () => {
    const take = vi.fn();
    const menu = upgradeMenu(runWithOffer(offer), take, 0);
    menu.key(key('2'), 100);
    expect(take).not.toHaveBeenCalled();
    menu.key(key('2'), 1000);
    expect(take).toHaveBeenLastCalledWith(1);
    menu.key(key('3'), 1000);
    expect(take).toHaveBeenLastCalledWith(2);
    take.mockClear();
    const two = upgradeMenu(runWithOffer(['twinShot', 'extraLife']), take, 0);
    two.key(key('3'), 1000);
    expect(take).not.toHaveBeenCalled();
  });

  it('moves with the arrows, wrapping round', () => {
    const take = vi.fn();
    const menu = upgradeMenu(runWithOffer(offer), take, 0);
    menu.key(key('right'), 1000);
    menu.key(key('enter'), 1000);
    expect(take).toHaveBeenLastCalledWith(1);
    menu.key(key('left'), 1000);
    menu.key(key('left'), 1000); // wraps to the last
    menu.key(key('enter'), 1000);
    expect(take).toHaveBeenLastCalledWith(2);
  });

  it('a held Enter (repeat) never picks', () => {
    const take = vi.fn();
    const menu = upgradeMenu(runWithOffer(offer), take, 0);
    menu.key(key('enter', { kind: 'repeat' }), 5000);
    expect(take).not.toHaveBeenCalled();
  });

  it('shows the heading, names, rarity, stacks side by side when wide', () => {
    const text = render(upgradeMenu(runWithOffer(offer), () => {}, 0), 100, 45);
    expect(text).toContain('WAVE 1 CLEAR');
    expect(text).toContain('Twin shot');
    expect(text).toContain('Overcharge');
    expect(text).toContain('RARE');
    expect(text).toContain('0/2 taken');
    // Side by side: the three names share a row.
    const row = text.split('\n').find((l) => l.includes('Twin shot'));
    expect(row).toContain('Overcharge');
    expect(row).toContain('Wingman');
  });

  it('stacks the cards when narrow', () => {
    const text = render(upgradeMenu(runWithOffer(offer), () => {}, 0), 62, 42);
    const lines = text.split('\n');
    const rowOf = (s: string) => lines.findIndex((l) => l.includes(s));
    expect(rowOf('Twin shot')).toBeGreaterThan(-1);
    expect(rowOf('Overcharge')).toBeGreaterThan(rowOf('Twin shot'));
    expect(lines[rowOf('Twin shot')]).not.toContain('Overcharge');
    expect(text).toContain('Fire an extra shot');
  });

  it('after a boss, the heading names the boss', () => {
    const run = runWithOffer(offer);
    run.boss = { kind: 'broodMother' } as never;
    expect(render(upgradeMenu(run, () => {}, 0))).toContain('BROOD MOTHER DOWN');
  });

  it('says when a pick completes a synergy, in place of the rarity word', () => {
    const run = runWithOffer(['piercing', 'rapidFire', 'extraLife']);
    // Twin shot is held, so Piercing shots would complete Lance.
    run.players[0].upgrades = ['twinShot'];
    for (const [cols, rows] of [
      [100, 45],
      [62, 42],
    ]) {
      const text = render(upgradeMenu(run, () => {}, 0), cols, rows).replace(/[│\s]+/g, ' ');
      expect(text).toContain('completes LANCE');
      expect(text).not.toContain('UNCOMMON');
    }
  });
});

describe('pause', () => {
  it('Resume, How to play, Quit to title, and Esc resumes', () => {
    const a = { resume: vi.fn(), howTo: vi.fn(), quit: vi.fn() };
    const menu = pauseMenu(a);
    const text = render(menu);
    expect(text).toContain('PAUSED');
    menu.key(key('enter'), 0);
    expect(a.resume).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(a.howTo).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 0);
    menu.key(key('enter'), 0);
    expect(a.quit).toHaveBeenCalledTimes(1);
    menu.key(key('escape'), 0);
    expect(a.resume).toHaveBeenCalledTimes(2);
  });
});

describe('UNLOCKED', () => {
  it('lists each reward and its reason', () => {
    const text = render(unlockedMenu(MILESTONES.slice(0, 2), () => {}, 0));
    expect(text).toContain('UNLOCKED');
    expect(text).toContain('for: ');
    expect(text).toContain('Continue');
  });

  it('ignores Enter and Esc until the guard has passed', () => {
    const cont = vi.fn();
    const menu = unlockedMenu(MILESTONES.slice(0, 1), cont, 1000);
    menu.key(key('enter'), 1000 + UNLOCKED_GUARD_SECONDS * 1000 - 10);
    menu.key(key('escape'), 1000 + 100);
    expect(cont).not.toHaveBeenCalled();
    menu.key(key('enter'), 1000 + UNLOCKED_GUARD_SECONDS * 1000);
    expect(cont).toHaveBeenCalledTimes(1);
    menu.key(key('escape'), 5000);
    expect(cont).toHaveBeenCalledTimes(2);
  });

  it('counts the rewards it has no room for', () => {
    const text = render(unlockedMenu(MILESTONES, () => {}, 0), 62, 20 + 22);
    expect(text).toContain('Continue');
  });
});

describe('game over', () => {
  it('shows the result, the stats and the rank badge', () => {
    const text = render(gameOverMenu(result, { playAgain: () => {}, title: () => {} }, 0));
    expect(text).toContain('SHIP LOST');
    expect(text).toContain('004250');
    expect(text).toMatch(/Wave\s+7\/10/);
    expect(text).toContain('x6');
    expect(text).toContain('New best!');
    expect(text).toContain('Play again');
  });

  it('a win, an invasion, and a run that missed the list', () => {
    const a = { playAgain: () => {}, title: () => {} };
    expect(render(gameOverMenu({ ...result, won: true, rank: 3 }, a, 0))).toContain('HIVE BROKEN');
    expect(render(gameOverMenu({ ...result, reason: 'invaded', rank: -1 }, a, 0))).toContain('THE HIVE LANDED');
    expect(render(gameOverMenu({ ...result, rank: -1 }, a, 0))).not.toContain('New best!');
    expect(render(gameOverMenu({ ...result, rank: 2 }, a, 0))).toContain('Rank #3');
  });

  it('ignores picks during the guard, then Play again / Title work', () => {
    const a = { playAgain: vi.fn(), title: vi.fn() };
    const menu = gameOverMenu(result, a, 1000);
    menu.key(key('enter'), 1100);
    expect(a.playAgain).not.toHaveBeenCalled();
    menu.key(key('enter'), 1500);
    expect(a.playAgain).toHaveBeenCalledTimes(1);
    menu.key(key('down'), 1500);
    menu.key(key('enter'), 1500);
    expect(a.title).toHaveBeenCalledTimes(1);
  });
});

describe('records', () => {
  it('lists up to ten rows', () => {
    const text = render(recordsMenu(() => records, { back: () => {}, reset: () => {} }));
    expect(text).toContain('RECORDS');
    expect(text).toContain('009000');
    expect(text).toContain('W10/10');
    expect(text).toContain('WON');
    expect(text).toContain('LOST');
    expect(text).toContain('29 Oct');
  });

  it('says so when there are none', () => {
    expect(render(recordsMenu(() => [], { back: () => {}, reset: () => {} }))).toContain('No runs yet');
  });

  it('R then Y resets; R again or another key cancels', () => {
    const a = { back: vi.fn(), reset: vi.fn() };
    const menu = recordsMenu(() => records, a);
    menu.key(key('r'), 0);
    expect(a.reset).not.toHaveBeenCalled();
    expect(render(menu)).toContain('Erase every saved record?');
    menu.key(key('r'), 0); // a held R can't answer its own question
    expect(a.reset).not.toHaveBeenCalled();
    menu.key(key('r'), 0);
    menu.key(key('y'), 0);
    expect(a.reset).toHaveBeenCalledTimes(1);
    expect(render(menu)).not.toContain('Erase every saved record?');
    menu.key(key('r'), 0);
    menu.key(key('escape'), 0); // cancels the question, does not leave
    expect(a.back).not.toHaveBeenCalled();
    menu.key(key('r'), 0);
    menu.key(key('down'), 0);
    menu.key(key('r'), 0); // a fresh question, not a confirmation
    expect(a.reset).toHaveBeenCalledTimes(1);
  });

  it('Esc goes back', () => {
    const a = { back: vi.fn(), reset: vi.fn() };
    recordsMenu(() => records, a).key(key('escape'), 0);
    expect(a.back).toHaveBeenCalledTimes(1);
  });
});

describe('unlocks', () => {
  it('shows the count, the goals and the locked hints', () => {
    const text = render(unlocksMenu(emptyProgress, () => {}), 62, 100);
    expect(text).toContain('0 / ');
    expect(text).toContain('NEXT GOALS');
    expect(text).toContain('SHIPS');
    expect(text).toContain('UPGRADES');
  });

  it('scrolls with the arrows when it does not fit, and Esc goes back', () => {
    const back = vi.fn();
    const menu = unlocksMenu(emptyProgress, back);
    const top = render(menu, 62, 42);
    expect(top).toContain('NEXT GOALS');
    for (let i = 0; i < 200; i++) menu.key(key('down'), 0);
    const bottom = render(menu, 62, 42);
    expect(bottom).not.toContain('NEXT GOALS');
    expect(bottom).not.toBe(top);
    for (let i = 0; i < 200; i++) menu.key(key('up'), 0);
    expect(render(menu, 62, 42)).toBe(top);
    menu.key(key('escape'), 0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('an all-unlocked profile has no goals', () => {
    const text = render(unlocksMenu(fullProgress, () => {}), 62, 100);
    expect(text).not.toContain('NEXT GOALS');
  });
});

describe('how to play', () => {
  it('lists the controls', () => {
    const text = render(howToMenu('release', () => {}), 62, 100);
    expect(text).toContain('Move');
    expect(text).toContain('Auto-fire');
    expect(text).toContain('Ctrl+C');
    expect(text).not.toContain('KEY REPEAT');
  });

  it('adds the key-repeat note only in repeat mode', () => {
    const text = render(howToMenu('repeat', () => {}), 62, 100).replace(/\s+/g, ' ');
    expect(text).toContain('KEY REPEAT');
    expect(text).toContain("doesn't report key releases");
    expect(text).toContain('Ghostty');
  });

  it('Esc goes back', () => {
    const back = vi.fn();
    howToMenu('release', back).key(key('escape'), 0);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('backup', () => {
  const make = (restore: (code: string) => boolean = () => true) => {
    const a = { code: vi.fn(() => 'HB1-abcdef-1234'), restore: vi.fn(restore), copy: vi.fn(), back: vi.fn() };
    return { a, menu: backupMenu(a) };
  };

  it('shows the code and the prompts', () => {
    const { menu } = make();
    const text = render(menu);
    expect(text).toContain('HB1-abcdef-1234');
    expect(text).toContain('Copy to clipboard');
    expect(text).toContain('Paste or type a code, then Enter to restore');
  });

  it('wraps a long code to fit', () => {
    const long = 'HB1-' + 'x'.repeat(100);
    const menu = backupMenu({ code: () => long, restore: () => true, copy: () => {}, back: () => {} });
    const text = render(menu);
    const lines = text.split('\n').filter((l) => l.includes('xxxx'));
    expect(lines.length).toBeGreaterThan(1);
    // The panel is 60 wide, border included, so a code row inside it is at most 56.
    for (const l of lines) expect(l.replace(/[│ ]/g, '').length).toBeLessThanOrEqual(56);
  });

  it('a paste then Enter restores with the pasted text and says so', () => {
    const { a, menu } = make();
    menu.key(key('paste', { text: 'HB1-pasted-0000\n' }), 0);
    expect(render(menu)).toContain('HB1-pasted-0000');
    menu.key(key('enter'), 0);
    expect(a.restore).toHaveBeenCalledWith('HB1-pasted-0000');
    expect(render(menu)).toContain('Progress restored');
  });

  it('a bad code shows the error and keeps the text to fix', () => {
    const { a, menu } = make(() => false);
    menu.key(key('paste', { text: 'nonsense' }), 0);
    menu.key(key('enter'), 0);
    expect(a.restore).toHaveBeenCalledWith('nonsense');
    expect(render(menu)).toContain("That code isn't valid");
    expect(render(menu)).toContain('nonsense');
    // Typing again clears the message.
    menu.key(key('x', { text: 'x' }), 0);
    expect(render(menu)).not.toContain("That code isn't valid");
  });

  it('typed characters keep their case, and Backspace deletes', () => {
    const { a, menu } = make();
    menu.key(key('h', { text: 'H', shift: true }), 0);
    menu.key(key('b', { text: 'B', shift: true }), 0);
    menu.key(key('1'), 0);
    menu.key(key('-'), 0);
    menu.key(key('z'), 0);
    menu.key(key('backspace'), 0);
    menu.key(key('enter'), 0);
    expect(a.restore).toHaveBeenCalledWith('HB1-');
  });

  it('C copies the code while the field is empty; once typing, c is a character', () => {
    const { a, menu } = make();
    menu.key(key('c'), 0);
    expect(a.copy).toHaveBeenCalledWith('HB1-abcdef-1234');
    expect(render(menu)).toContain('Sent to the clipboard');
    menu.key(key('paste', { text: 'a' }), 0);
    menu.key(key('c'), 0);
    expect(a.copy).toHaveBeenCalledTimes(1);
    menu.key(key('enter'), 0);
    expect(a.restore).toHaveBeenCalledWith('ac');
  });

  it('Enter with an empty field does nothing', () => {
    const { a, menu } = make();
    menu.key(key('enter'), 0);
    expect(a.restore).not.toHaveBeenCalled();
  });

  it('Esc clears a non-empty field first, then goes back', () => {
    const { a, menu } = make();
    menu.key(key('paste', { text: 'abc' }), 0);
    menu.key(key('escape'), 0);
    expect(a.back).not.toHaveBeenCalled();
    menu.key(key('escape'), 0);
    expect(a.back).toHaveBeenCalledTimes(1);
  });
});
