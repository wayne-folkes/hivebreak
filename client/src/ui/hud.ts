import { bossHealth } from '../game/boss';
import { BUNKER_BOTTOM_Y, BUNKER_HEIGHT } from '../game/bunkers';
import type { SourceKind } from '../game/controls';
import { WAVE_COUNT } from '../game/waves';
import { FIELD_HEIGHT, type Fit } from '../game/playfield';
import type { PlayerState, PowerUpKind, RunState, SpecialId, SynergyId, UpgradeId } from '../game/types';
import { byId } from './card';
import {
  bossBarPercent,
  comboLabel,
  formatScore,
  hudLayout,
  meterCells,
  METER_CELLS,
  powerUpChips,
  SPECIAL_SHORT,
  specialHint,
  specialPrompt,
  summarizeUpgrades,
  synergyToast,
  waveLabel,
  waveSector,
  BOSS_NAMES,
  bossPhaseLabel,
} from './format';

// The in-run display: score, combo, wave (1/10 to 10/10, with a small sector tag on phones), lives,
// the Special meter, power-up timer chips, the boss bar (the Hive Mind's shows its phase), a toast
// line and the mute button. On a phone these overlay the top of the field (score, combo, the
// Special meter and the power-up chips down the left; wave and lives right, clear of the touch
// pause button in the screen's corner; the boss bar between them, so chips never sit over the
// boss). With room either side of the field they move out into side panels: score, combo, Special,
// power-ups and high score on the left; wave, sector, lives and the upgrades taken on the right.
//
// main.ts: `new Hud(onMute)`; `layout(fit)` with the playfield's fit on start and on every resize;
// `setBest(score)` with the saved best, `setMuted(muted)` whenever sound changes (this is the
// game's only mute button); `setVisible(true)` while a run is on screen, false behind the title;
// `update(run, controls.lastUsed)` once per frame, which is cheap because it only touches the DOM
// when a value changes (the second argument picks the Special's key hint: X, B / LT or "tap the
// button"). The Special meter, chips and boss bar all come from `run`. For the synergy banner, call
// `synergyUnlocked(id)` on a `synergyUnlocked` event; `toast(text, sub?)` shows any short line.

const MAX_LIFE_ICONS = 5;

/** How long a toast stays up, seconds. */
const TOAST_SECONDS = 2.6;

export class Hud {
  private readonly root = byId('hud');
  private readonly field = byId('hud-field');
  private readonly score = byId('hud-score');
  private readonly comboStat = byId('hud-combo-stat');
  private readonly combo = byId('hud-combo');
  private readonly high = byId('hud-high');
  private readonly wave = byId('hud-wave');
  private readonly sectorTag = byId('hud-sector-tag');
  private readonly sector = byId('hud-sector');
  private readonly lives = byId('hud-lives');
  private readonly upgrades = byId('hud-upgrades');
  private readonly mute = byId<HTMLButtonElement>('hud-mute');
  private readonly special = byId('hud-special');
  private readonly specialName = byId('hud-special-name');
  private readonly specialCells = byId('hud-special-cells');
  private readonly specialHint = byId('hud-special-hint');
  private readonly cells = [...this.specialCells.querySelectorAll<HTMLElement>('i')];
  private readonly powerUpStat = byId('hud-powerups-stat');
  private readonly powerUpList = byId('hud-powerups');
  private readonly boss = byId('hud-boss');
  private readonly bossName = byId('hud-boss-name');
  private readonly bossPhase = byId('hud-boss-phase');
  private readonly bossBar = byId('hud-boss-bar');
  private readonly bossFill = byId('hud-boss-fill');
  private readonly prompt = byId('hud-special-prompt');
  private readonly promptText = byId('hud-special-prompt-text');
  private readonly toastEl = byId('hud-toast');
  private readonly toastText = byId('hud-toast-text');
  private readonly toastSub = byId('hud-toast-sub');
  private toastTimer = 0;

