/**
 * Reading the Quest class schedule table.
 *
 * Quest states the schedule exactly, and the job here is to stop inferring and
 * start reading it. Three properties of that table drive this whole file:
 *
 *   1. A component has several rows, not one. MATH 101 LEC has six.
 *   2. Each row carries its own date range, and a range whose start equals its
 *      end is a single session rather than a weekly pattern.
 *   3. Reading week is already encoded, as a gap between two ranges. Expanding
 *      what Quest states therefore skips it for free, where inferring a weekly
 *      pattern would place a class in the middle of it.
 *
 * Continuation rows leave Class Nbr, Section and Component blank and inherit
 * them from the row above, which is why parsing row by row in isolation loses
 * most of the schedule.
 */

import { parseClock } from './parse';
import type { ComponentKind } from '@core/schedule/types';

export interface MeetingRow {
  readonly courseCode: string;
  readonly section: string;
  readonly kind: ComponentKind;
  readonly days: readonly number[];
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly room: string | null;
  readonly startsOn: number;
  readonly endsOn: number;
}

const KINDS: readonly ComponentKind[] = ['LEC', 'LAB', 'TUT', 'TST', 'SEM', 'PRJ'];

const DAY_LETTERS: Readonly<Record<string, number>> = {
  M: 1, T: 2, W: 3, F: 5, S: 6, U: 0,
};

/**
 * Quest writes weekday sets as MWF, TTh, M. Th is consumed before T so that
 * Thursday is not read as Tuesday followed by a stray letter.
 */
export const parseQuestDays = (raw: string): readonly number[] => {
  const text = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const days: number[] = [];

  let i = 0;
  while (i < text.length) {
    if (text.startsWith('TH', i)) {
      if (!days.includes(4)) days.push(4);
      i += 2;
      continue;
    }
    const day = DAY_LETTERS[text[i] ?? ''];
    if (day !== undefined && !days.includes(day)) days.push(day);
    i += 1;
  }

  return days.sort((a, b) => a - b);
};

/** Quest prints MM/DD/YYYY. One system, one known format, so no ambiguity. */
export const parseQuestDate = (raw: string): number | null => {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(raw);
  if (m === null) return null;

  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const probe = new Date(year, month - 1, day);
  return probe.getMonth() === month - 1 && probe.getDate() === day ? probe.getTime() : null;
};

export const parseQuestDateRange = (
  line: string,
): { readonly startsOn: number; readonly endsOn: number } | null => {
  const m = /(\d{1,2}\/\d{1,2}\/\d{4})\s*[-\u2013]\s*(\d{1,2}\/\d{1,2}\/\d{4})/.exec(line);
  if (m === null) return null;

  const startsOn = parseQuestDate(m[1] ?? '');
  const endsOn = parseQuestDate(m[2] ?? '');
  if (startsOn === null || endsOn === null || endsOn < startsOn) return null;

  return { startsOn, endsOn };
};

const findKind = (line: string): ComponentKind | null => {
  for (const k of KINDS) {
    if (new RegExp(`(^|[^A-Z])${k}([^A-Z]|$)`).test(line.toUpperCase())) return k;
  }
  return null;
};

const findCourseHeading = (line: string): string | null => {
  // Quest heads each block with "MATH 101 - Linear Algebra (Eng)".
  const m = /^\s*([A-Z]{2,6})\s+(\d{3}[A-Z]?)\s*[-\u2013]/.exec(line);
  return m === null ? null : `${m[1]} ${m[2]}`;
};

const findDays = (line: string): readonly number[] => {
  // The day set sits immediately before a time, which is what distinguishes it
  // from an instructor initial or a room prefix.
  const m = /(?:^|[\s|])((?:Th|[MTWFSU])+)\s+\d{1,2}:\d{2}/.exec(line);
  return m === null ? [] : parseQuestDays(m[1] ?? '');
};

