/**
 * Phase 1: the risk spike.
 *
 * Round 1 against a real UW account proved the core assumption: a content
 * script can read the Valence API with nothing but the session cookie. It also
 * turned up three things worth designing around, which is why this file now
 * does more than walk a happy path:
 *
 *   1. UW runs lp 1.63 / le 1.97, far newer than the documented fallbacks.
 *      Version discovery is not optional.
 *   2. UW emits no rate-limit headers at all, so the header-driven budget has
 *      nothing to read and pacing has to be conservative and fixed.
 *   3. Two endpoints returned 400. Their response bodies were being discarded,
 *      so this round captures them and tries variants to find a shape that
 *      works.
 *
 * A course list also contains community shells (Residence Experience, Co-op
 * Community) that carry no coursework, so probing the first org unit proves
 * nothing. Real courses are picked out by course code.
 */

import type { Fetcher } from '@sync/fetchProxy';
import type { ProbeReport, ProbeStep } from '@shared/messages';
import { discoverVersions, fallbackVersions } from '@d2l/versions';
import { addDays } from '@shared/time';

const BODY_PREVIEW_CHARS = 900;

/** Subject plus catalog number, e.g. ECE 106 or MATH135. No escapes on purpose. */
const COURSE_CODE = /[A-Z]{2,6} ?[0-9]{3}/;

export interface CourseRef {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly looksAcademic: boolean;
}

export const runProbe = async (fetcher: Fetcher, now: number): Promise<ProbeReport> => {
  const steps: ProbeStep[] = [];
  const startedAt = now;

  const versionStep = await measure(fetcher, 'API version discovery', '/d2l/api/versions/');
  steps.push(versionStep);

  if (versionStep.outcome === 'auth-redirect') {
    return { startedAt, finishedAt: Date.now(), tier: fetcher.tier, steps };
  }

  const versionResult = await discoverVersions(fetcher, now);
  const v = versionResult.ok ? versionResult.value : fallbackVersions(now);
  steps.push(note(`Using lp ${v.lp} / le ${v.le} (${v.source})`, null));

  // --- Courses -------------------------------------------------------------
  const enrollPath = `/d2l/api/lp/${v.lp}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true`;
  steps.push(await measure(fetcher, 'My enrollments (courses)', enrollPath));

  const enrollResult = await fetcher.getJson(enrollPath);
  const courses = enrollResult.ok ? parseCourses(enrollResult.value.json) : [];
  const academic = courses.filter((c) => c.looksAcademic);
  const targets = (academic.length > 0 ? academic : courses).slice(0, 2);

  steps.push(
    note(
      `Found ${courses.length} enrolments, ${academic.length} look like real courses`,
      courses.length === 0
        ? 'Could not read any org units from the enrolments payload.'
        : courses
            .map((c) => `${c.id}  ${c.looksAcademic ? '[course]' : '[other] '}  ${c.name}`)
            .join('\n'),
    ),
  );

  // --- Calendar: the first 400. Try shapes until one is accepted. ----------
  const start = addDays(now, -30);
  const end = addDays(now, 120);
  const ouCsv = targets.map((c) => c.id).join(',');

  steps.push(
    note('Calendar events: trying request shapes', 'Round 1 returned HTTP 400 for the plain start/end form.'),
  );
  for (const variant of calendarVariants(v.le, start, end, ouCsv, targets[0]?.id)) {
    const step = await measure(fetcher, `  calendar: ${variant.label}`, variant.path, true);
    steps.push(step);
    if (step.outcome === 'ok') break;
  }

  // --- Grades: the second 400. --------------------------------------------
  const gradeCourse = targets[0];
  if (gradeCourse !== undefined) {
    steps.push(
      note('Grades: trying request shapes', 'Round 1 returned HTTP 400 for the all-courses form.'),
    );
    for (const variant of gradeVariants(v.le, gradeCourse.id)) {
      const step = await measure(fetcher, `  grades: ${variant.label}`, variant.path, true);
      steps.push(step);
      if (step.outcome === 'ok') break;
    }
  }

  // --- Per-course endpoints, on courses that actually have coursework ------
  for (const course of targets) {
    const label = `${course.code || course.name} (${course.id})`;
    steps.push(
      await measure(fetcher, `Assignments - ${label}`, `/d2l/api/le/${v.le}/${course.id}/dropbox/folders/`, true),
    );
    steps.push(
      await measure(fetcher, `Quizzes - ${label}`, `/d2l/api/le/${v.le}/${course.id}/quizzes/`, true),
    );
    steps.push(
      await measure(fetcher, `Content tree - ${label}`, `/d2l/api/le/${v.le}/${course.id}/content/toc`),
    );
    steps.push(
      await measure(fetcher, `Announcements - ${label}`, `/d2l/api/le/${v.le}/${course.id}/news/`),
    );
  }

  steps.push(
    note(
      'Rate limiting',
      steps.some((s) => s.rateLimit.remaining !== null)
        ? 'Rate-limit headers are present and can drive the budget.'
        : 'No rate-limit headers on any response. The budget cannot be header-driven here, so pacing must be conservative and fixed.',
    ),
  );

  return { startedAt, finishedAt: Date.now(), tier: fetcher.tier, steps };
};

