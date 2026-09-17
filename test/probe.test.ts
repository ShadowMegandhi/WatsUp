import { describe, it, expect } from 'vitest';
import { runProbe, parseCourses } from '@sync/probe';
import { fakeFetcher, versionsPayload } from '@test/doubles/fakeFetcher';

const NOW = Date.UTC(2026, 8, 17);

/** Shaped like the real UW payload: community shells alongside real courses. */
const realisticEnrollments = {
  PagingInfo: { Bookmark: '100013', HasMoreItems: false },
  Items: [
    {
      OrgUnit: { Id: 100001, Type: { Id: 3 }, Name: 'Engineering Co-op Community', Code: 'Engineering Co-op Community' },
      Access: { IsActive: true },
    },
    {
      OrgUnit: { Id: 100002, Type: { Id: 3 }, Name: 'Residence Experience', Code: 'Residence Experience' },
      Access: { IsActive: true },
    },
    {
      OrgUnit: { Id: 1201234, Type: { Id: 3 }, Name: 'ECE 106 - Electricity and Magnetism', Code: 'ECE106_F26' },
      Access: { IsActive: true },
    },
  ],
};

const okRoutes = [
  ['/d2l/api/versions/', { json: versionsPayload }],
  ['enrollments/myenrollments', { json: realisticEnrollments }],
  ['calendar/events/myEvents', { json: [] }],
  ['grades/', { json: [] }],
  ['dropbox/folders', { json: [] }],
  ['quizzes/', { json: { Objects: [], Next: null } }],
  ['content/toc', { json: { Modules: [] } }],
  ['news/', { json: [] }],
] as const;

describe('parseCourses', () => {
  it('reads ids and names out of the enrolments payload', () => {
    const courses = parseCourses(realisticEnrollments);
    expect(courses).toHaveLength(3);
    expect(courses[0]?.id).toBe('100001');
  });

  it('tells a real course apart from a community shell', () => {
    const courses = parseCourses(realisticEnrollments);
    const academic = courses.filter((c) => c.looksAcademic);
    expect(academic).toHaveLength(1);
    expect(academic[0]?.code).toBe('ECE106_F26');
  });

  it('matches a course code with or without a space', () => {
    const tight = parseCourses(wrap({ Id: 111222, Name: 'Algebra', Code: 'MATH135' }));
    expect(tight[0]?.looksAcademic).toBe(true);

    const spaced = parseCourses(wrap({ Id: 111222, Name: 'MATH 135 Algebra', Code: 'x' }));
    expect(spaced[0]?.looksAcademic).toBe(true);
  });

  it('does not mistake a community shell for a course', () => {
    const shell = parseCourses(wrap({ Id: 100001, Name: 'Residence Experience', Code: 'Residence Experience' }));
    expect(shell[0]?.looksAcademic).toBe(false);
  });

  it('survives malformed entries without throwing', () => {
    expect(parseCourses({ Items: [null, {}, { OrgUnit: {} }] })).toEqual([]);
  });

  it('returns nothing when the payload is not paged', () => {
    expect(parseCourses({ nope: true })).toEqual([]);
  });
});

const wrap = (orgUnit: Record<string, unknown>) => ({
  Items: [{ OrgUnit: orgUnit, Access: { IsActive: true } }],
});

describe('runProbe', () => {
  it('prefers a real course over a community shell for per-course checks', async () => {
    const fetcher = fakeFetcher(okRoutes);
    await runProbe(fetcher, NOW);

    expect(fetcher.calls.some((c) => c.includes('/1201234/dropbox/folders/'))).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('/100001/dropbox/folders/'))).toBe(false);
  });

  it('uses the discovered versions rather than the fallbacks', async () => {
    const fetcher = fakeFetcher(okRoutes);
    await runProbe(fetcher, NOW);
    expect(fetcher.calls.some((c) => c.includes('/d2l/api/lp/1.49/'))).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('1.44'))).toBe(false);
  });

  it('stops trying calendar shapes as soon as one is accepted', async () => {
    const fetcher = fakeFetcher(okRoutes);
    await runProbe(fetcher, NOW);
    const calendarCalls = fetcher.calls.filter((c) => c.includes('myEvents'));
    expect(calendarCalls).toHaveLength(1);
  });

  it('works through the calendar shapes until one is accepted', async () => {
    const fetcher = fakeFetcher([
      ['/d2l/api/versions/', { json: versionsPayload }],
      ['enrollments/myenrollments', { json: realisticEnrollments }],
      [
        'myEvents/?startDateTime=2026-08-18T00',
        { error: { kind: 'http', status: 400, url: 'x', message: 'bad', body: 'Invalid date' } },
      ],
      ['myEvents', { json: [] }],
      ['grades/', { json: [] }],
      ['dropbox/folders', { json: [] }],
      ['quizzes/', { json: { Objects: [] } }],
      ['content/toc', { json: {} }],
      ['news/', { json: [] }],
    ]);

    const report = await runProbe(fetcher, NOW);
    const calendarSteps = report.steps.filter((s) => s.label.includes('calendar:'));
    expect(calendarSteps.length).toBeGreaterThan(1);
    expect(calendarSteps.at(-1)?.outcome).toBe('ok');
  });

  it('surfaces what the server said about a 400 instead of swallowing it', async () => {
    const fetcher = fakeFetcher([
      ['/d2l/api/versions/', { json: versionsPayload }],
      ['enrollments/myenrollments', { json: realisticEnrollments }],
      [
        'myEvents',
        { error: { kind: 'http', status: 400, url: 'x', message: 'HTTP 400', body: 'orgUnitIdsCSV is required' } },
      ],
      ['grades/', { json: [] }],
      ['dropbox/folders', { json: [] }],
      ['quizzes/', { json: {} }],
      ['content/toc', { json: {} }],
      ['news/', { json: [] }],
    ]);

    const report = await runProbe(fetcher, NOW);
    const failed = report.steps.find((s) => s.label.includes('calendar:'));
    expect(failed?.note).toContain('orgUnitIdsCSV is required');
  });

  it('records plainly when no rate-limit headers are present', async () => {
    const report = await runProbe(fakeFetcher(okRoutes), NOW);
    const rl = report.steps.find((s) => s.label === 'Rate limiting');
    expect(rl?.note).toContain('No rate-limit headers');
  });

  it('records when rate-limit headers are available', async () => {
    const withHeaders = [
      ['/d2l/api/versions/', { json: versionsPayload, headers: { 'X-Rate-Limit-Remaining': '90' } }],
      ...okRoutes.slice(1),
    ] as const;

    const report = await runProbe(fakeFetcher(withHeaders), NOW);
    const rl = report.steps.find((s) => s.label === 'Rate limiting');
    expect(rl?.note).toContain('can drive the budget');
  });

  it('stops immediately on an auth redirect', async () => {
    const fetcher = fakeFetcher([
      [
        '/d2l/api/versions/',
        { error: { kind: 'auth-redirect', finalUrl: 'https://adfs.uwaterloo.ca/adfs/ls/', message: 'expired' } },
      ],
    ]);

    const report = await runProbe(fetcher, NOW);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]?.outcome).toBe('auth-redirect');
    expect(fetcher.calls).toHaveLength(1);
  });

  it('lists every enrolment so a missing course is visible', async () => {
    const report = await runProbe(fakeFetcher(okRoutes), NOW);
    const summary = report.steps.find((s) => s.label.includes('Found 3 enrolments'));
    expect(summary?.note).toContain('Residence Experience');
    expect(summary?.note).toContain('[course]');
  });
});
