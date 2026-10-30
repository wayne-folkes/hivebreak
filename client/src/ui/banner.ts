import type { Fit } from '../game/playfield';
import type { Sector } from '../game/types';
import { byId } from './card';
import { sectorBanner } from './format';

// The big text in the middle of the field, such as "WAVE 2", that fades out on its own. Going
// into a new sector gets its own, redder banner ("SECTOR 2" over a subtitle).
//
// main.ts: `new Banner()`; `layout(fit)` with the playfield's fit on start and on every resize;
// `banner.show('WAVE 2', seconds)` when a wave's intro starts (seconds is the intro's length);
// on a `sectorStart` event, `banner.sector(event.sector, seconds, run.wave + 1)` in place of that
// wave's `show` (it names the wave in a small line under the subtitle, and does nothing for
// sector 1, so call `show` as usual there); `hide()` to take either away early, e.g. on pause or quit.

/** Banner text is this fraction of the field's width tall. */
const TEXT_SIZE = 0.12;

export class Banner {
  private readonly root = byId('banner');
  private readonly text = byId('banner-text');
  private readonly sectorRoot = byId('sector-banner');
  private readonly sectorTitle = byId('sector-banner-title');
  private readonly sectorSub = byId('sector-banner-sub');
  private readonly sectorWave = byId('sector-banner-wave');
  private timer = 0;

  layout(fit: Fit): void {
    for (const root of [this.root, this.sectorRoot]) {
      const style = root.style;
      style.left = `${fit.left}px`;
      style.top = `${fit.top}px`;
      style.width = `${fit.width}px`;
      style.height = `${fit.height}px`;
      style.setProperty('--banner-size', `${Math.max(20, Math.round(fit.width * TEXT_SIZE))}px`);
    }
  }

  /**
   * The sector banner. Sector 1 gets none (returns false and shows nothing, so the caller shows
   * the wave banner instead); otherwise it replaces any banner showing and returns true.
   * @param wave the wave number it opens, counting from 1, named in a small line under the subtitle.
   */
  sector(sector: Sector, seconds: number, wave?: number): boolean {
    const banner = sectorBanner(sector);
    if (!banner) return false;
    window.clearTimeout(this.timer);
    this.root.hidden = true;
    this.sectorTitle.textContent = banner.title;
    this.sectorSub.textContent = banner.sub;
    this.sectorWave.textContent = wave === undefined ? '' : `WAVE ${wave}`;
    this.sectorWave.hidden = wave === undefined;
    this.sectorRoot.style.setProperty('--banner-seconds', `${seconds}s`);
    this.sectorRoot.hidden = true;
    void this.sectorRoot.offsetWidth;
    this.sectorRoot.hidden = false;
    this.timer = window.setTimeout(() => this.hide(), seconds * 1000);
    return true;
  }

  show(text: string, seconds: number): void {
    window.clearTimeout(this.timer);
    this.sectorRoot.hidden = true;
    this.text.textContent = text;
    this.text.style.setProperty('--banner-seconds', `${seconds}s`);
    // Taking the element out and putting it back restarts the fade, even for the same text.
    this.root.hidden = true;
    void this.root.offsetWidth;
    this.root.hidden = false;
    this.timer = window.setTimeout(() => this.hide(), seconds * 1000);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.root.hidden = true;
    this.sectorRoot.hidden = true;
  }
}
