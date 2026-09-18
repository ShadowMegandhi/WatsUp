/**
 * Syncing one course.
 *
 * This is the isolation boundary. It returns a Result and never throws past
 * itself, so a single course that 403s, 404s or returns nonsense costs you
 * that course and nothing else.
 *
 * Endpoints degrade independently too. If quizzes fail but assignments
 * succeed, the course still commits what it got rather than discarding both.
 */

import { type Result, ok } from '@shared/result';
import { type AppError, isFatal } from '@shared/errors';
import { normalizeDropboxFolders } from '@core/normalize/dropbox';
import { normalizeQuizzes, hasAnySubmission, withSubmission } from '@core/normalize/quiz';
import { normalizeNews, type Announcement } from '@core/normalize/news';
import { LEARN_ORIGIN, MAX_CONCURRENT_PER_COURSE } from '@shared/constants';
import type { Course, TaskItem } from '@core/types';
import type { Fetcher } from './fetchProxy';

export interface CourseOutput {
  readonly courseId: string;
  readonly items: readonly TaskItem[];
  readonly news: readonly Announcement[];
  /** Endpoints that failed, for the health chip. Not fatal on their own. */
  readonly partialFailures: readonly string[];
}

export const syncCourse = async (
  fetcher: Fetcher,
  course: Course,
  le: string,
  now: number,
  known: readonly TaskItem[] = [],
): Promise<Result<CourseOutput, AppError>> => {
  const failures: string[] = [];

  const folders = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/dropbox/folders/`);
  if (!folders.ok && isFatal(folders.error)) return folders;

  const quizzes = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/quizzes/`);
  if (!quizzes.ok && isFatal(quizzes.error)) return quizzes;

  if (!folders.ok) failures.push('assignments');
  if (!quizzes.ok) failures.push('quizzes');

  const assignmentItems = folders.ok
    ? normalizeDropboxFolders(folders.value.json, course.id, LEARN_ORIGIN, now)
    : [];
  const quizItems = quizzes.ok
    ? normalizeQuizzes(quizzes.value.json, course.id, LEARN_ORIGIN, now)
    : [];

  const news = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/news/`);
  if (!news.ok && isFatal(news.error)) return news;
  if (!news.ok) failures.push('announcements');

  const withEvidence = await applySubmissionEvidence(fetcher, course.id, le, assignmentItems, known, now);

  return ok({
    courseId: course.id,
    items: [...withEvidence, ...quizItems],
    news: news.ok ? normalizeNews(news.value.json, course.id, LEARN_ORIGIN) : [],
    partialFailures: failures,
  });
};

/**
 * Asks LEARN what has already been handed in.
 *
 * One call per assignment folder, which is why it is capped and why only
 * assignments get it: quizzes would need an attempts call each and the cost
 * is not worth it for a first pass.
 *
 * A failure here is silent by design. Not knowing whether something was
 * submitted is very different from knowing it was not, and showing a student
 * an unticked box is the safe direction to be wrong in.
 */
const applySubmissionEvidence = async (
  fetcher: Fetcher,
  courseId: string,
  le: string,
  items: readonly TaskItem[],
  known: readonly TaskItem[],
  now: number,
): Promise<readonly TaskItem[]> => {
  const alreadyDone = new Set(known.filter((k) => k.learnCompleted).map((k) => k.id));
  const out: TaskItem[] = [];
  const toCheck: TaskItem[] = [];

  for (const item of items) {
    // A submission does not un-happen, so re-asking about something already
    // handed in is a request spent to learn nothing.
    if (alreadyDone.has(item.id)) {
      out.push({ ...item, learnCompleted: true, learnCompletionEvidence: 'submission' });
      continue;
    }

    // Long-past work is not worth a call every half hour either. It stays
    // visible and tickable by hand.
    const due = item.dueAt ?? item.endsAt;
    if (due !== null && now - due > STALE_AFTER_MS) {
      out.push(item);
      continue;
    }

    toCheck.push(item);
  }

  for (let i = 0; i < toCheck.length; i += MAX_CONCURRENT_PER_COURSE) {
    const batch = toCheck.slice(i, i + MAX_CONCURRENT_PER_COURSE);
    const checked = await Promise.all(
      batch.map(async (item) => {
        const folderId = item.sources[0]?.sourceId;
        if (folderId === undefined) return item;

        const res = await fetcher.getJson(
          `/d2l/api/le/${le}/${courseId}/dropbox/folders/${folderId}/submissions/mysubmissions/`,
        );
        if (!res.ok) return item;
        return withSubmission(item, hasAnySubmission(res.value.json));
      }),
    );
    out.push(...checked);
  }

  return out;
};

/** Past this, a deadline is history and not worth re-checking each sync. */
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
