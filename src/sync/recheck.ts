/**
 * Re-checking one course right after the student hands something in.
 *
 * A full sync runs every half hour, so work submitted a minute ago would
 * otherwise sit on the list as "due tomorrow" for up to thirty minutes. When
 * a LEARN assignment or quiz page loads (which is where LEARN lands after a
 * submission), the content script asks for this instead: only the course in
 * question, and only its items that are not yet done.
 *
 * Read-only and quiet: an answer LEARN will not give leaves the item as it
 * was, because showing an unticked box is the safe direction to be wrong in.
 */

import type { TaskItem } from '@core/types';
import {
  folderListPath,
  hasAnySubmission,
  parseQuizAttempts,
  parseSubmittedFolders,
  quizListPath,
  withSubmission,
} from '@core/normalize/quiz';
import { readItemsFor, writeItemsFor } from '@storage/store';
import { MAX_CONCURRENT_PER_COURSE } from '@shared/constants';
import type { Fetcher } from './fetchProxy';

/** One look per course per this long, however many LEARN pages load. */
export const RECHECK_MIN_INTERVAL_MS = 30_000;

/** Only work due recently or still ahead is worth asking about. */
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

const lastRun = new Map<string, number>();

/** True when this course was re-checked too recently to ask again. */
export const recheckThrottled = (courseId: string, now: number): boolean => {
  const at = lastRun.get(courseId);
  return at !== undefined && now - at < RECHECK_MIN_INTERVAL_MS;
};

export const recheckCourse = async (
  fetcher: Fetcher,
  courseId: string,
  le: string,
  now: number,
): Promise<number> => {
  if (recheckThrottled(courseId, now)) return 0;
  lastRun.set(courseId, now);

  const items = await readItemsFor(courseId);
  const updated = await checkItems(fetcher, courseId, le, items, now);

  const changed = updated.filter((u, i) => u.learnCompleted !== items[i]?.learnCompleted).length;
  if (changed > 0) await writeItemsFor(courseId, updated);
  return changed;
};

/** The items with any new submission evidence applied. */
export const checkItems = async (
  fetcher: Fetcher,
  courseId: string,
  le: string,
  items: readonly TaskItem[],
  now: number,
  lookbackMs: number = LOOKBACK_MS,
): Promise<readonly TaskItem[]> => {
  const open = (item: TaskItem): boolean => !item.learnCompleted && isWorthAsking(item, now, lookbackMs);

  // Every open quiz in the course is answered by one page, read only if needed.
  const anyOpenQuiz = items.some((i) => open(i) && i.sources[0]?.system === 'quiz');
  const attempts = anyOpenQuiz ? await readQuizAttempts(fetcher, courseId) : null;

  // Folders whose direct check LEARN refused (it does once a folder closes).
  const refused = new Set<string>();

  const checkOne = async (item: TaskItem): Promise<TaskItem> => {
      if (!open(item)) return item;

      const source = item.sources[0];
      if (source === undefined) return item;

      if (source.system === 'dropbox') {
        const res = await fetcher.getJson(
          `/d2l/api/le/${le}/${courseId}/dropbox/folders/${source.sourceId}/submissions/mysubmissions/`,
        );
        if (!res.ok) refused.add(item.id);
        return res.ok ? withSubmission(item, hasAnySubmission(res.value.json)) : item;
      }

      if (source.system === 'quiz' && attempts !== null) {
        return withSubmission(item, (attempts.get(source.sourceId) ?? 0) > 0);
      }

      return item;
  };

  // A few at a time: LEARN publishes no rate limits, so politeness is pacing.
  const firstPass: TaskItem[] = [];
  for (let i = 0; i < items.length; i += MAX_CONCURRENT_PER_COURSE) {
    firstPass.push(...(await Promise.all(items.slice(i, i + MAX_CONCURRENT_PER_COURSE).map(checkOne))));
  }

  if (refused.size === 0) return firstPass;

  // One read of the assignment list page answers every refused folder.
  const page = await fetcher.getText(folderListPath(courseId));
  if (!page.ok) return firstPass;
  const submitted = parseSubmittedFolders(page.value);

  return firstPass.map((item) =>
    refused.has(item.id) ? withSubmission(item, submitted.has(item.sources[0]?.sourceId ?? '')) : item,
  );
};

/** Attempts used per quiz in a course, or null when LEARN would not show the page. */
const readQuizAttempts = async (
  fetcher: Fetcher,
  courseId: string,
): Promise<ReadonlyMap<string, number> | null> => {
  const res = await fetcher.getText(quizListPath(courseId));
  return res.ok ? parseQuizAttempts(res.value) : null;
};

const isWorthAsking = (item: TaskItem, now: number, lookbackMs: number): boolean => {
  const due = item.dueAt ?? item.endsAt;
  return due === null || due > now - lookbackMs;
};
