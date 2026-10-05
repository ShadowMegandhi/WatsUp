/**
 * The To do list, grouped by day.
 *
 * A student plans in days ("what is due tomorrow?"), so the list is cut into
 * Overdue, Today, Tomorrow, This week, Next week, Later and No due date.
 * Pure: `now` is passed in.
 */

import { sortForSection } from '@core/selectors';
import type { ResolvedTask } from '@core/types';
import { localDaysBetween } from '@shared/time';
import { dayName } from './format';

export type GroupId = 'overdue' | 'today' | 'tomorrow' | 'week' | 'nextweek' | 'later' | 'undated';

/** Colour of the group header: red for late, gold for today, plain otherwise. */
export type GroupTone = 'late' | 'today' | 'plain';

export interface DayGroup {
  readonly id: GroupId;
  readonly label: string;
  /** Second, quieter part of the header, such as the date. */
  readonly detail: string;
  readonly tone: GroupTone;
  readonly tasks: readonly ResolvedTask[];
}

const ORDER: readonly GroupId[] = ['overdue', 'today', 'tomorrow', 'week', 'nextweek', 'later', 'undated'];

export const groupIdOf = (t: ResolvedTask, now: number): GroupId => {
  if (t.status === 'overdue') return 'overdue';
  if (t.effectiveDueAt === null) return 'undated';
  const days = localDaysBetween(now, t.effectiveDueAt);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 6) return 'week';
  if (days <= 13) return 'nextweek';
  return 'later';
};

/** Open (not completed) tasks, cut into day groups, empty groups left out. */
export const groupByDay = (tasks: readonly ResolvedTask[], now: number): readonly DayGroup[] => {
  const buckets = new Map<GroupId, ResolvedTask[]>();
  for (const t of tasks) {
    if (t.status === 'completed') continue;
    const id = groupIdOf(t, now);
    const list = buckets.get(id) ?? [];
    list.push(t);
    buckets.set(id, list);
  }

  return ORDER.filter((id) => (buckets.get(id) ?? []).length > 0).map((id) => {
    const list = buckets.get(id) ?? [];
    return {
      id,
      ...headerFor(id, now),
      tasks: sortForSection(list, id === 'undated' ? 'undated' : 'upcoming'),
    };
  });
};

const DAY = 86_400_000;

const headerFor = (
  id: GroupId,
  now: number,
): { label: string; detail: string; tone: GroupTone } => {
  switch (id) {
    case 'overdue':
      return { label: 'Overdue', detail: '', tone: 'late' };
    case 'today':
      return { label: 'Today', detail: dayName(now), tone: 'today' };
    case 'tomorrow':
      return { label: 'Tomorrow', detail: dayName(now + DAY), tone: 'plain' };
    case 'week':
      return { label: 'This week', detail: '', tone: 'plain' };
    case 'nextweek':
      return { label: 'Next week', detail: '', tone: 'plain' };
    case 'later':
      return { label: 'Later', detail: '', tone: 'plain' };
    case 'undated':
      return { label: 'No due date', detail: '', tone: 'plain' };
  }
};

/** The soonest open item that is not yet late, for the Next up card. */
export const nextUp = (tasks: readonly ResolvedTask[], now: number): ResolvedTask | null => {
  let best: ResolvedTask | null = null;
  for (const t of tasks) {
    if (t.status === 'completed' || t.effectiveDueAt === null || t.effectiveDueAt < now) continue;
    if (best === null || t.effectiveDueAt < (best.effectiveDueAt ?? Infinity)) best = t;
  }
  return best;
};