  // The last values drawn, so update() can skip untouched parts of the DOM.
  private shownScore = -1;
  private shownCombo = -1;
  private shownHigh = -1;
  private shownWave = -1;
  private shownSector = -1;
  private shownBossPhase = -1;
  private shownBossKind = '';
  private shownLives = -1;
  private shownUpgrades = -1;
  private shownSpecialId: SpecialId | null = null;
  private shownSpecialDevice: SourceKind | null = null;
  private shownSpecialPercent = -1;
  private shownPromptId: SpecialId | null = null;
  private shownPromptDevice: SourceKind | null = null;
  private shownChipKinds: PowerUpKind[] = [];
  private shownChipSeconds: number[] = [];
  private shownBoss = -1;
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
    if (!visible) this.clearToast();
    // Coming back, the prompt pops in again if the meter is still full.
    if (!visible) {
      this.shownPromptId = null;
      this.prompt.hidden = true;
    }
  }

  /** A short line near the top of the field, with an optional smaller line under it. Replaces any toast showing. */
  toast(text: string, sub?: string, seconds = TOAST_SECONDS): void {
    window.clearTimeout(this.toastTimer);
    this.toastText.textContent = text;
    this.toastSub.textContent = sub ?? '';
    this.toastSub.hidden = !sub;
    // Taking the element out and putting it back restarts the animation, even for the same text.
    this.toastEl.hidden = true;
    void this.toastEl.offsetWidth;
    this.toastEl.style.setProperty('--toast-seconds', `${seconds}s`);
    this.toastEl.hidden = false;
    this.toastTimer = window.setTimeout(() => this.clearToast(), seconds * 1000);
  }

  clearToast(): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.hidden = true;
  }

  /** The banner for a `synergyUnlocked` event: "SYNERGY: LANCE" over what it does. */
  synergyUnlocked(id: SynergyId): void {
    const { text, sub } = synergyToast(id);
    this.toast(text, sub, TOAST_SECONDS + 0.6);
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
    // The ready prompt sits just above the bunkers (the top of the ship's cover), clear of the ship.
    const coverTop = (BUNKER_BOTTOM_Y + BUNKER_HEIGHT + FIELD_HEIGHT / 2) / FIELD_HEIGHT;
    style.setProperty('--hud-prompt-bottom', `${Math.round(coverTop * fit.height) + 6}px`);
  }

  update(run: RunState, device: SourceKind = 'keyboard'): void {
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

    const sector = waveSector(Math.min(run.wave, WAVE_COUNT - 1));
    if (sector !== this.shownSector) {
      this.shownSector = sector;
      this.sector.textContent = String(sector);
      this.sectorTag.textContent = `S${sector}`;
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

    this.drawSpecial(player, device);
    this.drawPrompt(run, player, device);
    this.drawPowerUps(player);
    this.drawBoss(run);
  }

  /** The Special meter: hidden until one is chosen; "READY" and a key hint once full. */
  private drawSpecial(player: PlayerState | undefined, device: SourceKind): void {
    const id = player?.special ?? null;
    if (!player || id === null) {
      if (this.shownSpecialId !== null) {
        this.shownSpecialId = null;
        this.special.hidden = true;
      }
      return;
    }
    // Compare plain numbers first: cells only change visibly in whole-percent steps, and 100 means ready.
    const charge = player.specialCharge;
    const percent = charge >= 1 ? 100 : Math.max(0, Math.min(99, Math.floor(charge * 100)));
    if (id === this.shownSpecialId && device === this.shownSpecialDevice && percent === this.shownSpecialPercent) return;
    this.shownSpecialId = id;
    this.shownSpecialDevice = device;
    this.shownSpecialPercent = percent;
    const ready = percent === 100;
    const cells = meterCells(charge);
    const name = SPECIAL_SHORT[id].toUpperCase();
    this.special.hidden = false;
    this.special.dataset.state = ready ? 'ready' : 'charging';
    this.specialName.textContent = ready ? `${name} READY` : name;
    this.specialHint.textContent = specialHint(device);
    this.specialCells.setAttribute('aria-label', ready ? 'Special ready' : `Special ${percent}% charged`);
    for (let i = 0; i < METER_CELLS; i++) this.cells[i]?.style.setProperty('--fill', `${Math.round(cells[i] * 100)}%`);
  }

  /**
   * The "PULSE BOMB READY · PRESS X" reminder: up while the meter is full during play, popping in
   * large the moment it fills (the CSS restarts that when the element is shown again), gone once
   * the Special fires or the meter drops. Touches the DOM only when the Special or device changes.
   */
  private drawPrompt(run: RunState, player: PlayerState | undefined, device: SourceKind): void {
    const id = player?.special ?? null;
    const live = run.phase === 'playing' || run.phase === 'waveIntro';
    if (!player || id === null || !live || !(player.specialCharge >= 1)) {
      if (this.shownPromptId !== null) {
        this.shownPromptId = null;
        this.shownPromptDevice = null;
        this.prompt.hidden = true;
      }
      return;
    }
    if (id === this.shownPromptId && device === this.shownPromptDevice) return;
    this.shownPromptId = id;
    this.shownPromptDevice = device;
    this.promptText.textContent = specialPrompt(id, device);
    this.prompt.hidden = false;
  }

  /** One chip per running power-up, counting down in whole seconds. */
  private drawPowerUps(player: PlayerState | undefined): void {
    const powerUps = player?.powerUps ?? [];
    // Compare kinds and whole seconds in place; only build chips when one differs.
    let n = 0;
    let changed = false;
    for (const p of powerUps) {
      if (!(p.timeLeft > 0)) continue;
      if (this.shownChipKinds[n] !== p.kind || this.shownChipSeconds[n] !== Math.ceil(p.timeLeft)) changed = true;
      n++;
    }
    if (!changed && n === this.shownChipKinds.length) return;
    const chips = powerUpChips(powerUps);
    this.shownChipKinds = chips.map((c) => c.kind);
    this.shownChipSeconds = chips.map((c) => c.seconds);
    this.powerUpStat.hidden = chips.length === 0;
    this.powerUpList.replaceChildren(
      ...chips.map((c) => {
        const li = document.createElement('li');
        li.className = c.low ? 'hud-chip is-low' : 'hud-chip';
        li.dataset.kind = c.kind;
        li.textContent = c.label;
        return li;
      }),
    );
  }

  /** The boss bar: name and health while a boss stands, gone once it is dead. */
  private drawBoss(run: RunState): void {
    const boss = run.boss;
    const health = boss ? bossHealth(boss) : 0;
    // A boss with nothing left is dead (or about to be removed); hide the bar either way. A sliver
    // of health still shows as 1%.
    const shown = health > 0 ? Math.max(1, bossBarPercent(health)) : -1;
    const phase = boss?.phase ?? -1;
    const kind = boss?.kind ?? '';
    if (shown === this.shownBoss && phase === this.shownBossPhase && kind === this.shownBossKind) return;
    this.shownBoss = shown;
    this.shownBossPhase = phase;
    this.shownBossKind = kind;
    this.boss.hidden = shown < 0;
    if (shown < 0 || !boss) return;
    this.boss.dataset.kind = boss.kind;
    this.bossName.textContent = BOSS_NAMES[boss.kind].toUpperCase();
    const phaseTag = bossPhaseLabel(boss.kind, boss.phase);
    this.bossPhase.textContent = phaseTag ?? '';
    this.bossPhase.hidden = phaseTag === null;
    this.bossFill.style.width = `${shown}%`;
    this.bossBar.setAttribute('aria-valuenow', String(shown));
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
