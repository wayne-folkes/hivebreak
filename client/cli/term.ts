import type { ColorMode } from './frame';

// The terminal session: raw keyboard input, the alternate screen, a hidden cursor, bracketed
// paste, and putting all of it back however the game ends (quit, Ctrl+C, a crash, a kill signal).

export interface Terminal {
  readonly cols: number;
  readonly rows: number;
  write(s: string): void;
  /** Raw input as it arrives (stdin in raw mode, decoded as UTF-8). */
  onData(listener: (chunk: string) => void): void;
  onResize(listener: () => void): void;
  /** Called on SIGTERM, SIGHUP or an outside SIGINT before the terminal is restored and the process exits. */
  onSignal(listener: () => void): void;
  /** Restores the terminal (also runs on exit), writing the restore prefix first. Safe to call twice. */
  close(): void;
  /** Escape codes written just before the terminal is restored, e.g. to pop the kitty keyboard mode. */
  setRestorePrefix(s: string): void;
}

// Terminals that take 24-bit colour, by TERM_PROGRAM. Apple's Terminal is left out: it only gained
// truecolor in macOS 26, and older versions draw the wrong colours.
const TRUECOLOR_PROGRAMS = ['iTerm.app', 'ghostty', 'WezTerm', 'vscode', 'Hyper', 'Tabby', 'rio'];
// Substrings of TERM that mean truecolor (kitty, alacritty, ghostty, wezterm, and the xterm-direct variants).
const TRUECOLOR_TERMS = ['kitty', 'alacritty', 'ghostty', 'direct', 'wezterm'];

/** Opens the session on stdin/stdout. Throws if stdin is not a TTY. */
export function openTerminal(): Terminal {
  if (!process.stdin.isTTY) throw new Error('Hivebreak needs to run in a terminal.');
  // Raw mode hands over each key as it's pressed, instead of waiting for a line and echoing it.
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdin.resume();
  // Alternate screen keeps the shell's scrollback intact; bracketed paste lets a pasted run of text
  // be told apart from typed keys.
  process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J');

  let restorePrefix = '';
  let closed = false;
  const close = (): void => {
    // Reached from several places (normal exit, a signal, a crash); only the first one restores.
    if (closed) return;
    closed = true;
    process.stdout.write(`${restorePrefix}\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l`);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
  };

  process.on('exit', close);
  // A kill signal would otherwise end the process at once, leaving the shell in raw mode on the
  // alternate screen. With a signal listener (the game, to save the run first) it decides; it is
  // expected to close the terminal and exit.
  let signalListener: (() => void) | null = null;
  const onSignal = (code: number) => () => {
    if (signalListener) signalListener();
    close();
    process.exit(code);
  };
  process.on('SIGTERM', onSignal(143));
  process.on('SIGHUP', onSignal(129));
  // Ctrl+C in raw mode arrives as a key; this is a SIGINT sent from outside (kill -INT).
  process.on('SIGINT', onSignal(130));
  process.on('uncaughtException', (err) => {
    // Restore first, so the stack prints on the normal screen where it can be read.
    close();
    process.stderr.write(`${err.stack ?? String(err)}\n`);
    process.exit(1);
  });

  return {
    get cols() {
      return process.stdout.columns || 80;
    },
    get rows() {
      return process.stdout.rows || 24;
    },
    write: (s) => {
      process.stdout.write(s);
    },
    onSignal: (listener) => {
      signalListener = listener;
    },
    onData: (listener) => {
      process.stdin.on('data', (chunk: string) => listener(chunk));
    },
    onResize: (listener) => {
      process.stdout.on('resize', listener);
    },
    close,
    setRestorePrefix: (s) => {
      restorePrefix = s;
    },
  };
}

/** 24-bit colour when the terminal says it has it (COLORTERM, or a known TERM_PROGRAM), else 256 colours. */
export function colorModeFrom(env: Record<string, string | undefined>): ColorMode {
  // HIVEBREAK_COLOR wins over detection, for terminals that are misdetected or that lie about their colours.
  const override = env.HIVEBREAK_COLOR;
  if (override === '256' || override === 'truecolor') return override;
  if (env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit') return 'truecolor';
  if (TRUECOLOR_PROGRAMS.includes(env.TERM_PROGRAM ?? '')) return 'truecolor';
  const term = env.TERM ?? '';
  if (TRUECOLOR_TERMS.some((name) => term.includes(name))) return 'truecolor';
  return '256';
}

/** The OSC 52 sequence that asks the terminal to put `text` on the clipboard. */
export function clipboardSequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`;
}
