/**
 * Weekly meeting patterns, so a syllabus phrase like "Lab 1" or "Tut 3 in
 * week 5" can be turned into a real date.
 *
 * This is deliberately small. The product does not show your timetable; it
 * only needs enough to answer "when does the thing that has work attached
 * actually happen".
 */

export type ComponentKind = 'LEC' | 'LAB' | 'TUT' | 'TST' | 'SEM' | 'PRJ' | 'OTHER';

export interface MeetingPattern {
  /** 0 is Sunday, matching Date.getDay. */
  readonly days: readonly number[];
  /** Minutes from local midnight, so comparisons need no date. */
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly location: string | null;
}

export interface SectionMeeting {
  readonly courseCode: string;
  readonly kind: ComponentKind;
  /** The section label as the student sees it, e.g. "LAB 102". */
  readonly section: string;
  readonly pattern: MeetingPattern;
  /** Term bounds, used to enumerate occurrences. */
  readonly startsOn: number | null;
  readonly endsOn: number | null;
}

export interface TermSchedule {
  readonly capturedAt: number;
  readonly termLabel: string | null;
  readonly termStartsOn: number | null;
  readonly meetings: readonly SectionMeeting[];
}

export const emptySchedule: TermSchedule = {
  capturedAt: 0,
  termLabel: null,
  termStartsOn: null,
  meetings: [],
};

const DAY_MS = 86_400_000;

/**
 * The nth occurrence of a weekly meeting, counting from the start of term.
 *
 * A syllabus numbers labs by occurrence, not by calendar week, which matters:
 * if a lab does not meet in the first week, Lab 1 is the meeting in week two.
 * Counting actual occurrences rather than weeks is what keeps those aligned.
 */
export const nthOccurrence = (
  meeting: SectionMeeting,
  n: number,
  termStartsOn: number,
): number | null => {
  if (n < 1 || meeting.pattern.days.length === 0) return null;

  const start = meeting.startsOn ?? termStartsOn;
  const end = meeting.endsOn;
  let found = 0;

  // A term is under 20 weeks, so a bounded scan is cheaper and clearer than
  // modular arithmetic over an irregular multi-day pattern.
  for (let offset = 0; offset < 140; offset += 1) {
    const at = start + offset * DAY_MS;
    if (end !== null && at > end) return null;

    const day = new Date(at).getDay();
    if (!meeting.pattern.days.includes(day)) continue;

    found += 1;
    if (found === n) return atMinute(at, meeting.pattern.startMinute);
  }

  return null;
};

/** The first occurrence on or after a given instant. */
export const occurrenceInWeekOf = (
  meeting: SectionMeeting,
  weekStart: number,
): number | null => {
  for (let offset = 0; offset < 7; offset += 1) {
    const at = weekStart + offset * DAY_MS;
    if (meeting.pattern.days.includes(new Date(at).getDay())) {
      return atMinute(at, meeting.pattern.startMinute);
    }
  }
  return null;
};

const atMinute = (at: number, minute: number | null): number => {
  const d = new Date(at);
  d.setHours(0, minute ?? 0, 0, 0);
  return d.getTime();
};

export const minutesFromClock = (hour: number, minute: number, isPm: boolean): number => {
  const h = isPm && hour < 12 ? hour + 12 : !isPm && hour === 12 ? 0 : hour;
  return h * 60 + minute;
};

export const findMeeting = (
  schedule: TermSchedule,
  courseCode: string,
  kind: ComponentKind,
): SectionMeeting | null => {
  const wanted = normalizeCode(courseCode);
  return (
    schedule.meetings.find((m) => normalizeCode(m.courseCode) === wanted && m.kind === kind) ?? null
  );
};

export const normalizeCode = (code: string): string =>
  code.toUpperCase().replace(/[^A-Z0-9]/g, '');
