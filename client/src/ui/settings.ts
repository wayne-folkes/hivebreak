import { importCode } from '../game/progress';
import { byId, MenuCard } from './card';

// Sound on or off and its volume, music on or off and its volume, erasing the saved records, and
// backing up or restoring the unlock progress (each asks first, inside the card). The card keeps
// no sound, music or progress state of its own: it reads and writes through these callbacks.
//
// Back up progress shows the export code in a read-only field with a Copy button (the clipboard,
// or select-all to copy by hand). Restore progress shows a field to paste a code into; Restore
// checks the code with importCode, asks "Replace your progress?", then calls importProgress.
// While a text field has focus it keeps all its keys (see MenuCard); Esc leaves it, Up and Down
// move on, and Enter in the restore field presses Restore.
//
// main.ts: `new SettingsCard({ getSound, setSound, getVolume, setVolume, getMusic, setMusic,
// getMusicVolume, setMusicVolume, resetRecords, exportProgress: () => exportCode(progress),
// importProgress: code => { const p = importCode(code); if (!p) return false; progress = p;
// saveProgress(storage, p); return true; } }, onBack)`; `show()` from the title and from the
// pause menu (it reads the current values each time, so a mute from the HUD shows up);
// `handle(controls)` each frame while on top; Esc or pause calls `dismiss()` first, which closes an
// open Erase confirmation.

export interface SettingsOptions {
  getSound(): boolean;
  setSound(on: boolean): void;
  /** Volume from 0 (silent) to 1 (full). The slider shows it as 0 to 100. */
  getVolume(): number;
  setVolume(volume: number): void;
  getMusic(): boolean;
  setMusic(on: boolean): void;
  /** Music volume from 0 (silent) to 1 (full). The slider shows it as 0 to 100. */
  getMusicVolume(): number;
  setMusicVolume(volume: number): void;
  /** Erases the saved records. */
  resetRecords(): void;
  /** The progress as a backup code (exportCode of the current progress). */
  exportProgress?(): string;
  /**
   * Replaces the saved progress with the one in a backup code, and saves it. Returns false, and
   * changes nothing, if the code isn't valid (importCode gave null).
   *
   * Both progress callbacks are optional only so the card compiles before main.ts passes them:
   * without them the Back up and Restore buttons are hidden.
   */
  importProgress?(code: string): boolean;
}

/** Which in-card question is open. */
type Question = 'reset' | 'restore' | null;

export class SettingsCard extends MenuCard {
  private readonly main = byId('settings-main');
  private readonly confirmBox = byId('settings-confirm');
  private readonly soundButton = byId<HTMLButtonElement>('settings-sound');
  private readonly volume = byId<HTMLInputElement>('settings-volume');
  private readonly volumeValue = byId('settings-volume-value');
  private readonly musicButton = byId<HTMLButtonElement>('settings-music');
  private readonly musicVolume = byId<HTMLInputElement>('settings-music-volume');
  private readonly musicVolumeValue = byId('settings-music-volume-value');
  private readonly resetButton = byId<HTMLButtonElement>('settings-reset');
  private readonly cancelButton = byId<HTMLButtonElement>('settings-reset-no');
  private readonly note = byId('settings-note');
  private readonly backupButton = byId<HTMLButtonElement>('settings-backup');
  private readonly backupBox = byId('settings-backup-box');
  private readonly backupCode = byId<HTMLInputElement>('settings-backup-code');
  private readonly copyButton = byId<HTMLButtonElement>('settings-backup-copy');
  private readonly restoreButton = byId<HTMLButtonElement>('settings-restore');
  private readonly restoreBox = byId('settings-restore-box');
  private readonly restoreCode = byId<HTMLInputElement>('settings-restore-code');
  private readonly restoreGo = byId<HTMLButtonElement>('settings-restore-go');
  private readonly restoreError = byId('settings-restore-error');
  private readonly restoreConfirm = byId('settings-restore-confirm');
  private readonly restoreNo = byId<HTMLButtonElement>('settings-restore-no');
  private question: Question = null;
  private returnTo: HTMLElement = this.resetButton;

  constructor(
    private readonly options: SettingsOptions,
    onBack: () => void,
  ) {
    super('settings');
    this.soundButton.addEventListener('click', () => {
      this.options.setSound(!this.options.getSound());
      this.syncSound();
    });
    this.volume.addEventListener('input', () => {
      this.options.setVolume(Number(this.volume.value) / 100);
      this.syncVolume();
    });
    this.musicButton.addEventListener('click', () => {
      this.options.setMusic(!this.options.getMusic());
      this.syncMusic();
    });
    this.musicVolume.addEventListener('input', () => {
      this.options.setMusicVolume(Number(this.musicVolume.value) / 100);
      this.syncMusicVolume();
    });
    this.resetButton.addEventListener('click', () => this.ask('reset', this.resetButton));
    this.cancelButton.addEventListener('click', () => this.ask(null));
    byId('settings-reset-yes').addEventListener('click', () => {
      this.options.resetRecords();
      this.ask(null);
      this.say('Records erased.');
    });
    this.backupButton.addEventListener('click', () => this.toggleBackup());
    this.copyButton.addEventListener('click', () => void this.copyBackup());
    this.restoreButton.addEventListener('click', () => this.toggleRestore());
    this.restoreCode.addEventListener('input', () => {
      this.restoreError.hidden = true;
    });
    this.restoreGo.addEventListener('click', () => {
      // A bad code is turned away here, before asking whether to replace anything.
      if (importCode(this.restoreCode.value) === null) {
        this.restoreError.hidden = false;
        return;
      }
      this.restoreError.hidden = true;
      this.ask('restore', this.restoreGo);
    });
    this.restoreNo.addEventListener('click', () => this.ask(null));
    const hasBackup = this.options.exportProgress !== undefined && this.options.importProgress !== undefined;
    this.backupButton.hidden = this.restoreButton.hidden = !hasBackup;
    byId('settings-restore-yes').addEventListener('click', () => this.restore());
    byId('settings-back').addEventListener('click', onBack);
  }

