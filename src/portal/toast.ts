/**
 * A small confirmation shown on Quest and Portal after a read.
 *
 * Three rounds of diagnostics reported no schedule captured while the page was
 * open, and there was no way to tell whether the script had run at all, run
 * and found nothing, or run and failed to save. Saying so on the page turns
 * that into an immediate answer instead of a round trip.
 *
 * Shadow DOM again, because this lands on someone elses page and neither side
 * should be able to restyle the other.
 */

const HOST_ID = 'uwlt-toast-host';
const VISIBLE_MS = 6000;

export const showToast = (message: string, tone: 'ok' | 'warn'): void => {
  if (document.body === null) return;

  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'all: initial; position: static;';

  const shadow = host.attachShadow({ mode: 'open' });
  const wrap = document.createElement('div');
  wrap.className = tone === 'ok' ? 'toast ok' : 'toast warn';
  wrap.textContent = message;

  const css = `
    .toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483000;
      max-width: 340px;
      padding: 12px 16px;
      border-radius: 12px;
      font: 600 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
      color: #fff;
      box-shadow: 0 12px 32px -8px rgba(20, 24, 35, 0.45);
    }
    .toast.ok { background: #1f7a4d; }
    .toast.warn { background: #8a5a00; }
  `;

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.appendChild(style);
  }

  shadow.appendChild(wrap);
  document.body.appendChild(host);

  setTimeout(() => host.remove(), VISIBLE_MS);
};
