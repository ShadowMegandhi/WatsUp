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

import { type Result, ok, err } from '@shared/result';
import { type AppError, isFatal } from '@shared/errors';
import { normalizeDropboxFolders } from '@core/normalize/dropbox';
import { normalizeQuizzes } from '@core/normalize/quiz';
import { normalizeNews, type Announcement } from '@core/normalize/news';
import { normalizeCalendarEvents } from '@core/normalize/calendar';
import { normalizeCourseGrade, normalizeGrades, withGradeEvidence } from '@core/normalize/grades';
import { checkItems } from './recheck';
import { LEARN_ORIGIN } from '@shared/constants';
import { addDays } from '@shared/time';
import type { Course, CourseGrade, GradeEntry, TaskItem } from '@core/types';
import type { Fetcher } from './fetchProxy';

export interface CourseOutput {
  readonly courseId: string;
  readonly items: readonly TaskItem[];
  readonly news: readonly Announcement[];
  /** Null when the marks endpoint failed, so stored marks are kept, not wiped. */
  readonly grades: readonly GradeEntry[] | null;
  /** Null when the instructor has not made the course grade visible. */
  readonly courseGrade: CourseGrade | null;
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

  const calendar = await fetchCalendar(fetcher, course.id, le, now);
  if (calendar.fatal !== null) return err(calendar.fatal);
  if (calendar.json === null) failures.push('calendar');
  const examItems =
    calendar.json === null ? [] : normalizeCalendarEvents(calendar.json, course.id, LEARN_ORIGIN, now);

  const gradeValues = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/grades/values/myGradeValues/`);
  if (!gradeValues.ok && isFatal(gradeValues.error)) return gradeValues;
  if (!gradeValues.ok) failures.push('marks');
  const grades = gradeValues.ok ? normalizeGrades(gradeValues.value.json, course.id, LEARN_ORIGIN) : null;

  // A hidden course grade answers with an error, in whatever shape LEARN
  // chooses. That is the instructor's choice, so no failure here can stop the
  // course or claim the student is signed out. Only rate limiting still
  // halts, because ignoring it would keep hammering LEARN.
  const finalValue = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/grades/final/values/myGradeValue`);
  if (!finalValue.ok && finalValue.error.kind === 'rate-limited') return finalValue;
  const courseGrade = finalValue.ok ? normalizeCourseGrade(finalValue.value.json, course.id) : null;

  // Submissions do not un-happen, so work already seen as done carries over
  // without asking again. Everything else open is checked the same way the
  // instant re-check after a Submit does: assignments directly (falling back
  // to the assignment list once a folder closes), quizzes from the quiz list.
  const doneBefore = new Set(known.filter((k) => k.learnCompleted).map((k) => k.id));
  const carried = [...assignmentItems, ...quizItems].map((i) =>
    doneBefore.has(i.id) ? { ...i, learnCompleted: true, learnCompletionEvidence: 'submission' as const } : i,
  );
  const withEvidence = await checkItems(fetcher, course.id, le, carried, now, STALE_AFTER_MS);

  return ok({
    courseId: course.id,
    items: [...withGradeEvidence(withEvidence, grades ?? []), ...examItems],
    news: news.ok ? normalizeNews(news.value.json, course.id, LEARN_ORIGIN) : [],
    grades,
    courseGrade,
    partialFailures: failures,
  });
};

/**
 * Reads the course calendar, trying the documented per-course form first.
 *
 * The first real probe saw HTTP 400 on the cross-course myEvents form, so
 * this stays per course and falls back to the dated myEvents shape only if
 * the plain one is refused. A refusal of both just means no calendar exams.
 */
const fetchCalendar = async (
  fetcher: Fetcher,
  courseId: string,
  le: string,
  now: number,
): Promise<{ json: unknown; fatal: AppError | null }> => {
  const stamp = (at: number) => encodeURIComponent(`${new Date(at).toISOString().slice(0, 19)}Z`);
  const shapes = [
    `/d2l/api/le/${le}/${courseId}/calendar/events/`,
    `/d2l/api/le/${le}/${courseId}/calendar/events/myEvents/?startDateTime=${stamp(addDays(now, -30))}&endDateTime=${stamp(addDays(now, CALENDAR_DAYS_AHEAD))}`,
  ];

  for (const path of shapes) {
    const res = await fetcher.getJson(path);
    if (res.ok) return { json: res.value.json, fatal: null };
    if (isFatal(res.error)) return { json: null, fatal: res.error };
  }
  return { json: null, fatal: null };
};

/** Far enough to cover a whole term including the final exam period. */
const CALENDAR_DAYS_AHEAD = 150;

/** Past this, a deadline is history and not worth re-checking each sync. */
const STALE_AFTER_MS = 45 * 24 * 60 * 60 * 1000;
