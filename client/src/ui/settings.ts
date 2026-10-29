import { byId, MenuCard } from './card';

// Sound on or off, the volume, and erasing the saved records (asking first, inside the card).
// The card keeps no sound state of its own: it reads and writes through these callbacks.
//
// main.ts: `new SettingsCard({ getSound, setSound, getVolume, setVolume, resetRecords }, onBack)`;
// `show()` from the title and from the pause menu (it reads the current values each time, so a
// mute from the HUD shows up); `handle(controls)` each frame while on top; Esc or pause calls
// `dismiss()` first, which closes an open Erase confirmation.

export interface SettingsOptions {
  getSound(): boolean;
  setSound(on: boolean): void;
  /** Volume from 0 (silent) to 1 (full). The slider shows it as 0 to 100. */
  getVolume(): number;
  setVolume(volume: number): void;
  /** Erases the saved records. */
  resetRecords(): void;
}

export class SettingsCard extends MenuCard {
  private readonly main = byId('settings-main');
  private readonly confirmBox = byId('settings-confirm');
  private readonly soundButton = byId<HTMLButtonElement>('settings-sound');
  private readonly volume = byId<HTMLInputElement>('settings-volume');
  private readonly volumeValue = byId('settings-volume-value');
  private readonly resetButton = byId<HTMLButtonElement>('settings-reset');
  private readonly cancelButton = byId<HTMLButtonElement>('settings-reset-no');
  private readonly note = byId('settings-note');

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
    this.resetButton.addEventListener('click', () => this.askReset(true));
    this.cancelButton.addEventListener('click', () => this.askReset(false));
    byId('settings-reset-yes').addEventListener('click', () => {
      this.options.resetRecords();
      this.askReset(false);
      this.note.textContent = 'Records erased.';
      this.note.hidden = false;
    });
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
    if (this.confirmBox.hidden) return false;
    this.askReset(false);
    return true;
  }

  protected override refresh(): void {
    this.syncSound();
    this.volume.value = String(Math.round(this.options.getVolume() * 100));
    this.syncVolume();
    this.note.hidden = true;
    this.main.hidden = false;
    this.confirmBox.hidden = true;
  }

  /** The control shown when the card opens: the confirmation's safe answer while it is up, otherwise the first control. */
  protected override primary(): HTMLElement | null {
    return this.confirmBox.hidden ? super.primary() : this.cancelButton;
  }

  private syncSound(): void {
    const on = this.options.getSound();
    this.soundButton.textContent = `Sound: ${on ? 'On' : 'Off'}`;
    this.soundButton.setAttribute('aria-pressed', String(on));
  }

  private syncVolume(): void {
    this.volumeValue.textContent = `${this.volume.value}%`;
  }

  private askReset(on: boolean): void {
    this.main.hidden = on;
    this.confirmBox.hidden = !on;
    this.note.hidden = true;
    // The question lands on its safe answer; closing it returns to the control that opened it.
    this.focusItem(on ? this.cancelButton : this.resetButton);
  }
}
