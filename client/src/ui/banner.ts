import type { Fit } from '../game/playfield';
import { byId } from './card';

// The big text in the middle of the field, such as "WAVE 2", that fades out on its own.
//
// main.ts: `new Banner()`; `layout(fit)` with the playfield's fit on start and on every resize;
// `banner.show('WAVE 2', seconds)` when a wave's intro starts (seconds is the intro's length);
// `hide()` to take it away early, e.g. on pause or quit.

/** Banner text is this fraction of the field's width tall. */
const TEXT_SIZE = 0.12;

export class Banner {
  private readonly root = byId('banner');
  private readonly text = byId('banner-text');
  private timer = 0;

  layout(fit: Fit): void {
    const style = this.root.style;
    style.left = `${fit.left}px`;
    style.top = `${fit.top}px`;
    style.width = `${fit.width}px`;
    style.height = `${fit.height}px`;
    style.setProperty('--banner-size', `${Math.max(20, Math.round(fit.width * TEXT_SIZE))}px`);
  }

  show(text: string, seconds: number): void {
    window.clearTimeout(this.timer);
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
  }
}
