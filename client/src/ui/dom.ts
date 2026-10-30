import type { ShipId } from '../game/types';
import { shipIconUrl } from './unlockview';

// Small DOM builders the unlock cards share.

/** An element with a class and, optionally, text. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A ship's 32x32 icon (CSS shows it at 3x, unsmoothed). If the file is missing it is hidden but keeps its space. */
export function shipIcon(id: ShipId, className = 'ship-icon'): HTMLImageElement {
  const img = h('img', className);
  img.alt = '';
  img.width = 32;
  img.height = 32;
  img.draggable = false;
  img.addEventListener('error', () => img.classList.add('is-missing'));
  img.src = shipIconUrl(id);
  return img;
}

/** A progress bar with its text: "120 / 300". */
export function progressBar(view: { text: string; percent: number }, label: string): HTMLElement {
  const wrap = h('span', 'unlock-progress');
  const bar = h('span', 'unlock-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', label);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(view.percent));
  const fill = h('i', 'unlock-bar-fill');
  fill.style.width = `${view.percent}%`;
  bar.append(fill);
  wrap.append(bar, h('span', 'unlock-bar-text', view.text));
  return wrap;
}
