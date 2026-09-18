import { describe, it, expect } from 'vitest';
import { placeRecurring } from '@core/syllabus/placeRecurring';
import type { RecurringAssessment } from '@core/syllabus/recurring';
import type { DatedSession } from '@core/syllabus/sessions';

const NOW = new Date(2026, 8, 18).getTime();
const DOC = { topicId: '77', title: 'Course Outline', url: 'https://outline.uwaterloo.ca/x' };

const series: RecurringAssessment = {
  title: 'Tutorial Assignment',
  kind: 'TUT',
  count: 9,
  weightPct: 20,
  sourceLine: 'Tutorial Assignments (best 7 of 9) 20%',
};

/** Fortnightly on purpose: a weekly estimate would place these wrongly. */
const tutorials: readonly DatedSession[] = [
  { courseCode: 'MATH 102', kind: 'TUT', startsAt: new Date(2026, 8, 18, 11, 30).getTime() },
  { courseCode: 'MATH 102', kind: 'TUT', startsAt: new Date(2026, 9, 2, 11, 30).getTime() },
  { courseCode: 'MATH 102', kind: 'TUT', startsAt: new Date(2026, 9, 16, 11, 30).getTime() },
];

describe('placeRecurring', () => {
  it('places one item per real session', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toHaveLength(3);
  });

  it('numbers them in order', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    expect(r.items.map((i) => i.title)).toEqual([
      'Tutorial Assignment 1',
      'Tutorial Assignment 2',
      'Tutorial Assignment 3',
    ]);
  });

  it('uses the real session dates, not an even spread', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    expect(new Date(r.items[2]?.dueAt ?? 0).getDate()).toBe(16);
    expect(new Date(r.items[2]?.dueAt ?? 0).getMonth()).toBe(9);
  });

  it('says plainly when more are listed than can be dated', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    expect(r.unplaced[0]).toContain('9 listed, only 3');
  });

  it('places nothing at all when no sessions are known', () => {
    // An even spread across the term would look plausible and be wrong, and a
    // plausible wrong deadline is worse than an absent one.
    const r = placeRecurring([series], [], '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toEqual([]);
    expect(r.unplaced[0]).toContain('no TUT dates are known');
  });

  it('ignores sessions belonging to another course', () => {
    const other = [{ courseCode: 'ECE 106', kind: 'TUT', startsAt: NOW }];
    const r = placeRecurring([series], other, '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toEqual([]);
  });

  it('ignores a different component of the same course', () => {
    const labs = [{ courseCode: 'MATH 102', kind: 'LAB', startsAt: NOW }];
    const r = placeRecurring([series], labs, '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toEqual([]);
  });

  it('matches a course code however it is spaced', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH102', DOC, NOW);
    expect(r.items).toHaveLength(3);
  });

  it('splits the stated weight across the series', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    // Twenty percent over nine assignments, not over the three that fit.
    expect(r.items[0]?.weightPct).toBeCloseTo(2.22, 2);
  });

  it('keeps the source line so the panel can show its working', () => {
    const r = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    expect(r.items[0]?.sources[0]?.detail?.rawLine).toContain('best 7 of 9');
  });

  it('gives stable ids so ticking one off survives a re-sync', () => {
    const a = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW);
    const b = placeRecurring([series], tutorials, '100007', 'MATH 102', DOC, NOW + 86_400_000);
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });

  it('never places more than the syllabus counted', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      courseCode: 'MATH 102',
      kind: 'TUT',
      startsAt: NOW + i * 604_800_000,
    }));
    const r = placeRecurring([series], many, '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toHaveLength(9);
  });
});

describe('matching LEARN course codes to Quest ones', () => {
  const sessions: readonly DatedSession[] = [
    { courseCode: 'MATH 102', kind: 'TUT', startsAt: new Date(2026, 8, 18, 11, 30).getTime() },
    { courseCode: 'MATH 102', kind: 'TUT', startsAt: new Date(2026, 8, 25, 11, 30).getTime() },
  ];

  const series: RecurringAssessment = {
    title: 'Tutorial Assignment',
    kind: 'TUT',
    count: 2,
    weightPct: null,
    sourceLine: 'Tutorial Assignments (best 1 of 2)',
  };

  it('matches the LEARN code that carries instructor and term', () => {
    // This is the real shape: LEARN says MATH102_instr_1269, Quest says
    // MATH 102. Comparing them with punctuation merely stripped never matched.
    const r = placeRecurring(
      [series],
      sessions,
      '100007',
      'MATH102_instr_1269',
      DOC,
      NOW,
    );
    expect(r.items).toHaveLength(2);
  });

  it('matches a bare code', () => {
    const r = placeRecurring([series], sessions, '100007', 'MATH 102', DOC, NOW);
    expect(r.items).toHaveLength(2);
  });

  it('still refuses a genuinely different course', () => {
    const r = placeRecurring([series], sessions, '100008', 'MATH101_instr_1269', DOC, NOW);
    expect(r.items).toEqual([]);
  });

  it('matches a course with a letter suffix', () => {
    const withSuffix = [{ courseCode: 'CS 136L', kind: 'TUT', startsAt: NOW }];
    const r = placeRecurring(
      [{ ...series, count: 1 }],
      withSuffix,
      '1',
      'CS136L_someone_1269',
      DOC,
      NOW,
    );
    expect(r.items).toHaveLength(1);
  });
});
