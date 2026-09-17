/**
 * Human-readable dates for the panel. Pure, with `now` passed in.
 *
 * Relative phrasing beats absolute dates for the near term: "due tomorrow"
 * lands harder than a date a student then has to compare against today.
 * Past about a week it flips, because "in 23 days" is not something anyone
 * can plan around.
 */

import { localDaysBetween, MS_PER_HOUR } from '@shared/time';

export const formatDue = (dueAt: number | null, now: number): string => {
  if (dueAt === null) return 'No due date';

  const days = localDaysBetween(now, dueAt);
  const time = formatTime(dueAt);

  if (days === 0) {
    const hours = Math.round((dueAt - now) / MS_PER_HOUR);
    if (dueAt < now) return `Due today, ${time}`;
    if (hours <= 1) return 'Due within the hour';
    return `Due today, ${time}`;
  }
  if (days === 1) return `Due tomorrow, ${time}`;
  if (days === -1) return `Due yesterday, ${time}`;
  if (days < -1) return `${Math.abs(days)} days overdue`;
  if (days <= 6) return `${weekday(dueAt)}, ${time}`;
  return `${monthDay(dueAt)}, ${time}`;
};

/** Urgency tier, used only for colour. */
export const urgency = (dueAt: number | null, now: number): 'late' | 'soon' | 'normal' => {
  if (dueAt === null) return 'normal';
  if (dueAt < now) return 'late';
  return localDaysBetween(now, dueAt) <= 2 ? 'soon' : 'normal';
};

export const formatSyncedAt = (at: number | null, now: number): string => {
  if (at === null) return 'Not synced yet';
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return 'Synced just now';
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.round(hrs / 24)}d ago`;
};

const formatTime = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const weekday = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'long' });

const monthDay = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export const KIND_LABEL: Readonly<Record<string, string>> = {
  assignment: 'Assignment',
  quiz: 'Quiz',
  exam: 'Exam',
  test: 'Test',
  lab: 'Lab',
  project: 'Project',
  participation: 'Participation',
  other: 'Item',
};
