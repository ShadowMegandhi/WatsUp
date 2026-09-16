/**
 * API version discovery.
 *
 * Valence versions its routes, and the docs disagree with what deployed
 * instances actually accept. Shipping hardcoded numbers means a D2L upgrade
 * breaks the extension for everyone at once, so we ask the instance and keep a
 * conservative fallback for when that call itself fails.
 */

import { type Result, ok } from '@shared/result';
import type { AppError } from '@shared/errors';
import { FALLBACK_LE_VERSION, FALLBACK_LP_VERSION } from '@shared/constants';
import type { Fetcher } from '@sync/fetchProxy';

export interface ApiVersions {
  readonly lp: string;
  readonly le: string;
  readonly fetchedAt: number;
  readonly source: 'discovered' | 'fallback';
}

export const fallbackVersions = (now: number): ApiVersions => ({
  lp: FALLBACK_LP_VERSION,
  le: FALLBACK_LE_VERSION,
  fetchedAt: now,
  source: 'fallback',
});

interface ProductVersion {
  readonly ProductCode?: unknown;
  readonly LatestVersion?: unknown;
}

/**
 * Never fails: a discovery problem degrades to the field-proven fallback
 * rather than blocking every other request behind it.
 */
export const discoverVersions = async (
  fetcher: Fetcher,
  now: number,
): Promise<Result<ApiVersions, AppError>> => {
  const result = await fetcher.getJson('/d2l/api/versions/');
  if (!result.ok) return result;

  const parsed = parseVersions(result.value.json);
  return ok(
    parsed === null
      ? fallbackVersions(now)
      : { ...parsed, fetchedAt: now, source: 'discovered' as const },
  );
};

export const parseVersions = (json: unknown): { lp: string; le: string } | null => {
  if (!Array.isArray(json)) return null;

  let lp: string | null = null;
  let le: string | null = null;

  for (const entry of json as readonly ProductVersion[]) {
    const code = typeof entry?.ProductCode === 'string' ? entry.ProductCode.toLowerCase() : null;
    const latest = typeof entry?.LatestVersion === 'string' ? entry.LatestVersion : null;
    if (code === null || latest === null) continue;
    if (code === 'lp') lp = latest;
    if (code === 'le') le = latest;
  }

  if (lp === null && le === null) return null;
  return { lp: lp ?? FALLBACK_LP_VERSION, le: le ?? FALLBACK_LE_VERSION };
};

export const isStale = (versions: ApiVersions, now: number, ttlMs: number): boolean =>
  now - versions.fetchedAt > ttlMs;
