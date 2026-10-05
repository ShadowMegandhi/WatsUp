import { describe, it, expect } from 'vitest';
import { syncCourse } from '@sync/courseSync';
import { fakeFetcher } from '@test/doubles/fakeFetcher';
import type { Course } from '@core/types';

const COURSE: Course = {
  id: '1234',
  name: 'MATH 135',
  code: 'MATH135',
  looksAcademic: true,
  url: 'https://learn.uwaterloo.ca/d2l/home/1234',
};
const NOW = Date.UTC(2026, 9, 1);

const midterm = {
  CalendarEventId: 501,
  Title: 'Midterm',
  StartDateTime: '2026-10-23T23:00:00.000Z',
  AssociatedEntity: null,
};

const gradeValue = {
  GradeObjectIdentifier: '77',
  GradeObjectName: 'Assignment 1',
  GradeObjectType: 1,
  DisplayedGrade: '18 / 20',
  PointsNumerator: 18,
  PointsDenominator: 20,
  ReleasedDate: '2026-09-30T00:00:00.000Z',
};

const base = [
  ['/dropbox/folders/', { json: [{ Id: 10, Name: 'Assignment 1', GradeItemId: 77, DueDate: '2026-09-25T03:59:00.000Z' }] }],
  ['/quizzes/', { json: { Objects: [], Next: null } }],
  ['/news/', { json: [] }],
  ['/grades/values/myGradeValues/', { json: [gradeValue] }],
] as const;

describe('syncCourse', () => {
  it('collects calendar exams, marks and the course grade alongside the work', async () => {
    const fetcher = fakeFetcher([
      ['/1234/calendar/events/', { json: [midterm] }],
      ['/grades/final/values/myGradeValue', { json: { ...gradeValue, GradeObjectType: 7, DisplayedGrade: '90 %' } }],
      ...base,
    ]);

    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const exam = res.value.items.find((i) => i.sources[0]?.system === 'calendar');
    expect(exam?.title).toBe('Midterm');
    expect(res.value.grades?.map((g) => g.name)).toEqual(['Assignment 1']);
    expect(res.value.courseGrade?.pct).toBe(90);

    // The returned mark is evidence the assignment was handed in.
    const a1 = res.value.items.find((i) => i.title === 'Assignment 1');
    expect(a1?.learnCompleted).toBe(true);
    expect(res.value.partialFailures).toEqual([]);
  });

  it('treats a hidden course grade as hidden, not as a failure', async () => {
    const fetcher = fakeFetcher([['/1234/calendar/events/', { json: [] }], ...base]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok && res.value.courseGrade).toBeNull();
    expect(res.ok && res.value.partialFailures).toEqual([]);
  });

  it('falls back to the dated calendar shape when the plain one is refused', async () => {
    const fetcher = fakeFetcher([
      ['/1234/calendar/events/myEvents/', { json: [midterm] }],
      ['/1234/calendar/events/', { error: { kind: 'http', status: 400, url: 'x', message: 'bad request' } }],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok && res.value.items.some((i) => i.sources[0]?.system === 'calendar')).toBe(true);
    expect(fetcher.calls.filter((c) => c.includes('calendar'))).toHaveLength(2);
  });

  it('returns null marks when the marks request fails, so stored marks are kept', async () => {
    const fetcher = fakeFetcher([
      ['/1234/calendar/events/', { json: [] }],
      ['/grades/values/myGradeValues/', { error: { kind: 'http', status: 500, url: 'x', message: 'server error' } }],
      ...base.filter(([m]) => m !== '/grades/values/myGradeValues/'),
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.grades).toBeNull();
    expect(res.value.partialFailures).toContain('marks');
  });

  it('reports the calendar as unavailable when every shape is refused, and keeps the rest', async () => {
    const fetcher = fakeFetcher([...base]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.partialFailures).toContain('calendar');
    expect(res.value.items.some((i) => i.title === 'Assignment 1')).toBe(true);
  });
});
