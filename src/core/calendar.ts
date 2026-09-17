/**
 * Month grid maths for the calendar tab.
 *
 * Pure and timezone-honest. Days are identified by a local calendar key rather
 * than an instant, because "which day is this due on" is a local question: an
 * 11:59pm deadline must not drift onto the next day just because the stored
 * instant is UTC.
 */

import { startOfLocalDay } from '@shared/time';
import type { ResolvedTask } from './types';

/** Local calendar day, as YYYY-MM-DD. Sorts lexicographically. */
export type DayKey = string;

export interface DayCell {
  readonly key: DayKey;
  readonly date: number;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly isToday: boolean;
  readonly isWeekend: boolean;
}

export interface MonthView {
  readonly year: number;
  readonly month: number;
  readonly label: string;
  readonly weeks: readonly (readonly DayCell[])[];
}

export const dayKeyOf = (at: number): DayKey => {
  const d = new Date(at);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * Builds a six-row grid. Always six rows, never five: a grid that changes
 * height between months makes the panel jump when you page through it.
 */
export const buildMonth = (year: number, month: number, now: number): MonthView => {
  const first = new Date(year, month, 1);
  const leading = first.getDay();
  const gridStart = new Date(year, month, 1 - leading);
  const todayKey = dayKeyOf(now);

  const weeks: DayCell[][] = [];

  for (let w = 0; w < 6; w += 1) {
    const week: DayCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + d);
      const at = date.getTime();
      const key = dayKeyOf(at);
      week.push({
        key,
        date: at,
        dayOfMonth: date.getDate(),
        inMonth: date.getMonth() === month,
        isToday: key === todayKey,
        isWeekend: d === 0 || d === 6,
      });
    }
    weeks.push(week);
  }

  return {
    year,
    month,
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weeks,
  };
};

export const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};

/** Buckets tasks by the local day they are due. Undated tasks are excluded. */
export const byDay = (tasks: readonly ResolvedTask[]): ReadonlyMap<DayKey, readonly ResolvedTask[]> => {
  const map = new Map<DayKey, ResolvedTask[]>();

  for (const t of tasks) {
    if (t.effectiveDueAt === null) continue;
    const key = dayKeyOf(t.effectiveDueAt);
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [t]);
    else bucket.push(t);
  }

  for (const [key, list] of map) {
    map.set(
      key,
      [...list].sort((a, b) => (a.effectiveDueAt ?? 0) - (b.effectiveDueAt ?? 0)),
    );
  }

  return map;
};

/**
 * The dot colour for a day: the most urgent thing on it wins. A day holding
 * one overdue item and three finished ones should read as overdue.
 */
export type DayTone = 'overdue' | 'due' | 'done' | 'none';

export const toneForDay = (tasks: readonly ResolvedTask[] | undefined): DayTone => {
  if (tasks === undefined || tasks.length === 0) return 'none';
  if (tasks.some((t) => t.status === 'overdue')) return 'overdue';
  if (tasks.some((t) => t.status !== 'completed')) return 'due';
  return 'done';
};

/** The month a newly opened calendar should land on. */
export const initialMonth = (now: number): { year: number; month: number } => {
  const d = new Date(startOfLocalDay(now));
  return { year: d.getFullYear(), month: d.getMonth() };
};
