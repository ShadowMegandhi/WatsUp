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
import { hostChanged, isAuthRedirect, isAuthSuspectBody } from '@d2l/authGuard';
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
  /**
   * Raw text, for documents rather than API calls.
   *
   * A syllabus page is HTML, and the JSON path rejects it before it can be
   * read: a non-JSON content type is how an expired session announces itself
   * on an API route, so that guard is right there and wrong here. This checks
   * the response host and sniffs the body for a sign-in page instead.
   */
  getText(path: string): Promise<Result<string, AppError>>;
}

/**
 * Shared interpretation of a raw response, used by every tier.
 *
 * The order here is load-bearing. Leaving LEARN or a 401 means signed out
 * whatever else is true. After that, a success status is checked for sign-in
 * HTML, because an expired session arrives as a 200 carrying the sign-in page.
 * Only then are error statuses reported as ordinary per-request failures.
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
  // Signed out looks like one of three things: a redirect that ended off
  // LEARN, an explicit 401, or a 200 carrying a sign-in page. Any other
  // error status from LEARN itself is an ordinary refusal of that one
  // request, whatever its body is. D2L serves those as HTML pages, and
  // reading them as a sign-out once aborted every sync and told a
  // signed-in student to sign in.
  if (hostChanged(raw.finalUrl, LEARN_ORIGIN) || raw.status === 401) {
    return err(authRedirect(raw.finalUrl));
  }

  const isSuccess = raw.status >= 200 && raw.status < 300;
  if (isSuccess && isAuthRedirect({ url: raw.finalUrl, contentType: raw.contentType }, LEARN_ORIGIN)) {
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
    return err(httpError(raw.status, path, raw.body));
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

/**
 * Interpretation for document fetches. Same auth reasoning as interpret, minus
 * the content-type rule, which would reject every document we want.
 */
export const interpretText = (
  path: string,
  raw: {
    readonly status: number;
    readonly finalUrl: string;
    readonly body: string;
  },
): Result<string, AppError> => {
  try {
    if (new URL(raw.finalUrl).host !== new URL(LEARN_ORIGIN).host) {
      return err(authRedirect(raw.finalUrl));
    }
  } catch {
    return err(authRedirect(raw.finalUrl));
  }

  if (raw.status < 200 || raw.status >= 300) return err(httpError(raw.status, path));

  // A sign-in page served from LEARN itself still means the session is gone.
  if (/<title>[^<]*sign in/i.test(raw.body) || raw.body.includes('adfs.uwaterloo.ca')) {
    return err(authRedirect(raw.finalUrl));
  }

  return ok(raw.body);
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

  async getText(path) {
    const url = new URL(path, LEARN_ORIGIN).toString();
    try {
      const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
      return interpretText(path, {
        status: response.status,
        finalUrl: response.url,
        body: await response.text(),
      });
    } catch (cause) {
      return err(networkError(url, cause));
    }
  },
});

/**
 * Hosts a syllabus link may legitimately point at.
 *
 * UW keeps course outlines in a central system rather than in LEARN, so a
 * course that looks like it has no syllabus often has one link away. Following
 * that link needs its own host permission, and the list is kept explicit so
 * the reach of this feature is obvious rather than implied.
 */
const FOLLOWABLE_HOSTS: readonly string[] = ['outline.uwaterloo.ca', 'learn.uwaterloo.ca'];

export const isFollowable = (url: string): boolean => {
  try {
    return FOLLOWABLE_HOSTS.includes(new URL(url).host);
  } catch {
    return false;
  }
};

/** Where an outline fetch ends up when the session has lapsed. */
export const landedOnSignIn = (finalUrl: string): boolean => {
  if (!isFollowable(finalUrl)) return true;
  return /\/(?:oidc|login|adfs|saml|sso)\//i.test(new URL(finalUrl).pathname + '/');
};

/**
 * Fetches a document from another uwaterloo host.
 *
 * This cannot go through the content-script relay: that runs on a LEARN page
 * and a cross-origin request from it would be refused. The service worker can
 * do it directly because the extension holds the host permission.
 *
 * Redirects are handled in two steps. Outline links routinely bounce once
 * (a trailing slash, a canonical id) even when signed in, so a redirect alone
 * does not mean signed out; treating it that way reported "sign in" for
 * outlines that were fine. But a lapsed session bounces on to Duo, a host
 * this extension has no permission for, and following that chain fails with
 * a bare "Failed to fetch". So: ask without following; on a redirect, follow
 * once, and if that throws or lands on a sign-in page, the session lapsed.
 */
export const fetchExternalText = async (url: string): Promise<Result<string, AppError>> => {
  if (!isFollowable(url)) {
    return err({ kind: 'http', status: 0, url, message: 'Not a followable host' });
  }

  try {
    let response = await fetch(url, { credentials: 'include', redirect: 'manual' });

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      try {
        response = await fetch(url, { credentials: 'include', redirect: 'follow' });
      } catch {
        return err(authRedirect(url));
      }
      if (landedOnSignIn(response.url)) return err(authRedirect(url));
    }

    if (!response.ok) return err(httpError(response.status, url));

    const body = await response.text();
    const head = body.slice(0, 2000).toLowerCase();
    const looksLikeSignIn =
      head.includes("duosecurity") ||
      head.includes("oidc/login") ||
      head.includes("<title>sign in") ||
      head.includes("single sign");

    if (looksLikeSignIn) {
      return err(authRedirect(url));
    }

    return ok(body);
  } catch (cause) {
    return err(networkError(url, cause));
  }
};
