import { describe, it, expect } from 'vitest';
import { runProbe, firstOrgUnitId } from '@sync/probe';
import { fakeFetcher, versionsPayload, enrollmentsPayload } from '@test/doubles/fakeFetcher';

const NOW = Date.UTC(2026, 8, 16);

const happyRoutes = [
  ['/d2l/api/versions/', { json: versionsPayload, headers: { 'X-Rate-Limit-Remaining': '95', 'X-Request-Cost': '1' } }],
  ['enrollments/myenrollments', { json: enrollmentsPayload, headers: { 'X-Rate-Limit-Remaining': '92' } }],
  ['calendar/events/myEvents', { json: [{ CalendarEventId: 1, Title: 'A1 due' }] }],
  ['dropbox/folders', { json: [{ Id: 44881, Name: 'Assignment 1', DueDate: '2026-09-30T03:59:00.000Z' }] }],
  ['quizzes/', { json: { Objects: [{ QuizId: 77, Name: 'Quiz 1' }] } }],
  ['grades/final/values/myGradeValues', { json: [] }],
] as const;

describe('runProbe', () => {
  it('walks the full endpoint chain when everything works', async () => {
    const fetcher = fakeFetcher(happyRoutes);
    const report = await runProbe(fetcher, NOW);

    expect(report.tier).toBe('content');
    expect(report.steps.every((s) => s.outcome === 'ok')).toBe(true);

    const labels = report.steps.map((s) => s.label);
    expect(labels[0]).toBe('API version discovery');
    expect(labels.some((l) => l.includes('enrollments'))).toBe(true);
    expect(labels.some((l) => l.includes('Calendar events'))).toBe(true);
    expect(labels.some((l) => l.includes('Assignment folders'))).toBe(true);
    expect(labels.some((l) => l.includes('Final grades'))).toBe(true);
  });

  it('uses the discovered API versions in later paths, not the fallbacks', async () => {
    const fetcher = fakeFetcher(happyRoutes);
    await runProbe(fetcher, NOW);

    expect(fetcher.calls.some((c) => c.includes('/d2l/api/lp/1.49/'))).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('/d2l/api/le/1.82/'))).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('1.44'))).toBe(false);
  });

  it('captures rate-limit headers so we can see the real budget', async () => {
    const report = await runProbe(fakeFetcher(happyRoutes), NOW);
    const first = report.steps[0];
    expect(first?.rateLimit.remaining).toBe('95');
    expect(first?.rateLimit.cost).toBe('1');
  });

  it('stops immediately on an auth redirect instead of repeating the failure', async () => {
    const fetcher = fakeFetcher([
      [
        '/d2l/api/versions/',
        { error: { kind: 'auth-redirect', finalUrl: 'https://adfs.uwaterloo.ca/adfs/ls/', message: 'expired' } },
      ],
    ]);

    const report = await runProbe(fetcher, NOW);

    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]?.outcome).toBe('auth-redirect');
    expect(report.steps[0]?.finalUrl).toContain('adfs');
    expect(fetcher.calls).toHaveLength(1);
  });

  it('falls back to known-good versions when discovery returns nothing usable', async () => {
    const fetcher = fakeFetcher([
      ['/d2l/api/versions/', { json: { unexpected: true } }],
      ['enrollments/myenrollments', { json: enrollmentsPayload }],
      ['calendar/events/myEvents', { json: [] }],
      ['dropbox/folders', { json: [] }],
      ['quizzes/', { json: [] }],
      ['grades/final', { json: [] }],
    ]);

    await runProbe(fetcher, NOW);
    expect(fetcher.calls.some((c) => c.includes('/d2l/api/lp/1.44/'))).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('/d2l/api/le/1.67/'))).toBe(true);
  });

  it('keeps going when one course endpoint fails, rather than aborting the run', async () => {
    const fetcher = fakeFetcher([
      ['/d2l/api/versions/', { json: versionsPayload }],
      ['enrollments/myenrollments', { json: enrollmentsPayload }],
      ['calendar/events/myEvents', { json: [] }],
      ['dropbox/folders', { error: { kind: 'http', status: 403, url: 'x', message: 'forbidden' } }],
      ['quizzes/', { json: [] }],
      ['grades/final', { json: [] }],
    ]);

    const report = await runProbe(fetcher, NOW);
    const dropbox = report.steps.find((s) => s.label.includes('Assignment folders'));
    const quizzes = report.steps.find((s) => s.label.includes('Quizzes'));

    expect(dropbox?.outcome).toBe('http-error');
    expect(dropbox?.status).toBe(403);
    expect(quizzes?.outcome).toBe('ok');
  });

  it('notes clearly when no course id could be found instead of failing silently', async () => {
    const fetcher = fakeFetcher([
      ['/d2l/api/versions/', { json: versionsPayload }],
      ['enrollments/myenrollments', { json: { Items: [] } }],
      ['calendar/events/myEvents', { json: [] }],
    ]);

    const report = await runProbe(fetcher, NOW);
    const skipped = report.steps.find((s) => s.label.includes('skipped'));
    expect(skipped?.note).toContain('org unit id');
  });

  it('requests a calendar window around today', async () => {
    const fetcher = fakeFetcher(happyRoutes);
    await runProbe(fetcher, NOW);

    const call = fetcher.calls.find((c) => c.includes('myEvents'));
    expect(call).toContain('startDateTime=');
    expect(call).toContain('endDateTime=');
    expect(decodeURIComponent(call ?? '')).toContain('2026-08-17');
  });
});

describe('firstOrgUnitId', () => {
  it('finds a numeric identifier in a JSON preview', () => {
    expect(firstOrgUnitId('{ "Identifier": "912345" }')).toBe('912345');
  });

  it('accepts an unquoted identifier', () => {
    expect(firstOrgUnitId('{ "Identifier": 912345 }')).toBe('912345');
  });

  it('returns null when there is nothing to find', () => {
    expect(firstOrgUnitId('{ "Items": [] }')).toBeNull();
  });

  it('ignores short numbers that cannot be org unit ids', () => {
    expect(firstOrgUnitId('{ "Identifier": "12" }')).toBeNull();
  });
});
