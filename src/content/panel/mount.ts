/**
 * Puts the panel on the page.
 *
 * Two things matter here and both are about being a good guest in someone
 * else page:
 *
 *   1. A shadow root. LEARN stylesheets are broad and would restyle the panel,
 *      and our styles could just as easily break LEARN. Nothing crosses.
 *   2. A single host element with a fixed id, so repeated injections (LEARN is
 *      partly a single-page app and re-runs scripts) never stack up panels.
 */

import { render } from 'preact';
import { h } from 'preact';
import { Panel } from './Panel';
import PANEL_CSS from './panel.css?raw';
import { readPanelPrefs, writePanelPrefs } from '@storage/store';

const HOST_ID = 'uwlt-panel-host';
const MARGIN = 16;

export const mountPanel = async (): Promise<void> => {
  if (document.getElementById(HOST_ID) !== null) return;
  if (document.body === null) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  // The host itself must not take up space or intercept clicks; only the
  // panel inside it does.
  host.style.cssText = 'all: initial; position: static;';

  const shadow = host.attachShadow({ mode: 'open' });

  applyStyles(shadow);

  const root = document.createElement('div');
  root.className = 'root';
  shadow.appendChild(root);

  document.body.appendChild(host);

  await positionRoot(root);
  render(h(Panel, {}), root);
  enableDragging(root);
};

/**
 * Restores the last position, clamped back on-screen. A panel remembered at
 * coordinates from a wider monitor would otherwise be stranded off the edge.
 */
const positionRoot = async (root: HTMLElement): Promise<void> => {
  const prefs = await readPanelPrefs();
  const width = 480;
  const height = 280;

  const maxX = Math.max(MARGIN, window.innerWidth - width - MARGIN);
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN);

  const x = prefs.x === null ? maxX : clamp(prefs.x, MARGIN, maxX);
  const y = prefs.y === null ? 84 : clamp(prefs.y, MARGIN, maxY);

  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
};

/**
 * Adds the stylesheet in the way least likely to be refused.
 *
 * A LEARN page can ship a strict style-src policy, and an injected style
 * element is exactly what such a policy blocks. Constructable stylesheets are
 * not governed by page CSP, so they are tried first; the style element remains
 * as a fallback for anything that lacks the API.
 */
const applyStyles = (shadow: ShadowRoot): void => {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];
    return;
  } catch {
    // Fall through to the element form.
  }

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;
  shadow.appendChild(style);
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Dragging by the header.
 *
 * Listeners go on the shadow root rather than the document so a drag cannot
 * leak into LEARN own mouse handling, and pointer capture keeps the drag alive
 * if the cursor outruns the panel.
 */
const enableDragging = (root: HTMLElement): void => {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  root.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement | null;
    const handle = target?.closest('[data-drag-handle], .pill');
    if (handle === null || handle === undefined) return;

    // Let the buttons inside the header do their own job.
    if (target?.closest('.iconbtn') !== null) return;

    dragging = true;
    const rect = root.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const rect = root.getBoundingClientRect();
    const x = clamp(event.clientX - offsetX, 0, Math.max(0, window.innerWidth - rect.width));
    const y = clamp(event.clientY - offsetY, 0, Math.max(0, window.innerHeight - rect.height));
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  });

  const end = (): void => {
    if (!dragging) return;
    dragging = false;
    void writePanelPrefs({
      x: Math.round(parseFloat(root.style.left) || 0),
      y: Math.round(parseFloat(root.style.top) || 0),
    });
  };

  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  // A resized or rotated window can strand the panel off-screen.
  window.addEventListener('resize', () => {
    void positionRoot(root);
  });
};
