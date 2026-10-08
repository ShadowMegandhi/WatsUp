/**
 * Content script entry point. Runs on every learn.uwaterloo.ca page.
 *
 * Two jobs:
 *   1. Relay authenticated fetches for the service worker. Requests run here
 *      because this is a genuine first-party context on LEARN, so the session
 *      cookie is attached the way the browser always attaches it.
 *   2. Mount the panel.
 *
 * It holds no domain logic and writes no synced state. The service worker
 * remains the single writer, so several open LEARN tabs cannot race.
 */

import { RELAY_PORT_NAME, type RelayRequest } from '@shared/messages';
import { watchSubmissions } from './submitWatch';
import { handleRelayRequest } from './fetchRelay';
import { mountPanel } from './panel/mount';

const connect = (): void => {
  let port: chrome.runtime.Port;

  try {
    port = chrome.runtime.connect({ name: RELAY_PORT_NAME });
  } catch {
    // The extension was reloaded or updated out from under this page. The next
    // page load reconnects; there is nothing useful to do here.
    return;
  }

  port.onMessage.addListener((raw: unknown) => {
    const req = raw as RelayRequest;
    if (req.kind !== 'fetch-json' && req.kind !== 'fetch-text') return;

    void handleRelayRequest(req).then((response) => {
      try {
        port.postMessage(response);
      } catch {
        // Port closed mid-flight, usually because the worker was evicted or
        // the tab is unloading. The worker retries on its next run.
      }
    });
  });

  port.onDisconnect.addListener(() => {
    // Chrome evicts service workers aggressively. Reconnect shortly so the
    // next sync has a relay without needing a page reload.
    setTimeout(connect, 2_000);
  });
};

const start = (): void => {
  connect();
  void mountPanel();
  // Ask for a sync on arrival. The worker enforces the minimum interval, so
  // opening five LEARN tabs does not mean five syncs.
  void chrome.runtime.sendMessage({ type: 'sync-if-stale' }).catch(() => undefined);
  // On an assignment or quiz page, re-check that course straight away and
  // again after a Submit press, so handed-in work ticks itself off.
  watchSubmissions((courseId) => {
    void chrome.runtime.sendMessage({ type: 'recheck-course', courseId }).catch(() => undefined);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
