import { describe, it, expect } from 'vitest';
import {
  initialRateLimitState,
  decide,
  applyResponse,
  applyTooManyRequests,
  backoffMs,
  clearBackoff,
  type RateLimitState,
} from '@d2l/rateLimit';

const NOW = 1_700_000_000_000;
const headers = (bag: Record<string, string>) => (name: string) => bag[name] ?? null;

describe('decide', () => {
  it('proceeds when nothing is known yet', () => {
    expect(decide(initialRateLimitState, NOW)).toEqual({ action: 'proceed' });
  });

  it('proceeds while comfortably above the reserve', () => {
    const s: RateLimitState = { ...initialRateLimitState, remaining: 50, resetAt: NOW + 60_000 };
    expect(decide(s, NOW)).toEqual({ action: 'proceed' });
  });

  it('waits when at the reserve and the reset is near', () => {
    const s: RateLimitState = { ...initialRateLimitState, remaining: 2, resetAt: NOW + 5_000 };
    expect(decide(s, NOW)).toEqual({ action: 'wait', ms: 5_000 });
  });

  it('aborts rather than sleeping a worker Chrome may evict', () => {
    const s: RateLimitState = { ...initialRateLimitState, remaining: 0, resetAt: NOW + 120_000 };
    expect(decide(s, NOW)).toEqual({ action: 'abort', retryAfterMs: 120_000 });
  });

  it('proceeds once the reset has already passed', () => {
    const s: RateLimitState = { ...initialRateLimitState, remaining: 0, resetAt: NOW - 1 };
    expect(decide(s, NOW)).toEqual({ action: 'proceed' });
  });
});

describe('applyResponse', () => {
  it('reads remaining and cost', () => {
    const s = applyResponse(
      initialRateLimitState,
      headers({ 'X-Rate-Limit-Remaining': '42', 'X-Request-Cost': '3' }),
      NOW,
    );
    expect(s.remaining).toBe(42);
    expect(s.lastCost).toBe(3);
  });

  it('treats a small reset value as seconds from now', () => {
    const s = applyResponse(initialRateLimitState, headers({ 'X-Rate-Limit-Reset': '30' }), NOW);
    expect(s.resetAt).toBe(NOW + 30_000);
  });

  it('treats a large reset value as absolute epoch seconds', () => {
    const epochSeconds = 1_700_000_600;
    const s = applyResponse(
      initialRateLimitState,
      headers({ 'X-Rate-Limit-Reset': String(epochSeconds) }),
      NOW,
    );
    expect(s.resetAt).toBe(epochSeconds * 1000);
  });

  it('keeps prior values when headers are absent', () => {
    const prior: RateLimitState = { ...initialRateLimitState, remaining: 7, resetAt: NOW + 1000 };
    const s = applyResponse(prior, headers({}), NOW);
    expect(s.remaining).toBe(7);
    expect(s.resetAt).toBe(NOW + 1000);
  });

  it('ignores non-numeric garbage', () => {
    const s = applyResponse(
      initialRateLimitState,
      headers({ 'X-Rate-Limit-Remaining': 'unlimited' }),
      NOW,
    );
    expect(s.remaining).toBeNull();
  });

  it('clears a 429 streak on success', () => {
    const prior: RateLimitState = { ...initialRateLimitState, consecutive429: 2 };
    expect(applyResponse(prior, headers({}), NOW).consecutive429).toBe(0);
  });

  it('does not mutate the input state', () => {
    const prior = { ...initialRateLimitState };
    applyResponse(prior, headers({ 'X-Rate-Limit-Remaining': '9' }), NOW);
    expect(prior).toEqual(initialRateLimitState);
  });
});

describe('applyTooManyRequests', () => {
  it('honours Retry-After and escalates the streak', () => {
    const s = applyTooManyRequests(initialRateLimitState, headers({ 'Retry-After': '45' }), NOW);
    expect(s.remaining).toBe(0);
    expect(s.resetAt).toBe(NOW + 45_000);
    expect(s.consecutive429).toBe(1);
    expect(s.backoffStep).toBe(1);
  });

  it('defaults to a minute when Retry-After is missing', () => {
    const s = applyTooManyRequests(initialRateLimitState, headers({}), NOW);
    expect(s.resetAt).toBe(NOW + 60_000);
  });

  it('caps the backoff step at the number of defined steps', () => {
    let s = initialRateLimitState;
    for (let i = 0; i < 8; i += 1) s = applyTooManyRequests(s, headers({}), NOW);
    expect(s.backoffStep).toBe(2);
    expect(backoffMs(s)).toBe(120 * 60 * 1000);
  });
});

describe('backoff', () => {
  it('is zero before any trouble', () => {
    expect(backoffMs(initialRateLimitState)).toBe(0);
  });

  it('clears back to zero', () => {
    const s = applyTooManyRequests(initialRateLimitState, headers({}), NOW);
    expect(backoffMs(clearBackoff(s))).toBe(0);
  });
});
