/**
 * The single most important guard in the extension.
 *
 * When a LEARN session expires, the Valence API does NOT return 401. It issues
 * a 302 to adfs.uwaterloo.ca, and `fetch` follows redirects by default — so the
 * caller sees `response.ok === true`, status 200, and a body full of sign-in
 * HTML. Code that trusts the status code will happily JSON.parse that, fail
 * with a SyntaxError, conclude "the API is broken", and retry forever.
 *
 * Both signals are checked because either alone is insufficient:
 *   - the host check catches a redirect away from LEARN, but some LEARN error
 *     pages are served from LEARN's own origin as HTML;
 *   - the content-type check catches those, but a same-origin JSON error page
 *     would slip through the host check alone.
 *
 * Kept pure and in its own file so it can be tested exhaustively without a
 * network, and because MSW cannot easily fake a cross-origin `response.url`.
 */

export interface ResponseShape {
  readonly url: string;
  readonly contentType: string | null;
}

/** True when this response is a sign-in page wearing a 200. */
export const isAuthRedirect = (
  response: ResponseShape,
  learnOrigin: string,
): boolean => hostChanged(response.url, learnOrigin) || !looksLikeJson(response.contentType);

const hostChanged = (responseUrl: string, learnOrigin: string): boolean => {
  try {
    return new URL(responseUrl).host !== new URL(learnOrigin).host;
  } catch {
    // An unparseable URL is not something we should treat as trusted.
    return true;
  }
};

const looksLikeJson = (contentType: string | null): boolean =>
  (contentType ?? '').toLowerCase().includes('json');

/**
 * A JSON.parse failure on an apparently-fine response is the same problem
 * wearing a different hat, so callers funnel it here rather than reporting a
 * parse bug the user can do nothing about.
 */
export const isAuthSuspectBody = (body: string): boolean => {
  const head = body.slice(0, 2048).toLowerCase();
  return (
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('adfs') ||
    head.includes('sign in') ||
    head.includes('login.microsoftonline')
  );
};