  show(): void {
    this.reveal();
  }

  /** Redraws the sound button, after sound is changed from outside the card (the M key). */
  syncSoundLabel(): void {
    this.syncSound();
  }

  override dismiss(): boolean {
    if (this.question === null) return false;
    this.ask(null);
    return true;
  }

  protected override fieldEscaped(input: HTMLInputElement): void {
    this.focusItem(input === this.backupCode ? this.backupButton : this.restoreButton);
  }

  protected override fieldSubmitted(input: HTMLInputElement): void {
    if (input === this.restoreCode) this.restoreGo.click();
  }

  protected override refresh(): void {
    this.syncSound();
    this.volume.value = String(Math.round(this.options.getVolume() * 100));
    this.syncVolume();
    this.syncMusic();
    this.musicVolume.value = String(Math.round(this.options.getMusicVolume() * 100));
    this.syncMusicVolume();
    this.note.hidden = true;
    this.main.hidden = false;
    this.confirmBox.hidden = true;
    this.restoreConfirm.hidden = true;
    this.question = null;
    // A backup code isn't left lying in the card for the next visit.
    this.backupBox.hidden = true;
    this.backupCode.value = '';
    this.restoreBox.hidden = true;
    this.restoreCode.value = '';
    this.restoreError.hidden = true;
  }

  /** The control shown when the card opens: the open question's safe answer, otherwise the first control. */
  protected override primary(): HTMLElement | null {
    if (this.question === 'reset') return this.cancelButton;
    if (this.question === 'restore') return this.restoreNo;
    return super.primary();
  }

  private syncSound(): void {
    const on = this.options.getSound();
    this.soundButton.textContent = `Sound: ${on ? 'On' : 'Off'}`;
    this.soundButton.setAttribute('aria-pressed', String(on));
  }

  private syncVolume(): void {
    this.volumeValue.textContent = `${this.volume.value}%`;
  }

  private syncMusic(): void {
    const on = this.options.getMusic();
    this.musicButton.textContent = `Music: ${on ? 'On' : 'Off'}`;
    this.musicButton.setAttribute('aria-pressed', String(on));
  }

  private syncMusicVolume(): void {
    this.musicVolumeValue.textContent = `${this.musicVolume.value}%`;
  }

  private say(text: string): void {
    this.note.textContent = text;
    this.note.hidden = false;
  }

  /**
   * Opens an in-card question (or closes it with null). A question lands on its safe answer;
   * closing returns to the control that opened it (or the Restore button, if that has gone).
   */
  private ask(question: Question, opener?: HTMLElement): void {
    if (question !== null && opener) this.returnTo = opener;
    this.question = question;
    this.main.hidden = question !== null;
    this.confirmBox.hidden = question !== 'reset';
    this.restoreConfirm.hidden = question !== 'restore';
    this.note.hidden = true;
    if (question === 'reset') this.focusItem(this.cancelButton);
    else if (question === 'restore') this.focusItem(this.restoreNo);
    else this.focusItem(this.returnTo.closest('[hidden]') ? this.restoreButton : this.returnTo);
  }

  private toggleBackup(): void {
    const open = this.backupBox.hidden;
    this.backupBox.hidden = !open;
    this.note.hidden = true;
    if (!open) return;
    this.backupCode.value = this.options.exportProgress?.() ?? '';
    this.focusItem(this.copyButton);
  }

  private toggleRestore(): void {
    const open = this.restoreBox.hidden;
    this.restoreBox.hidden = !open;
    this.restoreError.hidden = true;
    this.note.hidden = true;
    if (open) this.focusItem(this.restoreCode);
  }

  /** Copies the code with the clipboard, or selects it so the player can copy it by hand. */
  private async copyBackup(): Promise<void> {
    const code = this.backupCode.value;
    try {
      await navigator.clipboard.writeText(code);
      this.say('Copied. Keep it somewhere safe.');
      return;
    } catch {
      // No clipboard access (an insecure page, or permission refused): select it instead.
    }
    this.backupCode.focus({ preventScroll: true });
    this.backupCode.select();
    this.backupCode.setSelectionRange(0, code.length);
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    this.say(copied ? 'Copied. Keep it somewhere safe.' : 'Code selected. Copy it by hand.');
  }

  private restore(): void {
    const ok = this.options.importProgress?.(this.restoreCode.value) ?? false;
    if (ok) {
      this.restoreBox.hidden = true;
      this.restoreCode.value = '';
    } else {
      this.restoreError.hidden = false;
    }
    this.ask(null);
    // ask() clears the note, so a success message is set after it.
    if (ok) this.say('Progress restored.');
  }
}
