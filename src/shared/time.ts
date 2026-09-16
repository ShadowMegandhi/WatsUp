/**
 * Time helpers.
 *
 * Two rules hold everywhere in this codebase:
 *   1. Instants are epoch milliseconds. Never a date string.
 *   2. The local timezone is read from the browser, never hardcoded to
 *      Toronto — a student abroad still needs "due today" to mean their today.
 *
 * `now` is always passed in rather than read from the clock, so every
 * derivation is a pure function and therefore testable without faking time.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

export const localTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Midnight at the start of the local day containing `at`. */
export const startOfLocalDay = (at: number): number => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const addDays = (at: number, days: number): number => {
  const d = new Date(at);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

/** True when both instants fall on the same local calendar day. */
export const isSameLocalDay = (a: number, b: number): boolean =>
  startOfLocalDay(a) === startOfLocalDay(b);

/**
 * Whole local days from the start of `from`'s day to the start of `to`'s day.
 * Computed on day boundaries rather than by dividing the raw difference, so a
 * DST transition cannot produce 0.958 days and round the wrong way.
 */
export const localDaysBetween = (from: number, to: number): number =>
  Math.round((startOfLocalDay(to) - startOfLocalDay(from)) / MS_PER_DAY);

/** The half-open window [today 00:00, +days) used by "this week". */
export const weekWindow = (
  now: number,
  days: number,
): { readonly start: number; readonly end: number } => {
  const start = startOfLocalDay(now);
  return { start, end: addDays(start, days) };
};

/** ISO-8601 in UTC, which is what the Valence API expects for date filters. */
export const toUtcIso = (at: number): string => new Date(at).toISOString();

/** Parses a Valence UTCDateTime. Returns null rather than NaN on garbage. */
export const parseUtcDateTime = (value: string | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
};
