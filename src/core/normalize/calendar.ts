/**
 * Course calendar events to TaskItems.
 *
 * The LEARN calendar is where an instructor puts a midterm that has no
 * dropbox or quiz behind it, which makes it the one place on LEARN itself
 * that an exam date is stated as a fact.
 *
 * Only exams and tests are kept. Everything else on a course calendar is
 * either a lecture, an office hour, or a shadow of an assignment or quiz
 * already read from its own tool, and showing those twice would bury the
 * exams this file exists to surface.
 */

import { contentHash, learnId } from '../ids';
import { parseUtcDateTime } from '@shared/time';
import { asArray, asString, kindFromTitle, numericId } from './dropbox';
import type { SourceRef, TaskItem } from '../types';

interface RawEvent {
  readonly CalendarEventId?: unknown;
  readonly Title?: unknown;
  readonly StartDateTime?: unknown;
  readonly EndDateTime?: unknown;
  readonly IsAllDayEvent?: unknown;
  readonly AssociatedEntity?: unknown;
}

/**
 * The course home page. A calendar deep link would be more precise, but this
 * codebase has learned not to ship a LEARN path it has not seen work.
 */
const linkFor = (learnOrigin: string, courseId: string): string =>
  `${learnOrigin}/d2l/home/${courseId}`;

export const normalizeCalendarEvents = (
  json: unknown,
  courseId: string,
  learnOrigin: string,
  now: number,
): readonly TaskItem[] => {
  const out: TaskItem[] = [];

  for (const row of asArray(json)) {
    const event = row as RawEvent;
    const id = numericId(event.CalendarEventId);
    if (id === null) continue;

    // An event tied to a dropbox or quiz repeats a date already read from
    // that tool, where it carries submission state as well.
    if (isAssociated(event.AssociatedEntity)) continue;

    const title = typeof event.Title === 'string' ? event.Title.trim() : '';
    if (title === '') continue;

    const kind = kindFromTitle(title, 'other');
    if (kind !== 'exam' && kind !== 'test') continue;

    const startsAt = parseUtcDateTime(asString(event.StartDateTime));
    if (startsAt === null) continue;

    const url = linkFor(learnOrigin, courseId);
    const source: SourceRef = { system: 'calendar', sourceId: id, url, observedAt: now };

    out.push({
      id: learnId(courseId, 'calendar', id),
      courseId,
      title,
      kind,
      dueAt: startsAt,
      availableFrom: null,
      endsAt: parseUtcDateTime(asString(event.EndDateTime)),
      isAllDay: event.IsAllDayEvent === true,
      weightPct: null,
      url,
      sources: [source],
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: contentHash([title, startsAt, 'calendar']),
      firstSeenAt: now,
      lastSyncedAt: now,
    });
  }

  return out;
};

const isAssociated = (entity: unknown): boolean => {
  if (entity === null || typeof entity !== 'object') return false;
  const type = (entity as { AssociatedEntityType?: unknown }).AssociatedEntityType;
  return typeof type === 'string' && type.trim() !== '';
};
