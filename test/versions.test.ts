import { describe, it, expect } from 'vitest';
import { parseVersions, discoverVersions, isStale, fallbackVersions } from '@d2l/versions';
import { fakeFetcher, versionsPayload } from '@test/doubles/fakeFetcher';

const NOW = 1_700_000_000_000;

describe('parseVersions', () => {
  it('reads the latest lp and le versions', () => {
    expect(parseVersions(versionsPayload)).toEqual({ lp: '1.49', le: '1.82' });
  });

  it('is case-insensitive about the product code', () => {
    expect(parseVersions([{ ProductCode: 'LE', LatestVersion: '1.82' }])?.le).toBe('1.82');
  });

  it('fills the missing half from the fallback rather than returning nothing', () => {
    expect(parseVersions([{ ProductCode: 'lp', LatestVersion: '1.49' }])).toEqual({
      lp: '1.49',
      le: '1.67',
    });
  });

  it('returns null when the payload is not an array', () => {
    expect(parseVersions({ nope: true })).toBeNull();
  });

  it('returns null when no recognised product is present', () => {
    expect(parseVersions([{ ProductCode: 'bas', LatestVersion: '1.0' }])).toBeNull();
  });

  it('skips malformed entries without throwing', () => {
    expect(parseVersions([null, { ProductCode: 42 }, { ProductCode: 'le', LatestVersion: '1.82' }])).toEqual({
      lp: '1.44',
      le: '1.82',
    });
  });
});

describe('discoverVersions', () => {
  it('marks discovered versions as such', async () => {
    const r = await discoverVersions(fakeFetcher([['/d2l/api/versions/', { json: versionsPayload }]]), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.source).toBe('discovered');
      expect(r.value.le).toBe('1.82');
    }
  });

  it('degrades to the fallback when the payload is unusable', async () => {
    const r = await discoverVersions(fakeFetcher([['/d2l/api/versions/', { json: {} }]]), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.source).toBe('fallback');
  });

  it('propagates an auth redirect instead of silently falling back', async () => {
    const r = await discoverVersions(
      fakeFetcher([
        ['/d2l/api/versions/', { error: { kind: 'auth-redirect', finalUrl: 'x', message: 'expired' } }],
      ]),
      NOW,
    );
    expect(r.ok).toBe(false);
  });
});

describe('isStale', () => {
  it('is fresh inside the ttl', () => {
    expect(isStale(fallbackVersions(NOW), NOW + 1000, 60_000)).toBe(false);
  });

  it('is stale past the ttl', () => {
    expect(isStale(fallbackVersions(NOW), NOW + 90_000, 60_000)).toBe(true);
  });
});
