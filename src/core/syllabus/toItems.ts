/**
 * Candidates to TaskItems.
 *
 * Syllabus items are visibly different from LEARN items in the panel, carry
 * the exact line they came from, and never overwrite anything LEARN said. A
 * syllabus is a week-one document; LEARN is live. Where they disagree about a
 * date, LEARN wins and the syllabus reading is dropped.
 */

import { contentHash, syllabusId } from '../ids';
import { kindFromTitle } from '../normalize/dropbox';
import type { SourceRef, TaskItem } from '../types';
import type { Candidate } from './extract';

export interface SourceDoc {
  readonly topicId: string;
  readonly title: string;
  readonly url: string;
}

export const candidatesToItems = (
  candidates: readonly Candidate[],
  courseId: string,
  doc: SourceDoc,
  now: number,
): readonly TaskItem[] =>
  candidates.map((c) => {
    const source: SourceRef = {
      system: 'syllabus',
      sourceId: `${doc.topicId}:${c.title}`,
      url: doc.url,
      observedAt: now,
      detail: { fileName: doc.title, rawLine: c.sourceLine },
    };

    return {
      id: syllabusId(courseId, c.title),
      courseId,
      title: c.title,
      kind: kindFromTitle(c.title, 'other'),
      dueAt: c.dueAt,
      availableFrom: null,
      endsAt: null,
      isAllDay: true,
      weightPct: c.weightPct,
      url: doc.url,
      sources: [source],
      // A syllabus cannot know whether anything was handed in.
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: c.confidence,
      contentHash: contentHash([c.title, c.dueAt, c.weightPct, 'syllabus']),
      firstSeenAt: now,
      lastSyncedAt: now,
    };
  });

/**
 * Drops syllabus items that duplicate something LEARN already reported.
 *
 * Matching is on name and closeness in time, and it is deliberately generous
 * about the date: a syllabus written in week one routinely disagrees with a
 * deadline the instructor later moved. Showing both would be worse than
 * showing only the live one, so where the two look like the same assessment
 * the LEARN record is kept and the syllabus reading is discarded.
 */
export const dropDuplicatesOfLearn = (
  syllabusItems: readonly TaskItem[],
  learnItems: readonly TaskItem[],
): readonly TaskItem[] =>
  syllabusItems.filter((s) => !learnItems.some((l) => looksLikeSame(s, l)));

const DAY = 86_400_000;

export const looksLikeSame = (a: TaskItem, b: TaskItem): boolean => {
  const an = normalize(a.title);
  const bn = normalize(b.title);

  // Ordinals are decisive. Assignment 3 is not Assignment 4, however similar
  // the rest of the title reads.
  const ao = ordinalOf(an);
  const bo = ordinalOf(bn);
  if (ao !== null && bo !== null && ao !== bo) return false;

  const sim = similarity(an, bn);
  if (sim < 0.5) return false;

  if (a.dueAt === null || b.dueAt === null) return sim >= 0.8;
  return Math.abs(a.dueAt - b.dueAt) <= 10 * DAY;
};

const STOP = new Set(['the', 'a', 'of', 'for', 'and', 'due', 'submission', 'exam']);

const normalize = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w !== '' && !STOP.has(w))
    .join(' ');

const ordinalOf = (normalized: string): string | null => {
  const m = /\b([0-9]{1,2})\b/.exec(normalized);
  return m?.[1] ?? null;
};

/** Dice coefficient over word bigrams, with a fallback for one-word titles. */
export const similarity = (a: string, b: string): number => {
  if (a === b) return 1;
  const aw = a.split(' ').filter((w) => w !== '');
  const bw = b.split(' ').filter((w) => w !== '');
  if (aw.length === 0 || bw.length === 0) return 0;

  const shared = aw.filter((w) => bw.includes(w)).length;
  return (2 * shared) / (aw.length + bw.length);
};