const findRoom = (line: string): string | null => {
  const m = /\b([A-Z]{2,4})\s(\d{2,4})\b/.exec(line.replace(/^\s*[A-Z]{2,6}\s+\d{3}[A-Z]?\s*[-\u2013].*$/, ''));
  return m === null ? null : `${m[1]} ${m[2]}`;
};

/**
 * Reads the table into one row per stated meeting.
 *
 * Course, section and component persist across continuation rows, because
 * Quest leaves those cells blank when a component has more than one meeting
 * and the row means nothing without them.
 */
export const parseQuestRows = (text: string): readonly MeetingRow[] => {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');

  const rows: MeetingRow[] = [];

  let course: string | null = null;
  let section = '';
  let kind: ComponentKind | null = null;

  for (const line of lines) {
    const heading = findCourseHeading(line);
    if (heading !== null) {
      course = heading;
      kind = null;
      section = '';
      continue;
    }

    if (course === null) continue;
    if (/class\s*nbr/i.test(line)) continue;

    const rowKind = findKind(line);
    if (rowKind !== null) {
      kind = rowKind;
      const sec = new RegExp("\\b(\\d{2,4})\\s+" + rowKind + "\\b").exec(line.toUpperCase());
      section = sec?.[1] ?? section;
    }

    const range = parseQuestDateRange(line);
    const days = findDays(line);
    if (range === null || days.length === 0 || kind === null) continue;

    const times = line.match(/\d{1,2}:\d{2}\s*[AP]?\.?M?\.?/gi) ?? [];

    rows.push({
      courseCode: course,
      section: section === '' ? kind : `${kind} ${section}`,
      kind,
      days,
      startMinute: times[0] === undefined ? null : parseClock(times[0]),
      endMinute: times[1] === undefined ? null : parseClock(times[1]),
      room: findRoom(line),
      startsOn: range.startsOn,
      endsOn: range.endsOn,
    });
  }

  return rows;
};

const DAY_MS = 86_400_000;

/** A generous bound: no component meets more than this in one term. */
const MAX_SESSIONS_PER_ROW = 60;

export interface ExpandedSession {
  readonly courseCode: string;
  readonly section: string;
  readonly kind: ComponentKind;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly room: string | null;
}

/**
 * Turns stated ranges into the individual days a component actually meets.
 *
 * This is the whole point. A weekly pattern inferred from one row places a lab
 * on a day it does not meet and puts classes inside reading week. Quest has
 * already split its ranges around the break, so walking each range and keeping
 * the days it names produces the real calendar without inferring anything.
 *
 * A range whose start equals its end contributes exactly one session, which is
 * how Quest writes a one-off test.
 */
export const expandSessions = (rows: readonly MeetingRow[]): readonly ExpandedSession[] => {
  const out: ExpandedSession[] = [];

  for (const row of rows) {
    let emitted = 0;

    for (let at = row.startsOn; at <= row.endsOn && emitted < MAX_SESSIONS_PER_ROW; at += DAY_MS) {
      const day = new Date(at);
      if (!row.days.includes(day.getDay())) continue;

      out.push({
        courseCode: row.courseCode,
        section: row.section,
        kind: row.kind,
        startsAt: atMinute(at, row.startMinute),
        endsAt: row.endMinute === null ? null : atMinute(at, row.endMinute),
        room: row.room,
      });
      emitted += 1;
    }
  }

  return dedupeSessions(out);
};

/**
 * Local midnight plus an offset, rather than arithmetic on the instant.
 *
 * A term crosses a daylight saving change, and adding milliseconds across it
 * shifts every later class by an hour.
 */
const atMinute = (at: number, minute: number | null): number => {
  const d = new Date(at);
  d.setHours(0, minute ?? 0, 0, 0);
  return d.getTime();
};

const dedupeSessions = (sessions: readonly ExpandedSession[]): readonly ExpandedSession[] => {
  const seen = new Map<string, ExpandedSession>();
  for (const s of sessions) {
    seen.set(`${s.courseCode}|${s.kind}|${s.startsAt}`, s);
  }
  return [...seen.values()].sort((a, b) => a.startsAt - b.startsAt);
};
