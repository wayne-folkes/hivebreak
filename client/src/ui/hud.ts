import { WAVE_COUNT } from '../game/waves';
import type { Fit } from '../game/playfield';
import type { RunState, UpgradeId } from '../game/types';
import { byId } from './card';
import { comboLabel, formatScore, hudLayout, summarizeUpgrades, waveLabel } from './format';

// The in-run display: score, combo, wave, lives and the mute button. On a phone these overlay the
// top of the field (score and combo left, wave and lives right, clear of the touch pause button
// in the screen's corner). With room either side of the field they move out into side panels:
// score, combo and high score on the left; wave, lives and the upgrades taken on the right.
//
// main.ts: `new Hud(onMute)`; `layout(fit)` with the playfield's fit on start and on every resize;
// `setBest(score)` with the saved best, `setMuted(muted)` whenever sound changes (this is the
// game's only mute button); `setVisible(true)` while a run is on screen, false behind the title;
// `update(run)` once per frame, which is cheap because it only touches the DOM when a value changes.

const MAX_LIFE_ICONS = 5;

export class Hud {
  private readonly root = byId('hud');
  private readonly field = byId('hud-field');
  private readonly score = byId('hud-score');
  private readonly comboStat = byId('hud-combo-stat');
  private readonly combo = byId('hud-combo');
  private readonly high = byId('hud-high');
  private readonly wave = byId('hud-wave');
  private readonly lives = byId('hud-lives');
  private readonly upgrades = byId('hud-upgrades');
  private readonly mute = byId<HTMLButtonElement>('hud-mute');

  // The last values drawn, so update() can skip untouched parts of the DOM.
  private shownScore = -1;
  private shownCombo = -1;
  private shownHigh = -1;
  private shownWave = -1;
  private shownLives = -1;
  private shownUpgrades = -1;
  private best = 0;

  constructor(onMute: () => void) {
    this.mute.addEventListener('click', () => {
      onMute();
      // Space fires, so a button left with focus would also toggle sound on every shot.
      this.mute.blur();
    });
    // Pressing it shouldn't take keyboard focus in the first place.
    this.mute.addEventListener('mousedown', (e) => e.preventDefault());
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** The best saved score, shown as "High" in the side panel. A run beating it moves it up live. */
  setBest(score: number): void {
    this.best = Math.max(0, score);
    this.shownHigh = -1;
  }

  setMuted(muted: boolean): void {
    this.mute.textContent = muted ? '🔇' : '🔊';
    this.mute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.mute.setAttribute('aria-pressed', String(muted));
  }

  layout(fit: Fit): void {
    const mode = hudLayout(fit, document.documentElement.clientWidth);
    this.root.dataset.mode = mode.side ? 'side' : 'overlay';
    const style = this.field.style;
    style.left = `${fit.left}px`;
    style.top = `${fit.top}px`;
    style.width = `${fit.width}px`;
    style.height = `${fit.height}px`;
    style.setProperty('--hud-side', `${mode.sideWidth}px`);
    style.setProperty('--hud-inset', `${mode.rightInset}px`);
  }

  update(run: RunState): void {
    const player = run.players[0];

    if (run.score !== this.shownScore) {
      this.shownScore = run.score;
      this.score.textContent = formatScore(run.score);
    }

    const high = Math.max(this.best, run.score);
    if (high !== this.shownHigh) {
      this.shownHigh = high;
      this.high.textContent = formatScore(high);
    }

    if (run.combo !== this.shownCombo) {
      const rose = run.combo > this.shownCombo && this.shownCombo >= 1;
      this.shownCombo = run.combo;
      this.combo.textContent = comboLabel(run.combo);
      this.comboStat.classList.toggle('is-off', run.combo <= 1);
      if (rose) this.pulse();
    }

    // Counting from 1 for the player, and never past the last wave when the run has just been won.
    const wave = Math.min(run.wave + 1, WAVE_COUNT);
    if (wave !== this.shownWave) {
      this.shownWave = wave;
      this.wave.textContent = waveLabel(wave, WAVE_COUNT);
    }

    const lives = player?.lives ?? 0;
    if (lives !== this.shownLives) {
      this.shownLives = lives;
      this.drawLives(lives);
    }

    // Upgrades only pile up within a run, so a changed count means a changed list (a new run starts at 0).
    const taken = player?.upgrades.length ?? 0;
    if (taken !== this.shownUpgrades) {
      this.shownUpgrades = taken;
      this.drawUpgrades(player?.upgrades ?? []);
    }
  }

  /** Restarts the combo's pop animation. */
  private pulse(): void {
    this.comboStat.classList.remove('pulse');
    void this.comboStat.offsetWidth;
    this.comboStat.classList.add('pulse');
  }

  private drawLives(lives: number): void {
    this.lives.setAttribute('aria-label', `${lives} ${lives === 1 ? 'life' : 'lives'}`);
    const icon = () => {
      const el = document.createElement('span');
      el.className = 'life';
      return el;
    };
    if (lives <= MAX_LIFE_ICONS) {
      this.lives.replaceChildren(...Array.from({ length: Math.max(0, lives) }, icon));
      return;
    }
    // Too many to draw in a row: one icon and a count.
    const count = document.createElement('span');
    count.textContent = `x${lives}`;
    this.lives.replaceChildren(icon(), count);
  }

  private drawUpgrades(upgrades: readonly UpgradeId[]): void {
    const rows = summarizeUpgrades(upgrades).map(({ name, count }) => {
      const li = document.createElement('li');
      li.textContent = count > 1 ? `${name} x${count}` : name;
      return li;
    });
    this.upgrades.replaceChildren(...rows);
  }
}
