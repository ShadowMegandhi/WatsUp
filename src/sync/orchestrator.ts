/**
 * The sync run.
 *
 * Courses are walked strictly in sequence. UW LEARN returned no rate-limit
 * headers at all on the first real probe, so there is no budget to read and
 * politeness has to come from pacing instead: one course at a time, a small
 * cap on concurrent calls within a course, and a generous floor between runs.
 *
 * A failed course keeps whatever it had stored. A transient 500 must never
 * erase a student list of deadlines.
 */

import { type Result, ok, err } from '@shared/result';
import { type AppError, isFatal, userMessage } from '@shared/errors';
import { discoverVersions, fallbackVersions } from '@d2l/versions';
import { parseCourses } from './probe';
import { syncCourse } from './courseSync';
import { dedupeById } from '@core/dedupe';
import { LEXICON_VERSION } from '@core/syllabus/lexicon';
import { syncSyllabus } from './syllabusSync';
import { dropDuplicatesOfLearn } from '@core/syllabus/toItems';
import { LEARN_ORIGIN } from '@shared/constants';
import type { Course } from '@core/types';
import type { Fetcher } from './fetchProxy';
import {
  readItemsFor,
  writeItemsFor,
  writeCourses,
  writeHealth,
  readHealth,
  patchSyncState,
  writeApiVersions,
  readSeenIds,
  writeSeenIds,
  writeNewsFor,
  readAllNews,
  readSeenNewsIds,
  writeSeenNewsIds,
  readSyllabusCache,
  writeSyllabusCache,
  syllabusCacheIsFresh,
  readAllItems,
  writeMarksFor,
  readAllMarks,
  readSeenGradeIds,
  writeSeenGradeIds,
} from '@storage/store';

export interface SyncSummary {
  readonly coursesSynced: number;
  readonly coursesFailed: number;
  readonly itemCount: number;
  readonly newItemIds: readonly string[];
  readonly partial: boolean;
}

/** How long a parsed syllabus is trusted before being read again. */
const SYLLABUS_TTL_MS = 24 * 60 * 60 * 1000;

