/**
 * One row per thing.
 *
 * Duplicates arrive from two directions. A course usually has both an outline
 * and a schedule, and the syllabus reader is deliberately willing to read both,
 * so the same midterm can be described twice. Separately, an assessment can be
 * named in a syllabus and also exist as a LEARN record.
 *
 * Identity dedup happens here and is not optional: two items sharing an id are
 * the same item by definition, and letting both through means a user ticking
 * one off watches the other stay.
 */

import type { TaskItem } from './types';

/**
 * Collapses items sharing an id, keeping the best-supported version.
 *
 * LEARN beats a syllabus reading, then higher confidence wins, then the one
 * that knows a due date. Sources are unioned so provenance survives the merge
 * and the panel can still show where a thing came from.
 */
export const dedupeById = (items: readonly TaskItem[]): readonly TaskItem[] => {
  const best = new Map<string, TaskItem>();

  for (const item of items) {
    const existing = best.get(item.id);
    best.set(item.id, existing === undefined ? item : mergePair(existing, item));
  }

  return [...best.values()];
};

const mergePair = (a: TaskItem, b: TaskItem): TaskItem => {
  const winner = prefer(a, b);
  const loser = winner === a ? b : a;

  return {
    ...winner,
    // Keep whichever date is actually known, preferring the winner.
    dueAt: winner.dueAt ?? loser.dueAt,
    endsAt: winner.endsAt ?? loser.endsAt,
    weightPct: winner.weightPct ?? loser.weightPct,
    // Completion is evidence, so either source reporting it is enough.
    learnCompleted: winner.learnCompleted || loser.learnCompleted,
    learnCompletionEvidence: winner.learnCompleted
      ? winner.learnCompletionEvidence
      : loser.learnCompletionEvidence,
    confidence: Math.max(winner.confidence, loser.confidence),
    firstSeenAt: Math.min(winner.firstSeenAt, loser.firstSeenAt),
    sources: unionSources(winner, loser),
  };
};

const isFromLearn = (item: TaskItem): boolean =>
  item.sources.some((s) => s.system === 'dropbox' || s.system === 'quiz');

const prefer = (a: TaskItem, b: TaskItem): TaskItem => {
  const aLearn = isFromLearn(a);
  const bLearn = isFromLearn(b);
  if (aLearn !== bLearn) return aLearn ? a : b;

  if (a.confidence !== b.confidence) return a.confidence > b.confidence ? a : b;
  if ((a.dueAt === null) !== (b.dueAt === null)) return a.dueAt !== null ? a : b;
  return a;
};

const unionSources = (a: TaskItem, b: TaskItem): TaskItem['sources'] => {
  const seen = new Set<string>();
  const out: TaskItem['sources'][number][] = [];

  for (const s of [...a.sources, ...b.sources]) {
    const key = `${s.system}:${s.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }

  return out;
};
