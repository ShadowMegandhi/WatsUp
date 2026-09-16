/**
 * The Fetcher port.
 *
 * Everything above this line is tier-agnostic. Tier A routes through a content
 * script on an open LEARN tab; Tier B fetches directly from the service worker
 * and is best-effort only. Both produce the same Result, so the sync engine
 * never branches on which one it got, and tests inject a third implementation
 * that reads from fixtures.
 */

import { type Result, ok, err } from '@shared/result';
import { type AppError, authRedirect, httpError, networkError, parseError } from '@shared/errors';
import { isAuthRedirect, isAuthSuspectBody } from '@d2l/authGuard';
import { LEARN_ORIGIN, REQUEST_TIMEOUT_MS } from '@shared/constants';
import type { HeaderLookup } from '@d2l/rateLimit';

export interface FetchOutcome {
  readonly json: unknown;
  readonly headers: HeaderLookup;
  readonly status: number;
}

export interface Fetcher {
  readonly tier: 'content' | 'worker';
  /** `path` is relative to the LEARN origin, e.g. "/d2l/api/versions/". */
  getJson(path: string): Promise<Result<FetchOutcome, AppError>>;
}

/**
 * Shared interpretation of a raw response, used by every tier.
 *
 * The order here is load-bearing. The auth check runs before the status check,
 * because an expired session arrives as a 200 carrying sign-in HTML and would
 * otherwise sail straight through.
 */
export const interpret = (
  path: string,
  raw: {
    readonly status: number;
    readonly finalUrl: string;
    readonly contentType: string | null;
    readonly headerLookup: HeaderLookup;
    readonly body: string;
  },
): Result<FetchOutcome, AppError> => {
  if (isAuthRedirect({ url: raw.finalUrl, contentType: raw.contentType }, LEARN_ORIGIN)) {
    return err(authRedirect(raw.finalUrl));
  }

  if (raw.status === 429) {
    return err({
      kind: 'rate-limited',
      retryAfterMs: 60_000,
      message: 'LEARN returned 429 Too Many Requests.',
    });
  }

  if (raw.status < 200 || raw.status >= 300) {
    return err(httpError(raw.status, path));
  }

  try {
    return ok({ json: JSON.parse(raw.body), headers: raw.headerLookup, status: raw.status });
  } catch {
    // A body that fails to parse but looks like a web page is the same expired
    // session wearing a different hat, not a bug the user can act on.
    if (isAuthSuspectBody(raw.body)) return err(authRedirect(raw.finalUrl));
    return err(parseError(path, 'response was not valid JSON'));
  }
};

export const headerLookupFrom = (bag: Readonly<Record<string, string>>): HeaderLookup => {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(bag)) lower[k.toLowerCase()] = v;
  return (name) => lower[name.toLowerCase()] ?? null;
};

/** Tier B. Works while no LEARN tab is open, but breaks under 3rd-party cookie blocking. */
export const workerFetcher = (): Fetcher => ({
  tier: 'worker',
  async getJson(path) {
    const url = new URL(path, LEARN_ORIGIN).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        redirect: 'follow',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      const body = await response.text();

      return interpret(path, {
        status: response.status,
        finalUrl: response.url,
        contentType: response.headers.get('content-type'),
        headerLookup: (name) => response.headers.get(name),
        body,
      });
    } catch (cause) {
      return err(networkError(url, cause));
    } finally {
      clearTimeout(timer);
    }
  },
});
