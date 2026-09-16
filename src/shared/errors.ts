/**
 * The error taxonomy.
 *
 * The distinction that matters most is `fatal`: only errors that are
 * necessarily global to a sync run may abort it. A 403 on one course's quizzes
 * endpoint must never stop the other five courses from syncing, but an expired
 * session makes every subsequent request pointless.
 */

export type AppError =
  /** Session expired — LEARN redirected us to ADFS. Global; aborts the run. */
  | { readonly kind: 'auth-redirect'; readonly finalUrl: string; readonly message: string }
  /** Rate-limit budget exhausted and the reset is too far out. Global. */
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number; readonly message: string }
  /** One endpoint failed. Course-scoped; the run continues. */
  | { readonly kind: 'http'; readonly status: number; readonly url: string; readonly message: string }
  /** Response was not the shape we expected. Course-scoped. */
  | { readonly kind: 'parse'; readonly url: string; readonly message: string }
  /** Network unreachable, aborted, offline. Course-scoped. */
  | { readonly kind: 'network'; readonly url: string; readonly message: string }
  /** chrome.storage refused a write (usually quota). */
  | { readonly kind: 'storage'; readonly message: string }
  /** The offscreen document failed or timed out. */
  | { readonly kind: 'offscreen'; readonly message: string }
  /** No LEARN tab available and the worker-tier fetch could not authenticate. */
  | { readonly kind: 'no-session'; readonly message: string };

/** True when this error makes every remaining request in the run pointless. */
export const isFatal = (e: AppError): boolean =>
  e.kind === 'auth-redirect' || e.kind === 'rate-limited' || e.kind === 'no-session';

/** True when the user must do something (sign in) before we can recover. */
export const needsUserAction = (e: AppError): boolean =>
  e.kind === 'auth-redirect' || e.kind === 'no-session';

export const authRedirect = (finalUrl: string): AppError => ({
  kind: 'auth-redirect',
  finalUrl,
  message: 'LEARN redirected to the sign-in page. The session has expired.',
});

export const httpError = (status: number, url: string): AppError => ({
  kind: 'http',
  status,
  url,
  message: `HTTP ${status} from ${url}`,
});

export const parseError = (url: string, detail: string): AppError => ({
  kind: 'parse',
  url,
  message: `Unexpected response shape from ${url}: ${detail}`,
});

export const networkError = (url: string, cause: unknown): AppError => ({
  kind: 'network',
  url,
  message: cause instanceof Error ? cause.message : String(cause),
});

/** A short, non-technical sentence suitable for the UI. */
export const userMessage = (e: AppError): string => {
  switch (e.kind) {
    case 'auth-redirect':
    case 'no-session':
      return 'Sign in to LEARN to refresh.';
    case 'rate-limited':
      return 'LEARN is rate-limiting us. Will retry later.';
    case 'http':
      return e.status === 403
        ? "This course didn't allow that request."
        : `LEARN returned an error (${e.status}).`;
    case 'parse':
      return "LEARN's response wasn't in the expected format.";
    case 'network':
      return 'Network problem while contacting LEARN.';
    case 'storage':
      return 'Could not save data locally.';
    case 'offscreen':
      return 'Could not read the syllabus file.';
  }
};
