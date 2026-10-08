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

/** The student's own quiz list page for a course, which shows attempts used. */
export const quizListPath = (courseId: string): string =>
  `/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${courseId}`;

/**
 * Attempts used per quiz, read from the student's quiz list page.
 *
 * The API route for a quiz's attempts answers students with 403 Not
 * Authorized (checked on UW LEARN, le 1.99), so the API cannot say whether a
 * quiz was done. The quiz list page the student sees can: each row links
 * GoToQuiz(<quizId>, ...) and ends in an attempts cell, "1 / 1" or
 * "2 / Unlimited". A row whose shape does not match is skipped, so an
 * unfamiliar page ticks nothing off rather than ticking off the wrong thing.
 */
export const parseQuizAttempts = (html: string): ReadonlyMap<string, number> => {
  const used = new Map<string, number>();

  for (const row of html.split(/<tr[\s>]/i).slice(1)) {
    const id = /GoToQuiz\(\s*(\d+)/.exec(row)?.[1];
    if (id === undefined) continue;

    const cell = /<label[^>]*>\s*(\d+)\s*<\/label>\s*<label[^>]*>\s*\/\s*(?:\d+|unlimited)\s*<\/label>/i.exec(row);
    if (cell === null) continue;

    used.set(id, Number(cell[1]));
  }

  return used;
};

/** The student's own assignment list page for a course. */
export const folderListPath = (courseId: string): string =>
  `/d2l/lms/dropbox/user/folders_list.d2l?ou=${courseId}`;

/**
 * Assignment folders with at least one submission, read from the student's
 * assignment list page.
 *
 * The fallback for folders whose mysubmissions route answers 403, which
 * LEARN does once a folder's availability window has closed. A submitted
 * folder's row still links its history, folders_history.d2l?db=<folderId>,
 * with text such as "1 Submission, 2 Files"; an unsubmitted one says
 * "Not Submitted" and carries no such link.
 */
export const parseSubmittedFolders = (html: string): ReadonlySet<string> => {
  const done = new Set<string>();
  const link = /folders_history\.d2l\?db=(\d+)[^>]*>\s*(\d+)\s+Submissions?\b/gi;
  for (let m = link.exec(html); m !== null; m = link.exec(html)) {
    if (Number(m[2]) > 0 && m[1] !== undefined) done.add(m[1]);
  }
  return done;
};

/** Reads a mysubmissions payload and reports whether anything was handed in. */
export const hasAnySubmission = (json: unknown): boolean => {
  for (const row of asArray(json)) {
    const entity = row as { Submissions?: unknown; Status?: unknown };
    if (Array.isArray(entity.Submissions) && entity.Submissions.length > 0) return true;
  }
  return false;
};