interface Variant {
  readonly label: string;
  readonly path: string;
}

/**
 * Candidate shapes for myEvents. The plain start/end pair is documented but was
 * rejected, so the likely culprits are the fractional seconds in the timestamp,
 * the width of the window, or a missing org unit filter.
 */
const calendarVariants = (
  le: string,
  start: number,
  end: number,
  ouCsv: string,
  firstCourse: string | undefined,
): readonly Variant[] => {
  const base = `/d2l/api/le/${le}/calendar/events/myEvents/`;
  const iso = (at: number) => encodeURIComponent(new Date(at).toISOString());
  const isoNoMs = (at: number) => encodeURIComponent(`${new Date(at).toISOString().slice(0, 19)}Z`);

  const variants: Variant[] = [
    {
      label: 'no milliseconds in timestamps',
      path: `${base}?startDateTime=${isoNoMs(start)}&endDateTime=${isoNoMs(end)}`,
    },
    {
      label: 'with orgUnitIdsCSV',
      path: `${base}?startDateTime=${iso(start)}&endDateTime=${iso(end)}&orgUnitIdsCSV=${ouCsv}`,
    },
    { label: 'no date filter at all', path: base },
  ];

  if (firstCourse !== undefined) {
    variants.push({
      label: 'scoped to one course',
      path: `/d2l/api/le/${le}/${firstCourse}/calendar/events/myEvents/?startDateTime=${iso(start)}&endDateTime=${iso(end)}`,
    });
  }
  return variants;
};

/**
 * Candidate shapes for grades. The all-courses route may simply not exist on
 * this version, in which case per-course calls are the answer and the cost is
 * one request per course rather than one overall.
 */
const gradeVariants = (le: string, orgUnitId: string): readonly Variant[] => [
  { label: 'per-course all values', path: `/d2l/api/le/${le}/${orgUnitId}/grades/values/myGradeValues/` },
  { label: 'per-course final value', path: `/d2l/api/le/${le}/${orgUnitId}/grades/final/values/myGradeValue` },
  { label: 'per-course grade objects', path: `/d2l/api/le/${le}/${orgUnitId}/grades/` },
];

/** Reads the enrolments payload into a flat course list. */
export const parseCourses = (json: unknown): readonly CourseRef[] => {
  const items = (json as { Items?: unknown })?.Items;
  if (!Array.isArray(items)) return [];

  const out: CourseRef[] = [];
  for (const item of items) {
    const ou = (item as { OrgUnit?: Record<string, unknown> })?.OrgUnit;
    if (ou === undefined || ou === null) continue;

    const id = typeof ou['Id'] === 'number' ? String(ou['Id']) : null;
    if (id === null) continue;

    const name = typeof ou['Name'] === 'string' ? ou['Name'] : '';
    const code = typeof ou['Code'] === 'string' ? ou['Code'] : '';

    out.push({
      id,
      name,
      code,
      looksAcademic: COURSE_CODE.test(code.toUpperCase()) || COURSE_CODE.test(name.toUpperCase()),
    });
  }
  return out;
};

const measure = async (
  fetcher: Fetcher,
  label: string,
  path: string,
  showBody = false,
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
      bodyPreview: showBody ? preview(json) : '',
      note: describeShape(json),
    };
  }

  const e = result.error;
  const detail =
    e.kind === 'http' && e.body !== undefined ? `${e.message}\nserver said: ${e.body}` : e.message;

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
    note: detail,
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
