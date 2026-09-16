/**
 * Brightspace runs a token-bucket credit scheme and tells us about it on every
 * response. D2L reserves the right to change the credit cost of any route, so
 * budgeting off a fixed calls-per-minute figure is wrong by construction: we
 * budget off the headers instead.
 *
 * The state is pure data and lives in chrome.storage, because a service worker
 * is evicted after 30 seconds idle and anything held in a module-level variable
 * is gone by the next alarm.
 */

import {
  RATE_LIMIT_MAX_WAIT_MS,
  RATE_LIMIT_RESERVE,
  BACKOFF_STEPS_MS,
} from '@shared/constants';

export interface RateLimitState {
  readonly remaining: number | null;
  readonly resetAt: number | null;
  readonly lastCost: number | null;
  readonly consecutive429: number;
  readonly backoffStep: number;
}

export const initialRateLimitState: RateLimitState = {
  remaining: null,
  resetAt: null,
  lastCost: null,
  consecutive429: 0,
  backoffStep: 0,
};

export type Decision =
  | { readonly action: 'proceed' }
  | { readonly action: 'wait'; readonly ms: number }
  | { readonly action: 'abort'; readonly retryAfterMs: number };

export const decide = (state: RateLimitState, now: number): Decision => {
  if (state.remaining === null || state.resetAt === null) return { action: 'proceed' };
  if (state.remaining > RATE_LIMIT_RESERVE) return { action: 'proceed' };

  const waitMs = state.resetAt - now;
  if (waitMs <= 0) return { action: 'proceed' };
  if (waitMs <= RATE_LIMIT_MAX_WAIT_MS) return { action: 'wait', ms: waitMs };
  return { action: 'abort', retryAfterMs: waitMs };
};

export type HeaderLookup = (name: string) => string | null;

export const applyResponse = (
  state: RateLimitState,
  headers: HeaderLookup,
  now: number,
): RateLimitState => {
  const remaining = numberOrNull(headers('X-Rate-Limit-Remaining'));
  const cost = numberOrNull(headers('X-Request-Cost'));
  const resetAt = parseReset(headers('X-Rate-Limit-Reset'), now);

  return {
    ...state,
    remaining: remaining ?? state.remaining,
    lastCost: cost ?? state.lastCost,
    resetAt: resetAt ?? state.resetAt,
    consecutive429: 0,
  };
};

export const applyTooManyRequests = (
  state: RateLimitState,
  headers: HeaderLookup,
  now: number,
): RateLimitState => ({
  ...state,
  remaining: 0,
  resetAt: parseReset(headers('Retry-After'), now) ?? now + 60_000,
  consecutive429: state.consecutive429 + 1,
  backoffStep: Math.min(state.backoffStep + 1, BACKOFF_STEPS_MS.length),
});

export const backoffMs = (state: RateLimitState): number =>
  state.backoffStep === 0 ? 0 : (BACKOFF_STEPS_MS[state.backoffStep - 1] ?? 0);

export const clearBackoff = (state: RateLimitState): RateLimitState => ({
  ...state,
  backoffStep: 0,
  consecutive429: 0,
});

const numberOrNull = (raw: string | null): number | null => {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const parseReset = (raw: string | null, now: number): number | null => {
  const n = numberOrNull(raw);
  if (n === null) return null;
  if (n > 1_000_000_000) return n * 1000;
  return now + n * 1000;
};
