/**
 * Content script entry point. Runs on every learn.uwaterloo.ca page.
 *
 * Its whole job is to open a Port to the service worker and answer fetch
 * requests on it. It renders nothing and reads nothing from the page DOM.
 */

import { RELAY_PORT_NAME, type RelayRequest } from '@shared/messages';
import { handleRelayRequest } from './fetchRelay';

const connect = (): void => {
  let port: chrome.runtime.Port;

  try {
    port = chrome.runtime.connect({ name: RELAY_PORT_NAME });
  } catch {
    // The extension was reloaded or updated out from under this page. The next
    // page load will reconnect; there is nothing useful to do here.
    return;
  }

  port.onMessage.addListener((raw: unknown) => {
    const req = raw as RelayRequest;
    if (req.kind !== 'fetch-json') return;

    void handleRelayRequest(req).then((response) => {
      try {
        port.postMessage(response);
      } catch {
        // Port closed mid-flight, typically because the worker was evicted or
        // the tab is unloading. The worker will retry on its next run.
      }
    });
  });

  port.onDisconnect.addListener(() => {
    // Chrome evicts the service worker aggressively. Reconnect after a short
    // delay so the next sync has a relay available without needing a reload.
    setTimeout(connect, 2_000);
  });
};

connect();
