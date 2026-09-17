/**
 * An in-memory Fetcher for tests.
 *
 * Routes are matched by substring so a test can key on the meaningful part of
 * a path without restating query strings and version numbers.
 */

import type { Fetcher, FetchOutcome } from '@sync/fetchProxy';
import type { Result } from '@shared/result';
import { ok, err } from '@shared/result';
import type { AppError } from '@shared/errors';

export type RouteReply =
  | { readonly json: unknown; readonly headers?: Record<string, string> }
  | { readonly text: string }
  | { readonly error: AppError };

export interface FakeFetcher extends Fetcher {
  readonly calls: readonly string[];
}

export const fakeFetcher = (
  routes: ReadonlyArray<readonly [match: string, reply: RouteReply]>,
  tier: 'content' | 'worker' = 'content',
): FakeFetcher => {
  const calls: string[] = [];

  return {
    tier,
    calls,
    getText(path: string): Promise<Result<string, AppError>> {
      calls.push(path);
      const hit = routes.find(([match]) => path.includes(match));
      if (hit === undefined) {
        return Promise.resolve(
          err<AppError>({ kind: 'http', status: 404, url: path, message: `no route for ${path}` }),
        );
      }
      const reply = hit[1];
      if ('error' in reply) return Promise.resolve(err(reply.error));
      if ('text' in reply) return Promise.resolve(ok(reply.text));
      return Promise.resolve(ok(JSON.stringify(reply.json)));
    },

    getJson(path: string): Promise<Result<FetchOutcome, AppError>> {
      calls.push(path);

      const hit = routes.find(([match]) => path.includes(match));
      if (hit === undefined) {
        return Promise.resolve(
          err<AppError>({ kind: 'http', status: 404, url: path, message: `no route for ${path}` }),
        );
      }

      const reply = hit[1];
      if ('error' in reply) return Promise.resolve(err(reply.error));
      if ('text' in reply) {
        return Promise.resolve(
          err<AppError>({ kind: 'parse', url: path, message: 'route is text, not json' }),
        );
      }

      const bag = reply.headers ?? {};
      const lower: Record<string, string> = { 'content-type': 'application/json' };
      for (const [k, v] of Object.entries(bag)) lower[k.toLowerCase()] = v;

      return Promise.resolve(
        ok({
          json: reply.json,
          status: 200,
          headers: (name: string) => lower[name.toLowerCase()] ?? null,
        }),
      );
    },
  };
};

/** Shape of a Valence /versions/ payload. */
export const versionsPayload = [
  { ProductCode: 'lp', LatestVersion: '1.49', SupportedVersions: ['1.44', '1.49'] },
  { ProductCode: 'le', LatestVersion: '1.82', SupportedVersions: ['1.67', '1.82'] },
];

/** Minimal enrollments page, shaped like the real paged response. */
export const enrollmentsPayload = {
  PagingInfo: { Bookmark: null, HasMoreItems: false },
  Items: [
    {
      OrgUnit: { Id: 912345, Type: { Id: 3, Code: 'Course Offering' }, Name: 'MATH 135', Code: 'MATH135_F26' },
      Access: { IsActive: true },
    },
  ],
};
