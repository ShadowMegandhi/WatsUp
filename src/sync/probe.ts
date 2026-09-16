/**
 * Phase 1: the risk spike.
 *
 * This exists to answer one question before the rest of the product is built:
 * can a content script read the Valence API with nothing but the session
 * cookie, and what do the rate-limit headers actually say? Everything else in
 * the plan assumes yes. If the answer is no, the architecture changes.
 *
 * It walks the exact endpoint chain a real sync will use, records the raw
 * outcome of each step including headers and a body preview, and stops early
 * on an auth redirect because every later step would report the same thing.
 */

import type { Fetcher } from '@sync/fetchProxy';
import type { ProbeReport, ProbeStep } from '@shared/messages';
import { discoverVersions, fallbackVersions } from '@d2l/versions';
import { CALENDAR_LOOKAHEAD_DAYS, CALENDAR_LOOKBEHIND_DAYS } from '@shared/constants';
import { addDays, toUtcIso } from '@shared/time';

const BODY_PREVIEW_CHARS = 1200;

export const runProbe = async (fetcher: Fetcher, now: number): Promise<ProbeReport> => {
  const steps: ProbeStep[] = [];
  const startedAt = now;

  const versionStep = await measure(fetcher, 'API version discovery', '/d2l/api/versions/');
  steps.push(versionStep);

  if (versionStep.outcome === 'auth-redirect') {
    return finish(startedAt, fetcher, steps, Date.now());
  }

  const versionResult = await discoverVersions(fetcher, now);
  const versions = versionResult.ok ? versionResult.value : fallbackVersions(now);
  steps.push(
    note(
      `Using lp ${versions.lp} / le ${versions.le} (${versions.source})`,
      versions.source === 'fallback'
        ? 'Discovery did not return usable versions, so the field-proven fallback is in use.'
        : null,
    ),
  );

  const enrollPath =
    `/d2l/api/lp/${versions.lp}/enrollments/myenrollments/` +
    `?orgUnitTypeId=3&isActive=true`;
  const enrollStep = await measure(fetcher, 'My enrollments (courses)', enrollPath);
  steps.push(enrollStep);

  const calendarPath =
    `/d2l/api/le/${versions.le}/calendar/events/myEvents/` +
    `?startDateTime=${encodeURIComponent(toUtcIso(addDays(now, -CALENDAR_LOOKBEHIND_DAYS)))}` +
    `&endDateTime=${encodeURIComponent(toUtcIso(addDays(now, CALENDAR_LOOKAHEAD_DAYS)))}`;
  steps.push(await measure(fetcher, 'Calendar events (all courses)', calendarPath));

  const courseId = firstOrgUnitId(enrollStep.bodyPreview);
  if (courseId === null) {
    steps.push(
      note(
        'Per-course checks skipped',
        'Could not read an org unit id from the enrollments preview. Paste the full enrollments body to investigate.',
      ),
    );
  } else {
    steps.push(
      await measure(
        fetcher,
        `Assignment folders (course ${courseId})`,
        `/d2l/api/le/${versions.le}/${courseId}/dropbox/folders/`,
      ),
    );
    steps.push(
      await measure(
        fetcher,
        `Quizzes (course ${courseId})`,
        `/d2l/api/le/${versions.le}/${courseId}/quizzes/`,
      ),
    );
    steps.push(
      await measure(
        fetcher,
        'Final grades (all courses, one call)',
        `/d2l/api/le/${versions.le}/grades/final/values/myGradeValues/`,
      ),
    );
  }

  return finish(startedAt, fetcher, steps, Date.now());
};

const finish = (
  startedAt: number,
  fetcher: Fetcher,
  steps: readonly ProbeStep[],
  finishedAt: number,
): ProbeReport => ({ startedAt, finishedAt, tier: fetcher.tier, steps });

const measure = async (
  fetcher: Fetcher,
  label: string,
  path: string,
): Promise<ProbeStep> => {
  const began = Date.now();
  const result = await fetcher.getJson(path);
  const durationMs = Date.now() - began;

  if (result.ok) {
    const { headers, status, json } = result.value;
    return {
      label,
      path,
      outcome: 'ok',
      status,
      finalUrl: null,
      contentType: headers('content-type'),
      durationMs,
      rateLimit: {
        remaining: headers('x-rate-limit-remaining'),
        cost: headers('x-request-cost'),
        reset: headers('x-rate-limit-reset'),
      },
      bodyPreview: preview(json),
      note: describeShape(json),
    };
  }

  const e = result.error;
  return {
    label,
    path,
    outcome:
      e.kind === 'auth-redirect'
        ? 'auth-redirect'
        : e.kind === 'parse'
          ? 'parse-error'
          : e.kind === 'http'
            ? 'http-error'
            : 'network-error',
    status: e.kind === 'http' ? e.status : null,
    finalUrl: e.kind === 'auth-redirect' ? e.finalUrl : null,
    contentType: null,
    durationMs,
    rateLimit: { remaining: null, cost: null, reset: null },
    bodyPreview: '',
    note: e.message,
  };
};

const note = (label: string, detail: string | null): ProbeStep => ({
  label,
  path: '',
  outcome: 'ok',
  status: null,
  finalUrl: null,
  contentType: null,
  durationMs: 0,
  rateLimit: { remaining: null, cost: null, reset: null },
  bodyPreview: '',
  note: detail,
});

const preview = (json: unknown): string => {
  try {
    return JSON.stringify(json, null, 2).slice(0, BODY_PREVIEW_CHARS);
  } catch {
    return '[unserialisable]';
  }
};

/** A one-line summary so the report is readable without expanding every body. */
const describeShape = (json: unknown): string | null => {
  if (Array.isArray(json)) return `array of ${json.length}`;
  if (json !== null && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if (Array.isArray(obj['Items'])) return `paged, ${obj['Items'].length} items this page`;
    if (Array.isArray(obj['Objects'])) return `paged, ${obj['Objects'].length} objects this page`;
    return `object with keys: ${Object.keys(obj).slice(0, 8).join(', ')}`;
  }
  return null;
};

/**
 * Pulls the first org unit id out of the enrollments preview so the per-course
 * calls have something real to hit.
 *
 * Valence nests the course id at OrgUnit.Id on myenrollments, while some other
 * endpoints spell the same thing Identifier, so both are accepted. The
 * three-digit floor matters: the sibling OrgUnit.Type.Id is a small number
 * like 3 (Course Offering) and would otherwise be matched first.
 *
 * Reading the preview rather than the parsed body keeps the probe independent
 * of the normalizers, which do not exist yet.
 */
export const firstOrgUnitId = (bodyPreview: string): string | null => {
  const match = /"(?:Id|Identifier)" *: *"?([0-9]{3,})"?/.exec(bodyPreview);
  return match?.[1] ?? null;
};
