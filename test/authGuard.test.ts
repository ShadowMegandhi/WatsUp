import { describe, it, expect } from 'vitest';
import { isAuthRedirect, isAuthSuspectBody } from '@d2l/authGuard';

const LEARN = 'https://learn.uwaterloo.ca';
const check = (url: string, contentType: string | null) =>
  isAuthRedirect({ url, contentType }, LEARN);

describe('isAuthRedirect', () => {
  it('accepts a normal JSON response from LEARN', () => {
    expect(check(`${LEARN}/d2l/api/versions/`, 'application/json; charset=utf-8')).toBe(false);
  });

  it('accepts a vendor JSON content type', () => {
    expect(check(`${LEARN}/d2l/api/lp/1.44/users/whoami`, 'application/vnd.d2l+json')).toBe(false);
  });

  it('flags a redirect to the ADFS sign-in host', () => {
    expect(check('https://adfs.uwaterloo.ca/adfs/ls/?wa=wsignin1.0', 'text/html')).toBe(true);
  });

  it('flags a redirect to Microsoft login', () => {
    expect(check('https://login.microsoftonline.com/common/oauth2/authorize', 'text/html')).toBe(true);
  });

  it('flags HTML served from LEARN itself — host check alone would miss this', () => {
    expect(check(`${LEARN}/d2l/lp/auth/login/login.d2l`, 'text/html; charset=utf-8')).toBe(true);
  });

  it('flags a missing content-type rather than assuming the best', () => {
    expect(check(`${LEARN}/d2l/api/versions/`, null)).toBe(true);
  });

  it('flags an unparseable response URL rather than trusting it', () => {
    expect(check('not a url', 'application/json')).toBe(true);
  });

  it('does not confuse a different uwaterloo host with LEARN', () => {
    expect(check('https://uwaterloo.ca/d2l/api/versions/', 'application/json')).toBe(true);
  });

  it('ignores port-free/protocol differences only via host, not full origin', () => {
    // Same host, different scheme — still the same host, so not a redirect.
    expect(check('http://learn.uwaterloo.ca/d2l/api/versions/', 'application/json')).toBe(false);
  });
});

describe('isAuthSuspectBody', () => {
  it.each([
    ['<!DOCTYPE html><html><body>Sign in</body></html>'],
    ['<html lang="en"><head><title>ADFS</title>'],
    ['   <!doctype HTML>'],
  ])('flags HTML-ish body %#', (body) => {
    expect(isAuthSuspectBody(body)).toBe(true);
  });

  it('does not flag genuine JSON that failed to parse for another reason', () => {
    expect(isAuthSuspectBody('{"Objects":[{"Id":1},')).toBe(false);
  });

  it('only inspects the head of a large body', () => {
    const body = `${' '.repeat(5000)}<html>`;
    expect(isAuthSuspectBody(body)).toBe(false);
  });
});
