/**
 * The wire protocol.
 *
 * Two channels exist, and they are deliberately different shapes:
 *
 *   Port "learn-relay"  The content script opens a long-lived Port on every
 *                       LEARN page. The service worker sends fetch requests
 *                       down it and gets responses back. It is a Port rather
 *                       than one-shot sendMessage calls for a specific reason:
 *                       traffic on an open Port resets the service worker idle
 *                       timer, so a long sync cannot be evicted halfway.
 *
 *   sendMessage         Everything else: the UI asking for a sync, reading
 *                       diagnostics, running the probe.
 */

export const RELAY_PORT_NAME = 'learn-relay';

/** Service worker to content script. */
export type RelayRequest = {
  readonly id: number;
  readonly kind: 'fetch-json' | 'fetch-text';
  readonly path: string;
};

/** Content script to service worker. */
export type RelayResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly status: number;
      readonly finalUrl: string;
      readonly contentType: string | null;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly status: number;
      readonly finalUrl: string;
      readonly reason: string;
    };

/** UI or alarm to service worker. */
export type Command =
  | { readonly type: 'probe' }
  | { readonly type: 'get-probe-result' }
  /** Forced: the user pressed refresh. Ignores the minimum interval. */
  | { readonly type: 'sync-now' }
  /** Opportunistic: a LEARN page loaded. Honours the minimum interval, so
   *  opening five tabs does not mean five syncs. */
  | { readonly type: 'sync-if-stale' }
  | { readonly type: 'get-status' }
  /** Throw away derived data and sync again. Keeps ticked-off state. */
  | { readonly type: 'reset-and-sync' };

export type CommandReply =
  | { readonly type: 'probe-started' }
  | { readonly type: 'probe-result'; readonly report: ProbeReport | null }
  | { readonly type: 'status'; readonly status: RuntimeStatus }
  | { readonly type: 'error'; readonly message: string };

export interface RuntimeStatus {
  readonly learnTabOpen: boolean;
  readonly relayConnected: boolean;
  readonly lastProbeAt: number | null;
}

/**
 * The Phase 1 risk spike output. This exists to answer one question before any
 * other code is written: can a content script read the Valence API with
 * nothing but the session cookie, and what do the rate-limit headers say?
 */
export interface ProbeReport {
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly tier: 'content' | 'worker';
  readonly steps: readonly ProbeStep[];
}

export interface ProbeStep {
  readonly label: string;
  readonly path: string;
  readonly outcome: 'ok' | 'auth-redirect' | 'http-error' | 'parse-error' | 'network-error';
  readonly status: number | null;
  readonly finalUrl: string | null;
  readonly contentType: string | null;
  readonly durationMs: number;
  readonly rateLimit: {
    readonly remaining: string | null;
    readonly cost: string | null;
    readonly reset: string | null;
  };
  /** Truncated so a huge course list cannot blow up the popup or storage. */
  readonly bodyPreview: string;
  readonly note: string | null;
}
