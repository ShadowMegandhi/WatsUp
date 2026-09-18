/**
 * Giving counted assessments real dates.
 *
 * A syllabus that says "Tutorial Assignments (best 7 of 9)" states a count and
 * a component. The calendar states when that component meets. Together those
 * are enough, and neither is enough alone, which is why this waits for both
 * rather than estimating from one.
 *
 * Nothing is placed without real sessions. Spacing nine assignments evenly
 * across a term would look plausible and be wrong, and a plausible wrong
 * deadline is worse than an absent one.
 */

import { contentHash, syllabusId } from '../ids';
import { kindFromTitle } from '../normalize/dropbox';
import type { SourceRef, TaskItem } from '../types';
import type { RecurringAssessment } from './recurring';
import type { DatedSession } from './sessions';

export interface PlacementSource {
  readonly topicId: string;
  readonly title: string;
  readonly url: string;
}

export interface PlacementResult {
  readonly items: readonly TaskItem[];
  /** Said plainly when a series is known but cannot be dated. */
  readonly unplaced: readonly string[];
}

export const placeRecurring = (
  series: readonly RecurringAssessment[],
  sessions: readonly DatedSession[],
  courseId: string,
  courseCode: string,
  doc: PlacementSource,
  now: number,
): PlacementResult => {
  const items: TaskItem[] = [];
  const unplaced: string[] = [];

  for (const s of series) {
    const dates = sessionsFor(sessions, courseCode, s.kind);

    if (dates.length === 0) {
      unplaced.push(`${s.title}: ${s.count} of them, but no ${s.kind} dates are known yet`);
      continue;
    }

    // Only place as many as there are real sessions. If a course lists nine
    // and the calendar shows seven, the last two have no honest date.
    const placeable = Math.min(s.count, dates.length);
    if (placeable < s.count) {
      unplaced.push(`${s.title}: ${s.count} listed, only ${placeable} ${s.kind} dates known`);
    }

    for (let n = 1; n <= placeable; n += 1) {
      const at = dates[n - 1];
      if (at === undefined) continue;

      const title = `${s.title} ${n}`;
      const source: SourceRef = {
        system: 'syllabus',
        sourceId: `${doc.topicId}:${title}`,
        url: doc.url,
        observedAt: now,
        detail: { fileName: doc.title, rawLine: s.sourceLine },
      };

      items.push({
        id: syllabusId(courseId, title),
        courseId,
        title,
        kind: kindFromTitle(title, 'assignment'),
        dueAt: at,
        availableFrom: null,
        endsAt: null,
        isAllDay: false,
        weightPct: s.weightPct === null ? null : round2(s.weightPct / s.count),
        url: doc.url,
        sources: [source],
        learnCompleted: false,
        learnCompletionEvidence: 'none',
        // Lower than a stated date, because the date came from a schedule
        // rather than from the syllabus saying so.
        confidence: 0.75,
        contentHash: contentHash([title, at, 'recurring']),
        firstSeenAt: now,
        lastSyncedAt: now,
      });
    }
  }

  return { items, unplaced };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const sessionsFor = (
  sessions: readonly DatedSession[],
  courseCode: string,
  kind: string,
): readonly number[] => {
  const wanted = normalize(courseCode);
  return sessions
    .filter((s) => s.kind === kind && normalize(s.courseCode ?? '') === wanted)
    .map((s) => s.startsAt)
    .sort((a, b) => a - b);
};

const normalize = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
