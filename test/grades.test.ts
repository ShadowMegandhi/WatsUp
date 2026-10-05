import { describe, it, expect } from 'vitest';
import { normalizeCourseGrade, normalizeGrades, withGradeEvidence } from '@core/normalize/grades';
import { normalizeDropboxFolders } from '@core/normalize/dropbox';

const ORIGIN = 'https://learn.uwaterloo.ca';

const value = (over: Record<string, unknown>) => ({
  GradeObjectIdentifier: '77',
  GradeObjectName: 'Assignment 1',
  GradeObjectType: 1,
  DisplayedGrade: '18 / 20',
  PointsNumerator: 18,
  PointsDenominator: 20,
  ReleasedDate: '2026-10-02T15:00:00.000Z',
  LastModified: '2026-10-01T15:00:00.000Z',
  ...over,
});

describe('normalizeGrades', () => {
  it('reads a returned mark exactly as LEARN shows it', () => {
    const [g] = normalizeGrades([value({})], '1234', ORIGIN);
    expect(g?.displayed).toBe('18 / 20');
    expect(g?.pct).toBe(90);
    expect(g?.gradeItemId).toBe('77');
    expect(g?.id).toBe('grade:1234:77');
    expect(g?.returnedAt).toBe(Date.UTC(2026, 9, 2, 15, 0));
  });

  it('falls back to the last-modified time when there is no release date', () => {
    const [g] = normalizeGrades([value({ ReleasedDate: null })], '1234', ORIGIN);
    expect(g?.returnedAt).toBe(Date.UTC(2026, 9, 1, 15, 0));
  });

  it('takes a percentage LEARN printed when there are no points', () => {
    const [g] = normalizeGrades(
      [value({ PointsNumerator: null, PointsDenominator: null, DisplayedGrade: '85 %' })],
      '1234',
      ORIGIN,
    );
    expect(g?.pct).toBe(85);
  });

  it('leaves the percentage empty rather than inventing one', () => {
    const [g] = normalizeGrades(
      [value({ PointsNumerator: null, PointsDenominator: null, DisplayedGrade: 'Pass' })],
      '1234',
      ORIGIN,
    );
    expect(g?.displayed).toBe('Pass');
    expect(g?.pct).toBeNull();
  });

  it('skips an item with nothing returned yet', () => {
    const items = normalizeGrades(
      [value({ PointsNumerator: null, DisplayedGrade: '' })],
      '1234',
      ORIGIN,
    );
    expect(items).toEqual([]);
  });

  it('skips categories and final grades, which are not individual marks', () => {
    const items = normalizeGrades(
      [value({ GradeObjectType: 9 }), value({ GradeObjectIdentifier: '78', GradeObjectType: 7 })],
      '1234',
      ORIGIN,
    );
    expect(items).toEqual([]);
  });

  it('lists the most recently returned first', () => {
    const items = normalizeGrades(
      [
        value({ GradeObjectIdentifier: '1', ReleasedDate: '2026-09-20T00:00:00.000Z' }),
        value({ GradeObjectIdentifier: '2', ReleasedDate: '2026-10-05T00:00:00.000Z' }),
      ],
      '1234',
      ORIGIN,
    );
    expect(items.map((g) => g.gradeItemId)).toEqual(['2', '1']);
  });
});

describe('normalizeCourseGrade', () => {
  it('reads a visible course grade', () => {
    const g = normalizeCourseGrade(
      value({ GradeObjectType: 7, DisplayedGrade: '82.5 %', PointsNumerator: 82.5, PointsDenominator: 100 }),
      '1234',
    );
    expect(g?.pct).toBe(82.5);
  });

  it('is null when there is nothing to show', () => {
    expect(normalizeCourseGrade(null, '1234')).toBeNull();
    expect(normalizeCourseGrade(value({ PointsNumerator: null, DisplayedGrade: '' }), '1234')).toBeNull();
  });
});

describe('withGradeEvidence', () => {
  const folders = normalizeDropboxFolders(
    [
      { Id: 10, Name: 'Assignment 1', GradeItemId: 77 },
      { Id: 11, Name: 'Assignment 2', GradeItemId: 88 },
    ],
    '1234',
    ORIGIN,
    0,
  );

  it('marks work done when its grade item has a returned mark', () => {
    const [a1, a2] = withGradeEvidence(folders, normalizeGrades([value({})], '1234', ORIGIN));
    expect(a1?.learnCompleted).toBe(true);
    expect(a1?.learnCompletionEvidence).toBe('grade');
    expect(a2?.learnCompleted).toBe(false);
  });

  it('matches on the exact name when LEARN gives no grade item link', () => {
    const unlinked = folders.map((f) => ({ ...f, gradeItemId: null }));
    const [a1] = withGradeEvidence(
      unlinked,
      normalizeGrades([value({ GradeObjectIdentifier: '999' })], '1234', ORIGIN),
    );
    expect(a1?.learnCompleted).toBe(true);
  });

  it('does not tick a linked item because a different grade item shares its name', () => {
    // Assignment 1 is linked to grade item 77; a released "Assignment 1" under
    // another id says nothing about it.
    const [a1] = withGradeEvidence(
      folders,
      normalizeGrades([value({ GradeObjectIdentifier: '999' })], '1234', ORIGIN),
    );
    expect(a1?.learnCompleted).toBe(false);
  });

  it('never overrides submission evidence', () => {
    const submitted = folders.map((f) => ({
      ...f,
      learnCompleted: true,
      learnCompletionEvidence: 'submission' as const,
    }));
    const [a1] = withGradeEvidence(submitted, normalizeGrades([value({})], '1234', ORIGIN));
    expect(a1?.learnCompletionEvidence).toBe('submission');
  });
});
