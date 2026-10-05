import { describe, it, expect } from 'vitest';
import { interpret, headerLookupFrom, landedOnSignIn } from '@sync/fetchProxy';

const LEARN = 'https://learn.uwaterloo.ca';
const base = {
  status: 200,
  finalUrl: `${LEARN}/d2l/api/versions/`,
  contentType: 'application/json',
  headerLookup: () => null,
  body: '[]',
};

describe('interpret', () => {
  it('parses a healthy JSON response', () => {
    const r = interpret('/d2l/api/versions/', { ...base, body: '[{"ProductCode":"lp"}]' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.json).toEqual([{ ProductCode: 'lp' }]);
  });

  it('reports an auth redirect before looking at the status code', () => {
    // The status is a perfectly healthy 200 - this is exactly the trap.
    const r = interpret('/d2l/api/versions/', {
      ...base,
      status: 200,
      finalUrl: 'https://adfs.uwaterloo.ca/adfs/ls/?wa=wsignin1.0',
      contentType: 'text/html',
      body: '<!doctype html><html>Sign in</html>',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('auth-redirect');
  });

  it('treats sign-in HTML served from LEARN itself as an auth problem', () => {
    const r = interpret('/d2l/api/versions/', {
      ...base,
      contentType: 'text/html; charset=utf-8',
      body: '<html><title>Sign in</title></html>',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('auth-redirect');
  });

  it('classifies 429 as rate limiting, not a generic HTTP error', () => {
    const r = interpret('/x', { ...base, status: 429 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('rate-limited');
  });

  it('reports a 403 as a course-scoped HTTP error', () => {
    const r = interpret('/x', { ...base, status: 403 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('http');
      if (r.error.kind === 'http') expect(r.error.status).toBe(403);
    }
  });

  it('reports a 403 served as an HTML page from LEARN as an HTTP error, not a sign-out', () => {
    // A hidden course grade is refused like this. Treating it as a sign-out
    // stopped the whole sync and asked a signed-in student to sign in.
    const r = interpret('/d2l/api/le/1.82/1234/grades/final/values/myGradeValue', {
      ...base,
      status: 403,
      contentType: 'text/html; charset=utf-8',
      body: '<!DOCTYPE html><html><body>Not authorized</body></html>',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('http');
  });

  it('reports a 404 with no content type as an HTTP error, not a sign-out', () => {
    const r = interpret('/x', { ...base, status: 404, contentType: null, body: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('http');
  });

  it('still treats a 401 from LEARN as a sign-in problem', () => {
    const r = interpret('/x', { ...base, status: 401, contentType: 'text/html', body: '<html></html>' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('auth-redirect');
  });

  it('reports genuinely malformed JSON as a parse error, not an auth problem', () => {
    const r = interpret('/x', { ...base, body: '{"Objects":[' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('parse');
  });

  it('reclassifies an HTML body that slipped past the content type', () => {
    const r = interpret('/x', {
      ...base,
      contentType: 'application/json',
      body: '<!DOCTYPE html><html>adfs</html>',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('auth-redirect');
  });
});

describe('headerLookupFrom', () => {
  it('looks headers up case-insensitively', () => {
    const lookup = headerLookupFrom({ 'X-Rate-Limit-Remaining': '42' });
    expect(lookup('x-rate-limit-remaining')).toBe('42');
    expect(lookup('X-RATE-LIMIT-REMAINING')).toBe('42');
  });

  it('returns null for an absent header', () => {
    expect(headerLookupFrom({})('retry-after')).toBeNull();
  });
});

describe('landedOnSignIn', () => {
  it('flags the outline sign-in page', () => {
    expect(landedOnSignIn('https://outline.uwaterloo.ca/oidc/login/?next=/viewer/')).toBe(true);
  });

  it('flags a bounce to a host we do not follow', () => {
    expect(landedOnSignIn('https://adfs.uwaterloo.ca/adfs/ls/')).toBe(true);
  });

  it('accepts an ordinary outline page reached by a redirect', () => {
    expect(landedOnSignIn('https://outline.uwaterloo.ca/viewer/view/12345/')).toBe(false);
  });
});
