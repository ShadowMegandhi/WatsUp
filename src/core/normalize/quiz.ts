/**
 * Quizzes to TaskItems.
 *
 * UW returned the paged envelope form, { Objects: [], Next: null }, which
 * asArray already handles.
 *
 * Quizzes carry three dates and they are not interchangeable. DueDate is the
 * deadline; EndDate is when the quiz closes and can no longer be attempted.
 * When only EndDate exists it is the real deadline, because missing it means
 * missing the quiz entirely.
 */

import { contentHash, learnId } from '../ids';
import { parseUtcDateTime } from '@shared/time';
import { asArray, asString, kindFromTitle, numericId } from './dropbox';
import type { SourceRef, TaskItem } from '../types';

interface RawQuiz {
  readonly QuizId?: unknown;
  readonly Id?: unknown;
  readonly Name?: unknown;
  readonly DueDate?: unknown;
  readonly StartDate?: unknown;
  readonly EndDate?: unknown;
  readonly IsActive?: unknown;
  readonly GradeItemId?: unknown;
}

export const deepLinkForQuiz = (learnOrigin: string, courseId: string, quizId: string): string =>
  `${learnOrigin}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${courseId}&qi=${quizId}`;

export const normalizeQuizzes = (
  json: unknown,
  courseId: string,
  learnOrigin: string,
  now: number,
): readonly TaskItem[] => {
  const out: TaskItem[] = [];

  for (const row of asArray(json)) {
    const quiz = row as RawQuiz;
    const id = numericId(quiz.QuizId ?? quiz.Id);
    if (id === null) continue;

    // A quiz the instructor has hidden is not something to chase.
    if (quiz.IsActive === false) continue;

    const title = typeof quiz.Name === 'string' && quiz.Name.trim() !== '' ? quiz.Name.trim() : `Quiz ${id}`;
    const dueAt = parseUtcDateTime(asString(quiz.DueDate));
    const endsAt = parseUtcDateTime(asString(quiz.EndDate));
    const url = deepLinkForQuiz(learnOrigin, courseId, id);

    const source: SourceRef = { system: 'quiz', sourceId: id, url, observedAt: now };

    out.push({
      id: learnId(courseId, 'quiz', id),
      courseId,
      title,
      kind: kindFromTitle(title, 'quiz'),
      dueAt,
      availableFrom: parseUtcDateTime(asString(quiz.StartDate)),
      endsAt,
      isAllDay: false,
      weightPct: null,
      url,
      sources: [source],
      gradeItemId: numericId(quiz.GradeItemId),
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: contentHash([title, dueAt, endsAt, 'quiz']),
      firstSeenAt: now,
      lastSyncedAt: now,
    });
  }

  return out;
};

/**
 * Applies submission evidence from a mysubmissions call.
 * Returns a new item; never mutates the input.
 */
export const withSubmission = (item: TaskItem, hasSubmission: boolean): TaskItem =>
  hasSubmission
    ? { ...item, learnCompleted: true, learnCompletionEvidence: 'submission' }
    : item;

/**
 * Reads a quiz attempts payload and reports whether any attempt was finished.
 *
 * Strict on purpose: an attempt that was opened but never submitted does not
 * count, so an attempt has to carry a completion stamp. Field names vary
 * between Brightspace versions, so the usual ones are all accepted; an
 * attempt carrying none of them is treated as not finished.
 */
export const hasFinishedAttempt = (json: unknown): boolean => {
  for (const row of asArray(json)) {
    if (row === null || typeof row !== 'object') continue;
    const attempt = row as Record<string, unknown>;
    for (const key of FINISHED_KEYS) {
      const v = attempt[key];
      if (v === true) return true;
      if (typeof v === 'string' && v.trim() !== '') return true;
      if (typeof v === 'number' && v > 0) return true;
    }
  }
  return false;
};

const FINISHED_KEYS: readonly string[] = [
  'Completed',
  'CompletedDate',
  'DateCompleted',
  'Submitted',
  'SubmittedDate',
  'SubmissionDate',
  'IsCompleted',
  'IsSubmitted',
];

/** Reads a mysubmissions payload and reports whether anything was handed in. */
export const hasAnySubmission = (json: unknown): boolean => {
  for (const row of asArray(json)) {
    const entity = row as { Submissions?: unknown; Status?: unknown };
    if (Array.isArray(entity.Submissions) && entity.Submissions.length > 0) return true;
  }
  return false;
};
