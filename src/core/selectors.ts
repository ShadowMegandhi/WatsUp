/**
 * Everything the panel needs to decide what to show, as pure functions over
 * resolved tasks. No chrome APIs, no clock reads, no rendering.
 */

import { MS_PER_DAY, startOfLocalDay } from '@shared/time';
import type { ResolvedTask, TaskStatus } from './types';

export type Section = 'due-soon' | 'upcoming' | 'overdue' | 'completed' | 'undated';

export interface SectionCounts {
  readonly overdue: number;
  readonly dueSoon: number;
  readonly upcoming: number;
  readonly completed: number;
  readonly undated: number;
}

/** Items due within this many days count as urgent. */
export const DUE_SOON_DAYS = 7;

export const sectionOf = (t: ResolvedTask, now: number): Section => {
  if (t.status === 'completed') return 'completed';
  if (t.status === 'overdue') return 'overdue';
  if (t.status === 'undated') return 'undated';
  return isWithinDays(t, now, DUE_SOON_DAYS) ? 'due-soon' : 'upcoming';
};

export const isWithinDays = (t: ResolvedTask, now: number, days: number): boolean => {
  if (t.effectiveDueAt === null) return false;
  const start = startOfLocalDay(now);
  return t.effectiveDueAt >= start && t.effectiveDueAt < start + days * MS_PER_DAY;
};

/**
 * Sorting deliberately differs by section. For anything outstanding the
 * soonest deadline is the most urgent, but for completed work the most
 * recently finished is what a student wants to see first.
 */
export const sortForSection = (
  tasks: readonly ResolvedTask[],
  section: Section,
): readonly ResolvedTask[] => {
  const copy = [...tasks];

  if (section === 'completed') {
    return copy.sort((a, b) => (b.effectiveDueAt ?? 0) - (a.effectiveDueAt ?? 0));
  }
  if (section === 'undated') {
    return copy.sort((a, b) => a.effectiveTitle.localeCompare(b.effectiveTitle));
  }
  return copy.sort((a, b) => {
    const ad = a.effectiveDueAt ?? Number.MAX_SAFE_INTEGER;
    const bd = b.effectiveDueAt ?? Number.MAX_SAFE_INTEGER;
    return ad === bd ? a.effectiveTitle.localeCompare(b.effectiveTitle) : ad - bd;
  });
};

export const group = (
  tasks: readonly ResolvedTask[],
  now: number,
): Readonly<Record<Section, readonly ResolvedTask[]>> => {
  const buckets: Record<Section, ResolvedTask[]> = {
    'due-soon': [],
    upcoming: [],
    overdue: [],
    completed: [],
    undated: [],
  };

  for (const t of tasks) buckets[sectionOf(t, now)].push(t);

  return {
    'due-soon': sortForSection(buckets['due-soon'], 'due-soon'),
    upcoming: sortForSection(buckets.upcoming, 'upcoming'),
    overdue: sortForSection(buckets.overdue, 'overdue'),
    completed: sortForSection(buckets.completed, 'completed'),
    undated: sortForSection(buckets.undated, 'undated'),
  };
};

export const counts = (tasks: readonly ResolvedTask[], now: number): SectionCounts => {
  const g = group(tasks, now);
  return {
    overdue: g.overdue.length,
    dueSoon: g['due-soon'].length,
    upcoming: g.upcoming.length,
    completed: g.completed.length,
    undated: g.undated.length,
  };
};

/**
 * The number on the toolbar badge and the panel header. Overdue plus due-soon,
 * because that is what actually needs attention today. Counting everything
 * outstanding would show a number so large it stops meaning anything.
 */
export const attentionCount = (tasks: readonly ResolvedTask[], now: number): number => {
  const c = counts(tasks, now);
  return c.overdue + c.dueSoon;
};

export const byStatus = (tasks: readonly ResolvedTask[], status: TaskStatus): readonly ResolvedTask[] =>
  tasks.filter((t) => t.status === status);

export const search = (tasks: readonly ResolvedTask[], query: string): readonly ResolvedTask[] => {
  const q = query.trim().toLowerCase();
  if (q === '') return tasks;
  return tasks.filter(
    (t) =>
      t.effectiveTitle.toLowerCase().includes(q) ||
      (t.course?.code ?? '').toLowerCase().includes(q) ||
      (t.course?.name ?? '').toLowerCase().includes(q),
  );
};
