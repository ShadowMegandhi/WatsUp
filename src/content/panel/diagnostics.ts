/**
 * A single block of text describing everything the extension currently knows.
 *
 * Exists because "it did not work" covers at least five different failures
 * that look identical from outside: the sync never ran, the session expired,
 * no syllabus was found, one was found but could not be read, or it was read
 * and contained nothing datable. Guessing between them wastes far more time
 * than printing the answer.
 *
 * The Portal text sample is included deliberately. When the schedule parse
 * finds nothing, that sample is the only thing that shows what the page
 * actually looked like.
 */

import type { Course, CourseHealth, SyncState, TaskItem } from '@core/types';
import type { StoredPortalCapture } from '@storage/store';

export interface DiagnosticsInput {
  readonly items: readonly TaskItem[];
  readonly courses: readonly Course[];
  readonly health: readonly CourseHealth[];
  readonly syncState: SyncState | null;
  readonly portal: StoredPortalCapture | null;
  readonly grantedHosts: readonly string[];
  readonly now: number;
}

const SAMPLE_CHARS = 1500;

export const buildDiagnostics = (input: DiagnosticsInput): string => {
  const { items, courses, health, syncState, portal, grantedHosts, now } = input;
  const healthById = new Map(health.map((h) => [h.courseId, h]));
  const out: string[] = [];

  out.push('LEARN Tracker diagnostics');
  out.push(new Date(now).toISOString());
  out.push('');

  out.push('HOST ACCESS');
  for (const host of REQUIRED_HOSTS) {
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
    const fromSyllabus = mine.filter((i) => i.sources.some((s) => s.system === 'syllabus')).length;

    out.push(`  ${course.code || course.name} [${course.id}]${course.looksAcademic ? '' : ' (not a course)'}`);
    out.push(`      items: ${mine.length}, from syllabus: ${fromSyllabus}`);
    if (h?.lastError != null && h.lastError !== '') out.push(`      error: ${h.lastError}`);
    if (h?.syllabusNote != null && h.syllabusNote !== '') out.push(`      syllabus: ${h.syllabusNote}`);
    if (h === undefined) out.push('      no health record, this course never synced');
  }
  out.push('');

  out.push('PORTAL');
  if (portal === null) {
    out.push('  never captured, the Portal page has not been visited since installing');
  } else {
    out.push(`  captured:  ${stamp(portal.schedule.capturedAt)}`);
    out.push(`  url:       ${portal.url}`);
    out.push(`  term:      ${portal.schedule.termLabel ?? 'not found'}`);
    out.push(`  sections:  ${portal.schedule.meetings.length} (weekly pattern)`);
    out.push(`  sessions:  ${portal.events?.length ?? 0} (real dated events)`);
    out.push(`  saw text:  ${String(portal.sawText)}`);
    out.push('');
    const sessions = (portal.events ?? []) as readonly {
      title?: unknown;
      courseCode?: unknown;
      kind?: unknown;
      startsAt?: unknown;
    }[];

    if (sessions.length > 0) {
      out.push('');
      out.push('  dated sessions found:');
      for (const e of sessions.slice(0, 20)) {
        const when = typeof e.startsAt === 'number' ? new Date(e.startsAt).toLocaleString() : '?';
        const course = typeof e.courseCode === 'string' ? e.courseCode : 'no course';
        const kind = typeof e.kind === 'string' ? e.kind : 'no type';
        const title = typeof e.title === 'string' ? e.title : '';
        out.push(`    ${when}  [${course} / ${kind}]  ${title}`);
      }
      if (sessions.length > 20) out.push(`    ... and ${sessions.length - 20} more`);
    }

    out.push('  --- text the page showed, first 1500 characters ---');
    out.push(indent(portal.sample.slice(0, SAMPLE_CHARS)));
    out.push('  --- end ---');
  }
  out.push('');

  out.push('ITEMS BY SOURCE');
  out.push(`  dropbox:  ${countSource(items, 'dropbox')}`);
  out.push(`  quiz:     ${countSource(items, 'quiz')}`);
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
const REQUIRED_HOSTS = [
  { match: 'learn.uwaterloo.ca', label: 'LEARN, for assignments' },
  { match: 'quest.pecs.uwaterloo.ca', label: 'Quest, for lab and tutorial dates' },
  { match: 'portal.uwaterloo.ca', label: 'Portal, an alternative schedule source' },
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

const indent = (text: string): string =>
  text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
