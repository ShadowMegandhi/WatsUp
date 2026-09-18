/**
 * Reading a schedule out of arbitrary page text.
 *
 * Portal renders client side, so its markup is unknown until someone logged in
 * looks at it. Rather than guess at a DOM shape, this works on visible text and
 * looks for the thing that is stable regardless of layout: a course code, a
 * component label, and a day/time pattern near each other.
 *
 * Pure, so it can be tested against captured text without a browser.
 */

import {
  minutesFromClock,
  normalizeCode,
  type ComponentKind,
  type SectionMeeting,
} from '@core/schedule/types';

const DAY_TOKENS: readonly (readonly [string, number])[] = [
  ['SU', 0], ['MO', 1], ['TU', 2], ['WE', 3], ['TH', 4], ['FR', 5], ['SA', 6],
];

/** Waterloo writes weekday sets as MWF, TTh, MTWThF and similar. */
export const parseDays = (raw: string): readonly number[] => {
  const text = raw.toUpperCase().replace(/[^A-Z]/g, '');
  const days: number[] = [];

  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    const pair = DAY_TOKENS.find(([t]) => t === two);

    if (pair !== undefined && (two !== 'TH' || true)) {
      if (!days.includes(pair[1])) days.push(pair[1]);
      i += 2;
      continue;
    }

    // Single letters, where T is Tuesday and Th has already been consumed.
    const single = text[i];
    const map: Readonly<Record<string, number>> = { M: 1, T: 2, W: 3, F: 5, S: 6, U: 0 };
    const day = single === undefined ? undefined : map[single];
    if (day !== undefined && !days.includes(day)) days.push(day);
    i += 1;
  }

  return days.sort((a, b) => a - b);
};

export const parseClock = (raw: string): number | null => {
  const m = /(\d{1,2})[:.](\d{2})\s*([ap])?\.?m?\.?/i.exec(raw);
  if (m === null) return null;

  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  const suffix = (m[3] ?? '').toLowerCase();
  if (suffix === '') return hour * 60 + minute;
  return minutesFromClock(hour, minute, suffix === 'p');
};

const KINDS: readonly (readonly [RegExp, ComponentKind])[] = [
  [/\bLEC\b/i, 'LEC'],
  [/\bLAB\b/i, 'LAB'],
  [/\bTUT\b/i, 'TUT'],
  [/\bTST\b/i, 'TST'],
  [/\bSEM\b/i, 'SEM'],
  [/\bPRJ\b/i, 'PRJ'],
];

export const parseKind = (raw: string): ComponentKind | null => {
  for (const [re, kind] of KINDS) if (re.test(raw)) return kind;
  return null;
};

/**
 * Pulls meetings out of a block of visible text.
 *
 * A course code sets the context and applies to the component rows beneath it,
 * which is how every schedule view is laid out regardless of markup.
 */
export const parseScheduleText = (text: string): readonly SectionMeeting[] => {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');

  const out: SectionMeeting[] = [];
  let currentCourse: string | null = null;

  for (const line of lines) {
    const code = /\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b/.exec(line);
    const prefix = (code?.[1] ?? "").toUpperCase();
    // A component label looks exactly like a course code: letters then three
    // digits. Without this guard "TUT 102" becomes the current course and
    // every row beneath it is filed under a course that does not exist.
    const isComponentLabel = /^(LEC|LAB|TUT|TST|SEM|PRJ)$/.test(prefix);
    if (code !== null && !isComponentLabel) currentCourse = `${code[1]} ${code[2]}`;

    const kind = parseKind(line);
    if (kind === null || currentCourse === null) continue;

    const days = findDays(line);
    if (days.length === 0) continue;

    const times = line.match(/\d{1,2}[:.]\d{2}\s*[ap]?\.?m?\.?/gi) ?? [];
    const section = /\b(?:LEC|LAB|TUT|TST|SEM|PRJ)\s*[-#]?\s*(\d{2,3})\b/i.exec(line);

    out.push({
      courseCode: currentCourse,
      kind,
      section: section === null ? kind : `${kind} ${section[1]}`,
      pattern: {
        days,
        startMinute: times[0] === undefined ? null : parseClock(times[0]),
        endMinute: times[1] === undefined ? null : parseClock(times[1]),
        location: findLocation(line),
      },
      startsOn: null,
      endsOn: null,
    });
  }

  return dedupe(out);
};

/** Day sets appear as their own token, not buried inside a word. */
const findDays = (line: string): readonly number[] => {
  const token = DAY_TOKEN_RE.exec(line);
  if (token === null) return [];

  const raw = token[1] ?? "";
  // A lone S is ambiguous between Saturday and Sunday, and is far more often
  // an initial. Every other single letter is a real day: a lab that meets
  // only on Wednesday is written W.
  if (raw.toUpperCase() === "S") return [];

  return parseDays(raw);
};

const findLocation = (line: string): string | null => {
  const m = /\b([A-Z]{2,4})\s?(\d{3,4})\b(?!\s*[ap]\.?m)/.exec(line.replace(/\b[A-Z]{2,6}\s?\d{3}[A-Z]?\b/, ' '));
  return m === null ? null : `${m[1]} ${m[2]}`;
};

const dedupe = (meetings: readonly SectionMeeting[]): readonly SectionMeeting[] => {
  const seen = new Map<string, SectionMeeting>();
  for (const m of meetings) {
    seen.set(`${normalizeCode(m.courseCode)}|${m.kind}|${m.section}`, m);
  }
  return [...seen.values()];
};

/**
 * A weekday set standing alone as its own token.
 *
 * Longer spellings come first in the alternation so Th reads as Thursday
 * rather than as Tuesday followed by a stray letter.
 */
const DAY_TOKEN_RE = /(?:^|[\s|,])((?:Th|Tu|We|Su|Sa|Mo|Fr|M|T|W|F|S)+)(?=[\s|,]|$)/;
