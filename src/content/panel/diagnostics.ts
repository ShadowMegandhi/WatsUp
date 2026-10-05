/**
 * A single block of text describing everything the extension currently knows.
 *
 * Exists because "it did not work" covers several different failures that
 * look identical from outside: the sync never ran, the session expired, an
 * endpoint was refused, no syllabus was found, or one was read and named no
 * dated exam. Guessing between them wastes far more time than printing the
 * answer.
 */

import type { Course, CourseHealth, SyncState, TaskItem } from '@core/types';
import type { StoredMarks } from '@storage/store';

export interface DiagnosticsInput {
  readonly items: readonly TaskItem[];
  readonly courses: readonly Course[];
  readonly health: readonly CourseHealth[];
  readonly marks: ReadonlyMap<string, StoredMarks>;
  readonly syncState: SyncState | null;
  readonly grantedHosts: readonly string[];
  readonly now: number;
}

export const buildDiagnostics = (input: DiagnosticsInput): string => {
  const { items, courses, health, marks, syncState, grantedHosts, now } = input;
  const healthById = new Map(health.map((h) => [h.courseId, h]));
  const out: string[] = [];

  out.push('WatsUp diagnostics');
  out.push(new Date(now).toISOString());
  out.push('');

  out.push('HOST ACCESS');
  for (const host of HOSTS) {
    const granted = grantedHosts.some((g) => g.includes(host.match));
    out.push(`  ${granted ? Y : N} ${host.label}`);
  }
  out.push('');

  out.push('SYNC');
  out.push(`  last run:     ${stamp(syncState?.lastRunAt ?? null)}`);
  out.push(`  last success: ${stamp(syncState?.lastSuccessAt ?? null)}`);
  out.push(`  auth state:   ${syncState?.authState ?? 'unknown'}`);
  out.push(`  running:      ${String(syncState?.running ?? false)}`);
  out.push(`  partial:      ${String(syncState?.partial ?? false)}`);
  out.push('');

  out.push(`COURSES (${courses.length})`);
  for (const course of courses) {
    const h = healthById.get(course.id);
    const mine = items.filter((i) => i.courseId === course.id);
    const m = marks.get(course.id);

    out.push(`  ${course.code || course.name} [${course.id}]${course.looksAcademic ? '' : ' (not a course)'}`);
    out.push(
      `      items: ${mine.length}, calendar exams: ${countSource(mine, 'calendar')}, syllabus exams: ${countSource(mine, 'syllabus')}`,
    );
    out.push(
      `      marks: ${m?.grades.length ?? 0}, course grade: ${m?.courseGrade?.displayed ?? 'not shown'}`,
    );
    // "Could not load: calendar" here means both calendar request shapes were refused.
    if (h?.lastError != null && h.lastError !== '') out.push(`      error: ${h.lastError}`);
    if (h?.syllabusNote != null && h.syllabusNote !== '') out.push(`      syllabus: ${h.syllabusNote}`);
    if (h === undefined) out.push('      no health record, this course never synced');
  }
  out.push('');

  out.push('ITEMS BY SOURCE');
  out.push(`  dropbox:  ${countSource(items, 'dropbox')}`);
  out.push(`  quiz:     ${countSource(items, 'quiz')}`);
  out.push(`  calendar: ${countSource(items, 'calendar')}`);
  out.push(`  syllabus: ${countSource(items, 'syllabus')}`);
  out.push(`  total:    ${items.length}`);

  const duplicates = findDuplicateIds(items);
  if (duplicates.length > 0) out.push(`  DUPLICATE IDS: ${duplicates.join(', ')}`);

  return out.join('\n');
};

const Y = "granted  ";
const N = "WITHHELD ";

/**
 * A withheld host fails silently in two ways at once: a worker fetch throws
 * "Failed to fetch" and a declared content script never injects. Both read as
 * the site being broken, which is why this is the first thing reported.
 */
const HOSTS = [
  { match: 'learn.uwaterloo.ca', label: 'LEARN, for everything' },
  { match: 'outline.uwaterloo.ca', label: 'Course outlines kept outside LEARN' },
] as const;

const countSource = (items: readonly TaskItem[], system: string): number =>
  items.filter((i) => i.sources.some((s) => s.system === system)).length;

const findDuplicateIds = (items: readonly TaskItem[]): readonly string[] => {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const i of items) {
    if (seen.has(i.id)) dupes.add(i.id);
    seen.add(i.id);
  }
  return [...dupes];
};

const stamp = (at: number | null): string =>
  at === null ? 'never' : new Date(at).toLocaleString();
