/**
 * Service-worker side of the content-script relay.
 *
 * Holds whichever LEARN tab Ports are currently open and turns them into a
 * Fetcher. Module state here is intentionally ephemeral: if Chrome evicts the
 * worker, the Ports die with it and every content script reconnects on its own
 * timer, so there is nothing to persist.
 */

import { RELAY_PORT_NAME, type RelayRequest, type RelayResponse } from '@shared/messages';
import { type Result, err } from '@shared/result';
import type { AppError } from '@shared/errors';
import { REQUEST_TIMEOUT_MS } from '@shared/constants';
import { type Fetcher, type FetchOutcome, interpret, headerLookupFrom } from '@sync/fetchProxy';

interface Pending {
  readonly resolve: (r: Result<FetchOutcome, AppError>) => void;
  readonly path: string;
  readonly timer: ReturnType<typeof setTimeout>;
}

const ports = new Set<chrome.runtime.Port>();
const pending = new Map<number, Pending>();
let nextId = 1;

export const registerRelayPort = (port: chrome.runtime.Port): void => {
  if (port.name !== RELAY_PORT_NAME) return;

  ports.add(port);

  port.onMessage.addListener((raw: unknown) => {
    const res = raw as RelayResponse;
    const waiting = pending.get(res.id);
    if (waiting === undefined) return;

    clearTimeout(waiting.timer);
    pending.delete(res.id);

    if (!res.ok) {
      waiting.resolve(err({ kind: 'network', url: waiting.path, message: res.reason }));
      return;
    }

    waiting.resolve(
      interpret(waiting.path, {
        status: res.status,
        finalUrl: res.finalUrl,
        contentType: res.contentType,
        headerLookup: headerLookupFrom(res.headers),
        body: res.body,
      }),
    );
  });

  port.onDisconnect.addListener(() => {
    ports.delete(port);
    // Do not fail the in-flight requests here. Another tab may still be able to
    // serve them, and the per-request timeout is the real backstop.
  });
};

export const hasRelay = (): boolean => ports.size > 0;

const firstPort = (): chrome.runtime.Port | null => {
  for (const p of ports) return p;
  return null;
};

export const relayFetcher = (): Fetcher => ({
  tier: 'content',
  getJson(path) {
    const port = firstPort();
    if (port === null) {
      return Promise.resolve(
        err<AppError>({
          kind: 'no-session',
          message: 'No LEARN tab is open to authenticate the request.',
        }),
      );
    }

    const id = nextId;
    nextId += 1;

    return new Promise<Result<FetchOutcome, AppError>>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(err({ kind: 'network', url: path, message: 'Relay request timed out.' }));
      }, REQUEST_TIMEOUT_MS + 5_000);

      pending.set(id, { resolve, path, timer });

      const req: RelayRequest = { id, kind: 'fetch-json', path };
      try {
        port.postMessage(req);
      } catch (cause) {
        clearTimeout(timer);
        pending.delete(id);
        ports.delete(port);
        resolve(
          err({
            kind: 'network',
            url: path,
            message: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      }
    });
  },
});
