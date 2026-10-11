import { describe, it, expect } from 'vitest';
import { syncCourse } from '@sync/courseSync';
import { fakeFetcher } from '@test/doubles/fakeFetcher';
import type { Course, TaskItem } from '@core/types';

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
  ['/discussions/forums/', { json: [] }],
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

  it('never lets a refused course grade stop the course, even if it looks like a sign-out', async () => {
    const fetcher = fakeFetcher([
      ['/1234/calendar/events/', { json: [] }],
      [
        '/grades/final/values/myGradeValue',
        { error: { kind: 'auth-redirect', finalUrl: 'x', message: 'looked like sign-in' } },
      ],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.courseGrade).toBeNull();
    expect(res.value.grades?.length).toBe(1);
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

describe('syncCourse: discussions', () => {
  const topics = [
    {
      ForumId: 12,
      TopicId: 456,
      Name: 'The Stanley Parable and Professionalism',
      StartDate: '2026-10-05T04:00:00.000Z',
      EndDate: '2026-10-14T03:59:00.000Z',
      DueDate: '2026-10-14T03:59:00.000Z',
    },
    { ForumId: 12, TopicId: 457, Name: 'Questions for the TA', DueDate: null, EndDate: null },
  ];
 const discussionRoutes = [
    ['/1234/discussions/forums/12/topics/456/posts/', { json: [{ PostingUserId: 777 }] }],
    ['/1234/discussions/forums/12/topics/', { json: topics }],
    ['/1234/discussions/forums/', { json: [{ ForumId: 12, Name: 'Graded discussions' }] }],
   ['/grades/final/values/myGradeValue', { json: gradeValue }],
    ['/1234/calendar/events/', { json: [] }],
  ] as const;

  it('lists a dated discussion alongside assignments, skipping topics with no deadline', async () => {
    const fetcher = fakeFetcher([...discussionRoutes, ...base]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW, [], '999');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const titles = res.value.items.map((i) => i.title);
    expect(titles).toContain('The Stanley Parable and Professionalism');
    expect(titles).not.toContain('Questions for the TA');
    expect(res.value.partialFailures).toEqual([]);

    const post = res.value.items.find((i) => i.kind === 'discussion');
    expect(post?.dueAt).toBe(Date.UTC(2026, 9, 14, 3, 59));
    expect(post?.learnCompleted).toBe(false);
  });

  it('ticks a discussion off when the student has posted in it', async () => {
    const fetcher = fakeFetcher([...discussionRoutes, ...base]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW, [], '777');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const post = res.value.items.find((i) => i.kind === 'discussion');
    expect(post?.learnCompleted).toBe(true);
    expect(post?.learnCompletionEvidence).toBe('submission');
  });

  it('does not ask about posts without a user id to compare against', async () => {
    const fetcher = fakeFetcher([...discussionRoutes, ...base]);
    await syncCourse(fetcher, COURSE, '1.82', NOW, []);
    expect(fetcher.calls.some((c) => c.includes('/posts/'))).toBe(false);
  });

  it('keeps the rest of the course when discussions will not load', async () => {
    const refused = { error: { kind: 'http', status: 500, url: 'x', message: 'down' } } as const;
    const fetcher = fakeFetcher([
      ['/1234/discussions/forums/', refused],
      ['/grades/final/values/myGradeValue', { json: gradeValue }],
      ['/1234/calendar/events/', { json: [] }],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items.map((i) => i.title)).toEqual(['Assignment 1']);
    expect(res.value.partialFailures).toEqual(['discussions']);
  });

  it('treats a 403 on the forum list as the tool being off, not a failure', async () => {
    const off = { error: { kind: 'http', status: 403, url: 'x', message: 'Forbidden' } } as const;
    const fetcher = fakeFetcher([
      ['/1234/discussions/forums/', off],
      ['/grades/final/values/myGradeValue', { json: gradeValue }],
      ['/1234/calendar/events/', { json: [] }],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok && res.value.partialFailures).toEqual([]);
  });

  it('stops on a sign-out while reading a forum, like every other route', async () => {
    const fetcher = fakeFetcher([
      ['/1234/discussions/forums/12/topics/', { error: { kind: 'auth-redirect', finalUrl: 'https://adfs.example', message: 'signed out' } }],
      ['/1234/discussions/forums/', { json: [{ ForumId: 12 }] }],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe('auth-redirect');
  });

  it(`keeps one forum's topics when another forum refuses`, async () => {
    const fetcher = fakeFetcher([
      ['/1234/discussions/forums/12/topics/', { json: topics }],
      ['/1234/discussions/forums/13/topics/', { error: { kind: 'http', status: 500, url: 'x', message: 'down' } }],
      ['/1234/discussions/forums/', { json: [{ ForumId: 12 }, { ForumId: 13 }, null] }],
      ['/grades/final/values/myGradeValue', { json: gradeValue }],
      ['/1234/calendar/events/', { json: [] }],
      ...base,
    ]);
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.items.some((i) => i.kind === 'discussion')).toBe(true);
    expect(res.value.partialFailures).toEqual(['discussions']);
  });

  it('carries a discussion already seen as done without asking again', async () => {
    const fetcher = fakeFetcher([...discussionRoutes, ...base]);
    const known = [{ id: 'learn:1234:discussion:12/456', learnCompleted: true }] as unknown as readonly TaskItem[];
    const res = await syncCourse(fetcher, COURSE, '1.82', NOW, known, '999');
    expect(res.ok && res.value.items.find((i) => i.kind === 'discussion')?.learnCompleted).toBe(true);
    expect(fetcher.calls.some((c) => c.includes('/posts/'))).toBe(false);
  });
});
