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

/**
 * The short text inside a row's due pill. The day group above already says
 * which day it is, so this stays brief; all-day items (read from an outline)
 * carry no time, because 11:59 PM there is a placeholder, not a deadline.
 */
export const formatDueShort = (dueAt: number | null, now: number, allDay = false): string => {
  if (dueAt === null) return 'No date';

  const days = localDaysBetween(now, dueAt);
  const time = allDay ? '' : formatTime(dueAt);
  const at = (label: string): string => (time === '' ? label : `${label}, ${time}`);

  if (dueAt < now && !(allDay && days === 0)) {
    if (days === 0) return `Late, ${time}`;
    if (days === -1) return '1 day late';
    return `${Math.abs(days)} days late`;
  }
  if (days === 0) return at('Today');
  if (days === 1) return at('Tomorrow');
  if (days <= 6) return at(shortWeekday(dueAt));
  return monthDay(dueAt);
};

/** "in 5 hours", for the Next up card. */
export const countdown = (dueAt: number, now: number): string => {
  const mins = Math.round((dueAt - now) / 60_000);
  if (mins < 0) return 'past due';
  if (mins < 60) return mins <= 1 ? 'in a minute' : `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'in 1 hour' : `in ${hours} hours`;
  const days = localDaysBetween(now, dueAt);
  return days === 1 ? 'tomorrow' : `in ${days} days`;
};

/** The header's one-line summary, in plain words. */
export const summaryLine = (overdue: number, today: number, week: number): string => {
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (today > 0) parts.push(`${today} due today`);
  else if (week > 0) parts.push(`${week} due this week`);
  return parts.length === 0 ? "You're all caught up" : parts.join(' · ');
};

/** "Mon, Oct 19", for day group headers. */
export const dayName = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

const shortWeekday = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { weekday: 'short' });

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
