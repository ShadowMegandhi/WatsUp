/**
 * Date reading for syllabus text.
 *
 * Hand-rolled rather than a date library, for one reason: every general parser
 * resolves a bare "Oct 14" to whichever October is nearest today. That is the
 * wrong rule here. A Fall syllabus mentioning January means the January after
 * it, and a parser that cannot be told so will be confidently wrong once a
 * term crosses a year boundary.
 *
 * Dates are civil values, not instants, until the very last step. Calling
 * new Date on a bare string is banned: it is timezone-dependent and produces
 * off-by-one-day bugs that stay invisible until a deadline lands on the wrong
 * side of midnight.
 */

export interface CivilDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}

export interface TermContext {
  readonly startYear: number;
  /** 1-12. Fall starts at 9, Winter at 1, Spring at 5. */
  readonly startMonth: number;
  readonly startAt: number;
  readonly endAt: number;
}

export interface FoundDate {
  readonly date: CivilDate;
  /** How much the format alone justifies trusting it, before other signals. */
  readonly confidence: number;
  readonly yearWasExplicit: boolean;
  readonly matched: string;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const DOW: Readonly<Record<string, number>> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

/**
 * Removes things that look like dates but are not, before any date pattern
 * runs. Chapter numbers, page ranges, percentages, money, course codes and
 * clock times are all common in syllabi and all produce false dates if left.
 */
export const maskNonDates = (line: string): string =>
  line
    .replace(/\b(?:ch|chap|chapter|sec|section|pp|p|q|prob|problem)\.?\s*\d+(?:\.\d+)*/gi, ' ')
    .replace(/\b\d{1,3}(?:\.\d+)?\s*%/g, ' ')
    .replace(/\$\s?\d+(?:\.\d{2})?/g, ' ')
    .replace(/\b[A-Z]{2,6}\s?\d{3}[A-Z]?\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}\s*(?:[ap]\.?m\.?)?/gi, ' ')
    .replace(/\bv?\d+\.\d+\b/g, ' ');

export const weekdayOf = (d: CivilDate): number => new Date(d.y, d.m - 1, d.d).getDay();

export const isRealDay = (y: number, m: number, d: number): boolean => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return probe.getMonth() === m - 1 && probe.getDate() === d;
};

/** Civil date to an instant, local time. The only place this conversion happens. */
export const toInstant = (d: CivilDate, hour: number, minute: number): number =>
  new Date(d.y, d.m - 1, d.d, hour, minute, 0, 0).getTime();

/**
 * The hard backstop. A date outside a generous window around the term is
 * dropped no matter how confident everything else was: a copyright year or a
 * textbook publication date landing in a calendar is the worst outcome this
 * feature can produce.
 */
export const withinTerm = (d: CivilDate, term: TermContext): boolean => {
  const at = toInstant(d, 23, 59);
  return at >= term.startAt - 45 * 86_400_000 && at <= term.endAt + 120 * 86_400_000;
};

/**
 * The year rule: walk forward from the start of term. A month earlier in the
 * calendar than the term start has wrapped past December, so it belongs to the
 * following year. A Fall 2026 syllabus reads Oct as 2026 and Jan as 2027.
 */
export const inferYear = (month: number, term: TermContext): number =>
  month < term.startMonth ? term.startYear + 1 : term.startYear;

/** Builds a term window from a course start date, or from today as a fallback. */
export const termFrom = (startAt: number | null, now: number): TermContext => {
  const base = new Date(startAt ?? now);
  const month = base.getMonth() + 1;
  const startMonth = month >= 9 ? 9 : month >= 5 ? 5 : 1;
  const startYear = base.getFullYear();
  const start = new Date(startYear, startMonth - 1, 1).getTime();
  const end = new Date(startYear, startMonth - 1 + 4, 0, 23, 59).getTime();
  return { startYear, startMonth, startAt: start, endAt: end };
};

const statedWeekday = (line: string): number | null => {
  const m = /\b(sun|mon|tues?|thur?s?|wed(?:nes)?|fri|sat)(?:day)?\b/i.exec(line);
  if (m === null) return null;
  return DOW[(m[1] ?? '').toLowerCase()] ?? null;
};

/**
 * A stated weekday is free corroboration. If it disagrees with the inferred
 * year, the adjacent year is tried: a match there means the inference was off
 * and the weekday corrected it. No match leaves the date but drops confidence
 * sharply, because something is wrong and guessing which is not our job.
 */
const reconcileWeekday = (
  date: CivilDate,
  stated: number | null,
  term: TermContext,
): { date: CivilDate; confidence: number } => {
  if (stated === null) return { date, confidence: 0.9 };
  if (weekdayOf(date) === stated) return { date, confidence: 0.97 };

  for (const delta of [1, -1]) {
    const candidate = { ...date, y: date.y + delta };
    if (weekdayOf(candidate) === stated && withinTerm(candidate, term)) {
      return { date: candidate, confidence: 0.93 };
    }
  }

  return { date, confidence: 0.45 };
};

/** Every match of a global pattern, so a non-month can be skipped over. */
const eachMatch = function* (re: RegExp, line: string): Generator<RegExpExecArray> {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m = g.exec(line);
  while (m !== null) {
    yield m;
    m = g.exec(line);
  }
};

/**
 * Finds a date in a line of syllabus text.
 *
 * Only two shapes are accepted: an explicit year, or a month name with a day.
 * Purely numeric forms such as 10/14 are deliberately refused, because they
 * are ambiguous between day-first and month-first and resolving that would be
 * guessing. Refusing them costs a little recall and removes an entire class of
 * silently wrong dates.
 *
 * Each pattern is scanned across the whole line rather than stopping at the
 * first hit. "Tutorial Test 1 Sept 23" offers "Test 1" to a month-day pattern
 * first, and giving up there would either lose the date or, worse, let a later
 * pattern read "1 Sept" and land three weeks early.
 */
export const findDate = (rawLine: string, term: TermContext): FoundDate | null => {
  const line = maskNonDates(rawLine);

  for (const m of eachMatch(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i, line)) {
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (month !== undefined && isRealDay(y, month, d)) {
      return { date: { y, m: month, d }, confidence: 1, yearWasExplicit: true, matched: m[0] };
    }
  }

  for (const m of eachMatch(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i, line)) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    const d = Number(m[1]);
    const y = Number(m[3]);
    if (month !== undefined && isRealDay(y, month, d)) {
      return { date: { y, m: month, d }, confidence: 1, yearWasExplicit: true, matched: m[0] };
    }
  }

  for (const m of eachMatch(/\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i, line)) {
    const month = MONTHS[(m[1] ?? '').toLowerCase()];
    const d = Number(m[2]);
    if (month === undefined) continue;

    const y = inferYear(month, term);
    if (!isRealDay(y, month, d)) continue;

    const adjusted = reconcileWeekday({ y, m: month, d }, statedWeekday(line), term);
    return {
      date: adjusted.date,
      confidence: adjusted.confidence,
      yearWasExplicit: false,
      matched: m[0],
    };
  }

  for (const m of eachMatch(/\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+|-)([a-z]{3,9})\b/i, line)) {
    const month = MONTHS[(m[2] ?? '').toLowerCase()];
    const d = Number(m[1]);
    if (month === undefined) continue;

    const y = inferYear(month, term);
    if (!isRealDay(y, month, d)) continue;

    return { date: { y, m: month, d }, confidence: 0.85, yearWasExplicit: false, matched: m[0] };
  }

  return null;
};
