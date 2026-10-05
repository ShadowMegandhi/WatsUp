/**
 * Returned marks.
 *
 * Read from the student's own grade values, which LEARN only reports once an
 * instructor has released them. Nothing here works a mark out: a percentage
 * appears only when LEARN gives the points or prints the percentage itself.
 */

import { parseUtcDateTime } from '@shared/time';
import { asArray, asString, numericId } from './dropbox';
import type { CourseGrade, GradeEntry, TaskItem } from '../types';

interface RawGradeValue {
  readonly GradeObjectIdentifier?: unknown;
  readonly GradeObjectName?: unknown;
  readonly GradeObjectType?: unknown;
  readonly DisplayedGrade?: unknown;
  readonly PointsNumerator?: unknown;
  readonly PointsDenominator?: unknown;
  readonly ReleasedDate?: unknown;
  readonly LastModified?: unknown;
}

/**
 * D2L grade object types that are not individual marks. Categories are
 * subtotals, and the two final types are the course grade, read separately.
 */
const NOT_AN_ITEM = new Set([7, 8, 9]);

/**
 * The course's My Grades page. LEARN has no page for a single grade item, so
 * this is where a mark and its feedback are actually shown. Confirm it in a
 * browser after changing it: a guessed LEARN path once led to an error page.
 */
const linkFor = (learnOrigin: string, courseId: string): string =>
  `${learnOrigin}/d2l/lms/grades/my_grades/main.d2l?ou=${courseId}`;

export const normalizeGrades = (
  json: unknown,
  courseId: string,
  learnOrigin: string,
): readonly GradeEntry[] => {
  const out: GradeEntry[] = [];

  for (const row of asArray(json)) {
    const raw = row as RawGradeValue;
    const gradeItemId = numericId(raw.GradeObjectIdentifier);
    if (gradeItemId === null) continue;
    if (typeof raw.GradeObjectType === 'number' && NOT_AN_ITEM.has(raw.GradeObjectType)) continue;

    const read = readValue(raw);
    if (read === null) continue;

    const name =
      typeof raw.GradeObjectName === 'string' && raw.GradeObjectName.trim() !== ''
        ? raw.GradeObjectName.trim()
        : 'Grade item';

    out.push({
      id: `grade:${courseId}:${gradeItemId}`,
      courseId,
      gradeItemId,
      name,
      ...read,
      returnedAt:
        parseUtcDateTime(asString(raw.ReleasedDate)) ??
        parseUtcDateTime(asString(raw.LastModified)),
      url: linkFor(learnOrigin, courseId),
    });
  }

  return out.sort((a, b) => (b.returnedAt ?? 0) - (a.returnedAt ?? 0));
};

/**
 * The course grade. Null when the instructor has hidden it, which LEARN
 * signals with an error status or an empty value rather than a zero.
 */
export const normalizeCourseGrade = (json: unknown, courseId: string): CourseGrade | null => {
  if (json === null || typeof json !== 'object') return null;
  const raw = json as RawGradeValue;

  const read = readValue(raw);
  if (read === null) return null;

  return {
    courseId,
    pct: read.pct,
    displayed: read.displayed,
    updatedAt:
      parseUtcDateTime(asString(raw.LastModified)) ??
      parseUtcDateTime(asString(raw.ReleasedDate)),
  };
};

/**
 * Marks a dropbox or quiz item done when LEARN has returned a grade for it.
 * A mark is the plainest evidence that the work was handed in.
 */
export const withGradeEvidence = (
  items: readonly TaskItem[],
  grades: readonly GradeEntry[],
): readonly TaskItem[] => {
  const byId = new Set(grades.map((g) => g.gradeItemId));
  const byName = new Set(grades.map((g) => g.name.toLowerCase()));

  return items.map((item) => {
    if (item.learnCompleted) return item;
    // The name is only a fallback. An item LEARN linked to a grade item is
    // judged by that link alone, so a namesake elsewhere cannot tick it.
    const linked =
      item.gradeItemId != null
        ? byId.has(item.gradeItemId)
        : byName.has(item.title.toLowerCase());
    return linked ? { ...item, learnCompleted: true, learnCompletionEvidence: 'grade' } : item;
  });
};

const readValue = (
  raw: RawGradeValue,
): Pick<GradeEntry, 'points' | 'outOf' | 'pct' | 'displayed'> | null => {
  const points = finite(raw.PointsNumerator);
  const outOf = finite(raw.PointsDenominator);
  const displayed = typeof raw.DisplayedGrade === 'string' ? raw.DisplayedGrade.trim() : '';

  // No points and nothing displayed means nothing has been returned.
  if (points === null && displayed === '') return null;

  const pct =
    points !== null && outOf !== null && outOf > 0
      ? round1((points / outOf) * 100)
      : percentIn(displayed);

  return {
    points,
    outOf,
    pct,
    displayed: displayed !== '' ? displayed : `${points} / ${outOf ?? '?'}`,
  };
};

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const percentIn = (text: string): number | null => {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(text);
  return m === null ? null : Number(m[1]);
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