export const runSync = async (
  fetcher: Fetcher,
  now: number,
): Promise<Result<SyncSummary, AppError>> => {
  await patchSyncState({ running: true, lastRunAt: now });

  try {
    const versionResult = await discoverVersions(fetcher, now);
    if (!versionResult.ok && isFatal(versionResult.error)) {
      return await failRun(versionResult.error);
    }
    const versions = versionResult.ok ? versionResult.value : fallbackVersions(now);
    await writeApiVersions({ lp: versions.lp, le: versions.le, fetchedAt: now });

    const enrollments = await fetcher.getJson(
      `/d2l/api/lp/${versions.lp}/enrollments/myenrollments/?orgUnitTypeId=3&isActive=true`,
    );
    if (!enrollments.ok) return await failRun(enrollments.error);

    const courses = toCourses(parseCourses(enrollments.value.json));
    await writeCourses(courses);

    const previousIds = new Set(await readSeenIds());
    const isFirstEverSync = previousIds.size === 0;

    let synced = 0;
    let failed = 0;

    for (const course of courses) {
      const known = await readItemsFor(course.id);
      const result = await syncCourse(fetcher, course, versions.le, now, known);

      if (!result.ok) {
        // Only a genuinely global problem stops the whole run.
        if (isFatal(result.error)) return await failRun(result.error);

        failed += 1;
        const prior = await readHealth(course.id);
        await writeHealth({
          courseId: course.id,
          lastOkAt: prior?.lastOkAt ?? null,
          lastError: userMessage(result.error),
          consecutiveFailures: (prior?.consecutiveFailures ?? 0) + 1,
        });
        continue; // Stored items for this course are deliberately left alone.
      }

      const { items, news, grades, courseGrade, partialFailures } = result.value;
      await writeNewsFor(course.id, news);
      // A failed marks read keeps what was stored. One flaky request must not
      // empty a student's grade list until the next good sync.
      if (grades !== null) await writeMarksFor(course.id, { grades, courseGrade });

      // The syllabus runs after LEARN, and only ever adds. Anything it reads
      // that LEARN already reported is discarded, because LEARN is live data
      // and a syllabus is a week-one document that goes stale the first time
      // a schedule changes.
      // A syllabus changes about twice a term, so re-downloading and
      // re-parsing a PDF every half hour is pure waste. The cache is
      // invalidated by age and by the parser version, so a shipped fix to
      // the reading rules still takes effect on an existing install.
      const cached = await readSyllabusCache(course.id);
      const fresh = syllabusCacheIsFresh(cached, now, LEXICON_VERSION, SYLLABUS_TTL_MS);

      const syllabus = fresh ? null : await syncSyllabus(fetcher, course, versions.le, items, now);

      const worthCaching =
        syllabus !== null &&
        syllabus.ok &&
        (syllabus.value.docsRead > 0 || syllabus.value.docsFound === 0);

      if (worthCaching && syllabus !== null && syllabus.ok) {
        await writeSyllabusCache({
          courseId: course.id,
          parsedAt: now,
          parserVersion: LEXICON_VERSION,
          items: syllabus.value.items,
          note: syllabus.value.note,
          docsFound: syllabus.value.docsFound,
          docsRead: syllabus.value.docsRead,
        });
      }

      const extra =
        syllabus !== null && syllabus.ok ? syllabus.value.items : (cached?.items ?? []);
      const syllabusNote =
        syllabus !== null && syllabus.ok ? syllabus.value.note : (cached?.note ?? null);

      // A cached syllabus reading can predate an exam the instructor has
      // since put on the LEARN calendar, so LEARN is checked against it again
      // here. Two documents naming one midterm also share an id, which
      // dedupeById collapses.
      const combined = dedupeById([...items, ...dropDuplicatesOfLearn(extra, items)]);
      const merged = preserveFirstSeen(known, combined);
      await writeItemsFor(course.id, merged);

      await writeHealth({
        courseId: course.id,
        lastOkAt: now,
        lastError: partialFailures.length > 0 ? `Could not load: ${partialFailures.join(', ')}` : null,
        consecutiveFailures: 0,
        // Recorded so an empty syllabus result can explain itself rather
        // than looking identical to a course that simply had nothing.
        syllabusNote,
        syllabusItems: extra.length,
      });
      synced += 1;
    }

    // Seed the seen set on a first run so an existing backlog does not all
    // read as new, which would make the marker meaningless on day one.
    const allNews = await readAllNews();
    const seenNews = new Set(await readSeenNewsIds());
    if (seenNews.size === 0 && isFirstEverSync) {
      await writeSeenNewsIds(allNews.map((n) => n.id));
    }

    // Same rule for marks: a first sync is a baseline, not a pile of news.
    // Seeded once, the first time marks are ever read, including on an install
    // upgraded from a version without marks. An empty saved list is not the
    // same as no list: it means nothing was returned yet, and the first real
    // mark after that must still show as new.
    if ((await readSeenGradeIds()) === null) {
      const marks = await readAllMarks(courses);
      await writeSeenGradeIds([...marks.values()].flatMap((m) => m.grades.map((g) => g.id)));
    }

    const allItems = await readAllItems();
    const allIds = allItems.map((i) => i.id);

    // On a first sync every item would read as new, which is noise rather than
    // news, so the baseline is seeded silently instead.
    const newItemIds = isFirstEverSync ? [] : allIds.filter((id) => !previousIds.has(id));
    await writeSeenIds(allIds);

    await patchSyncState({
      running: false,
      lastSuccessAt: now,
      authState: 'ok',
      partial: failed > 0,
    });

    return ok({
      coursesSynced: synced,
      coursesFailed: failed,
      itemCount: allItems.length,
      newItemIds,
      partial: failed > 0,
    });
  } catch (cause) {
    return await failRun({
      kind: 'storage',
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
};

const failRun = async (error: AppError): Promise<Result<SyncSummary, AppError>> => {
  await patchSyncState({
    running: false,
    authState: error.kind === 'auth-redirect' || error.kind === 'no-session' ? 'needs-signin' : 'ok',
  });
  return err(error);
};

const toCourses = (parsed: ReturnType<typeof parseCourses>): readonly Course[] =>
  parsed.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    looksAcademic: c.looksAcademic,
    url: `${LEARN_ORIGIN}/d2l/home/${c.id}`,
  }));

/**
 * Keeps the original sighting time for items we already knew about, so the
 * "new" marker reflects when something actually appeared rather than when it
 * was last re-read.
 */
const preserveFirstSeen = (
  previous: readonly { id: string; firstSeenAt: number }[],
  next: readonly import('@core/types').TaskItem[],
): readonly import('@core/types').TaskItem[] => {
  const seen = new Map(previous.map((p) => [p.id, p.firstSeenAt]));
  return next.map((item) => {
    const first = seen.get(item.id);
    return first === undefined ? item : { ...item, firstSeenAt: first };
  });
};
