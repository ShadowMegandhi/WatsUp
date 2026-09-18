/**
 * Reading real, dated events out of a calendar page.
 *
 * This exists because deriving lab dates from a weekly pattern is wrong. Labs
 * are routinely biweekly, skip reading week, start in the second week, or run
 * on a published list of one-off dates. Counting "the third Wednesday" drifts
 * away from reality and does so silently, which is the worst way to be wrong
 * about a deadline.
 *
 * An actual calendar already knows when each session is. Reading the dates it
 * states is both more correct and less machinery.
 *
 * Pure, so it can be tested against captured text without a browser.
 */

import { parseClock } from './parse';
import { normalizeCode, type ComponentKind } from '@core/schedule/types';

export interface DatedEvent {
  readonly title: string;
  readonly courseCode: string | null;
  readonly kind: ComponentKind | null;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly location: string | null;
  readonly sourceLine: string;
}

const MONTHS: Readonly<Record<string, number>> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const KIND_WORDS: readonly (readonly [RegExp, ComponentKind])[] = [
  [/\blab(oratory)?\b/i, 'LAB'],
  [/\btutorial\b|\btut\b/i, 'TUT'],
  [/\blecture\b|\blec\b/i, 'LEC'],
  [/\btest\b|\bmidterm\b|\bexam\b/i, 'TST'],
  [/\bseminar\b|\bsem\b/i, 'SEM'],
];

/**
 * Finds a full date such as "Friday, September 18, 2026" or "Sep 18, 2026".
 *
 * A year is required. A calendar that prints one is stating a fact; inferring
 * one here would reintroduce exactly the guesswork this file exists to avoid.
 */
export const findFullDate = (line: string): { y: number; m: number; d: number } | null => {
  const withComma = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(line);
  if (withComma !== null) {
    const m = MONTHS[(withComma[1] ?? '').toLowerCase()];
    const d = Number(withComma[2]);
    const y = Number(withComma[3]);
    if (m !== undefined && isReal(y, m, d)) return { y, m, d };
  }

  const dayFirst = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(line);
  if (dayFirst !== null) {
    const m = MONTHS[(dayFirst[2] ?? '').toLowerCase()];
    const d = Number(dayFirst[1]);
    const y = Number(dayFirst[3]);
    if (m !== undefined && isReal(y, m, d)) return { y, m, d };
  }

  return null;
};

const isReal = (y: number, m: number, d: number): boolean => {
  const probe = new Date(y, m - 1, d);
  return probe.getMonth() === m - 1 && probe.getDate() === d;
};

export const findKind = (text: string): ComponentKind | null => {
  for (const [re, kind] of KIND_WORDS) if (re.test(text)) return kind;
  return null;
};

export const findCourseCode = (text: string): string | null => {
  const m = /\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b/.exec(text.toUpperCase());
  if (m === null) return null;
  if (/^(LEC|LAB|TUT|TST|SEM|PRJ)$/.test(m[1] ?? '')) return null;
  return `${m[1]} ${m[2]}`;
};

/** A window of lines, since a calendar entry spans several. */
const CONTEXT_BEFORE = 3;
const CONTEXT_AFTER = 2;

/**
 * Scans text for entries carrying an explicit date.
 *
 * A calendar entry spans several lines: a title, then a date, then times. The
 * date is the anchor, and the lines around it supply the rest.
 */
export const parseDatedEvents = (text: string): readonly DatedEvent[] => {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '');

  const out: DatedEvent[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const date = findFullDate(line);
    if (date === null) continue;

    const before = lines.slice(Math.max(0, i - CONTEXT_BEFORE), i);
    const after = lines.slice(i + 1, i + 1 + CONTEXT_AFTER);
    const context = [...before, line, ...after].join(' ');

    const times = context.match(/\d{1,2}[:.]\d{2}\s*[ap]?\.?m?\.?/gi) ?? [];
    const start = times[0] === undefined ? null : parseClock(times[0]);
    const end = times[1] === undefined ? null : parseClock(times[1]);

    out.push({
      title: pickTitle(before, line),
      courseCode: findCourseCode(context),
      kind: findKind(context),
      startsAt: at(date, start),
      endsAt: end === null ? null : at(date, end),
      location: null,
      sourceLine: line,
    });
  }

  return dedupe(out);
};

/** The nearest preceding line that reads like a name rather than metadata. */
const pickTitle = (before: readonly string[], dateLine: string): string => {
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const candidate = before[i] ?? '';
    if (candidate.length < 4 || candidate.length > 140) continue;
    if (/^(organized by|status|units|grading|class nbr)/i.test(candidate)) continue;
    if (findFullDate(candidate) !== null) continue;
    return candidate;
  }
  return dateLine;
};

const at = (d: { y: number; m: number; d: number }, minute: number | null): number =>
  new Date(d.y, d.m - 1, d.d, 0, minute ?? 0, 0, 0).getTime();

const dedupe = (events: readonly DatedEvent[]): readonly DatedEvent[] => {
  const seen = new Map<string, DatedEvent>();
  for (const e of events) {
    seen.set(`${e.startsAt}|${normalizeCode(e.courseCode ?? '')}|${e.kind ?? ''}|${e.title}`, e);
  }
  return [...seen.values()].sort((a, b) => a.startsAt - b.startsAt);
};

/**
 * The nth time a component actually meets, from real dates rather than from a
 * weekly pattern. This is what makes "Lab 3" correct when labs are biweekly or
 * skip a week.
 */
export const nthActual = (
  events: readonly DatedEvent[],
  courseCode: string,
  kind: ComponentKind,
  n: number,
): DatedEvent | null => {
  if (n < 1) return null;

  const wanted = normalizeCode(courseCode);
  const matching = events
    .filter((e) => e.kind === kind && normalizeCode(e.courseCode ?? '') === wanted)
    .sort((a, b) => a.startsAt - b.startsAt);

  return matching[n - 1] ?? null;
};
