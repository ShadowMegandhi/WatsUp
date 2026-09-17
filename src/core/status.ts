/**
 * Status derivation.
 *
 * Pure, and `now` is a parameter rather than a clock read, so every case is
 * testable without faking time.
 *
 * The order matters. An explicit user decision outranks whatever LEARN thinks,
 * because LEARN reports a saved draft as a submission and a student who knows
 * they have not finished should be able to say so and be believed.
 */

import type { Course, ResolvedTask, TaskItem, TaskOverride, TaskStatus } from './types';

export const effectiveDueAt = (item: TaskItem, override: TaskOverride | null): number | null => {
  if (override?.dueAt !== undefined) return override.dueAt;
  return item.dueAt ?? item.endsAt;
};

export const effectiveTitle = (item: TaskItem, override: TaskOverride | null): string =>
  override?.title ?? item.title;

export const deriveStatus = (
  item: TaskItem,
  override: TaskOverride | null,
  now: number,
): TaskStatus => {
  if (override?.completion === 'done') return 'completed';

  // Not a fallthrough: an explicit "not done" deliberately overrides LEARN.
  if (override?.completion !== 'not-done' && item.learnCompleted) return 'completed';

  const due = effectiveDueAt(item, override);
  if (due === null) return 'undated';
  return due < now ? 'overdue' : 'upcoming';
};

export const resolve = (
  item: TaskItem,
  override: TaskOverride | null,
  course: Course | null,
  now: number,
): ResolvedTask => ({
  item,
  override,
  course,
  status: deriveStatus(item, override, now),
  effectiveDueAt: effectiveDueAt(item, override),
  effectiveTitle: effectiveTitle(item, override),
  completionConflict: override?.completion === 'not-done' && item.learnCompleted,
});

/** Something the student still has to act on. */
export const isActionable = (t: ResolvedTask): boolean =>
  t.status === 'upcoming' || t.status === 'overdue';
