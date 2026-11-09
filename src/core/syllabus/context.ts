/**
 * Reading an outline as a whole.
 *
 * The line reader (extract.ts) dates an assessment only from its own line.
 * Outlines often split that across the document instead: a schedule row puts
 * "Quiz 2" in week 7, the week's row or heading gives its dates, and a
 * paragraph elsewhere says "quizzes are written on Mondays at 5:30". This
 * file puts those together.
 *
 * What it will and will not do:
 *   - A week number or a week's date span places an assessment in a week.
 *   - A weekly rule for that kind of assessment ("quizzes ... Mondays")
 *     picks the day, and its time if it gives one.
 *   - With no rule naming its day, the item is left out: a week is several
 *     dates, and picking one would be a guess.
 *   - Only weeks the outline itself dates are used; weeks are never counted
 *     forward from another one.
 *   - A rule naming two different days picks nothing, and a written date
 *     for the same assessment always wins over a placed one.
 *   - A week label applies to the rows under it in its own table only.
 *
 * Every placed item keeps the lines it came from, so the panel can show
 * exactly what it was read from.
 */

import type { TaskKind } from '../types';
import type { Candidate } from './extract';
import { TABLE_END, TABLE_START } from './tables';
import {
  ASSESSMENT_TERMS,
  CONTEXT_VETO_TERMS,
  NOT_A_DEADLINE_TERMS,
  REVIEW_PREFIXES,
  TOPIC_WORDS,
  UNGRADED_TERMS,
  VETO_TERMS,
  WINDOW_TERMS,
  pluralOf,
} from './lexicon';
import { findDate, toInstant, weekdayOf, withinTerm, type CivilDate, type TermContext } from './dates';
import {
  buildTitle,
  cellAround,
  containsWord,
  findMentions,
  isNegated,
  readWeight,
  isWeekStart,
  tidy,
  type Mention,
} from './mentions';

export interface Rule {
  readonly kind: TaskKind;
  /** 0 = Sunday ... 6 = Saturday. */
  readonly weekday: number;
  readonly h: number | null;
  readonly m: number | null;
  readonly line: string;
}

interface Span {
  readonly start: CivilDate;
  readonly end: CivilDate;
}

/** No undergraduate term runs past this many weeks. */
const MAX_WEEK = 16;

/** A placed line longer than this is prose, not a schedule row. */
const MAX_PLACED_LINE = 800;

/** A rule is one sentence. */
const MAX_RULE_LINE = 300;

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// --- civil date arithmetic -------------------------------------------------

const addDays = (d: CivilDate, n: number): CivilDate => {
  const at = new Date(d.y, d.m - 1, d.d + n);
  return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() };
};

const mondayOf = (d: CivilDate): CivilDate => addDays(d, -((weekdayOf(d) + 6) % 7));

const dayNumber = (d: CivilDate): number => Date.UTC(d.y, d.m - 1, d.d) / 86_400_000;

const within = (d: CivilDate, span: Span): boolean =>
  dayNumber(d) >= dayNumber(span.start) && dayNumber(d) <= dayNumber(span.end);

const weekFrom = (monday: CivilDate): Span => ({ start: monday, end: addDays(monday, 6) });

// --- weeks -------------------------------------------------------------------

const monthNumber = (word: string): number | null => {
  const i = MONTH_ABBR.findIndex((m) => word.toLowerCase().startsWith(m.toLowerCase()));
  return i < 0 ? null : i + 1;
};

/** "Oct 19 - 23", "Oct 30 - Nov 3", "Sept 8 to 11": a span, else null. */
const readSpan = (text: string, term: TermContext): Span | null => {
  const found = findDate(text, term);
  if (found === null || found.confidence < 0.85) return null;
  // "Week of Nov 9": the whole week that day starts.
  if (isWeekStart(text, found.matched)) return weekFrom(mondayOf(found.date));

  const at = text.indexOf(found.matched);
  const after = at < 0 ? '' : text.slice(at + found.matched.length);
  const range = /^\s*(?:-|–|—|to|through|until)\s*(?:([a-z]{3,9})\.?\s+)?(\d{1,2})\b(?!\s*%)/i.exec(after);
  if (range === null) return null;

  const endMonth = range[1] === undefined ? found.date.m : monthNumber(range[1]);
  if (endMonth === null) return null;
  const endYear = endMonth < found.date.m ? found.date.y + 1 : found.date.y;
  const end = { y: endYear, m: endMonth, d: Number(range[2]) };

  const length = dayNumber(end) - dayNumber(found.date);
  return length >= 0 && length <= 7 ? { start: found.date, end } : null;
};

const cellsOf = (line: string): readonly string[] =>
  line.split('|').map((c) => c.trim()).filter((c) => c !== '');

const valid = (n: number): number | null => (n >= 1 && n <= MAX_WEEK ? n : null);

const HEADING = /^\s*(?:week|wk)\.?\s*#?\s*(\d{1,2})\b/i;

/** The week a schedule row or heading is about: "| 7 | ...", "Week 7 (...)". */
const weekOfHeading = (line: string): number | null => {
  const heading = HEADING.exec(line);
  if (heading !== null) return valid(Number(heading[1]));

  if (!line.includes('|')) return null;
  const cell = /^(?:week|wk)?\.?\s*(\d{1,2})$/i.exec(cellsOf(line)[0] ?? '');
  return cell === null ? null : valid(Number(cell[1]));
};

/** "during week 3", "Week 3:" anywhere in a line. */
const weekMentioned = (line: string): number | null => {
  const m = /\bweek\s*#?\s*(\d{1,2})\b/i.exec(line);
  return m === null ? null : valid(Number(m[1]));
};

/**
 * The Monday of each week the outline dates.
 *
 * A numbered table row counts only with a date span ("| 7 | Oct 19 - 23 |"),
 * or when it names no assessment: in a grading table "| 1 | Quiz | Oct 2 |"
 * numbers the quiz, not the week.
 */
export const buildWeekMap = (lines: readonly string[], term: TermContext): ReadonlyMap<number, CivilDate> => {
  const map = new Map<number, CivilDate>();

  for (const raw of lines) {
    const line = tidy(raw);
    const n = weekOfHeading(line);
    if (n === null || map.has(n)) continue;
    // "| 10 | 20% | Nov 20 |" numbers a grading-table row, not a week.
    if (/%/.test(line)) continue;

    const span = readSpan(line, term);
    if (span !== null) {
      map.set(n, mondayOf(span.start));
      continue;
    }

    const isHeading = HEADING.test(line);
    const namesWork = findMentions(line.toLowerCase()).length > 0;
    const single = findDate(line, term);
    if (single !== null && single.confidence >= 0.85 && (isHeading || !namesWork)) {
      map.set(n, mondayOf(single.date));
    }
  }

  return map;
};

/** Week n's Monday, only when the outline dates that week itself. */
const mondayOfWeek = (map: ReadonlyMap<number, CivilDate>, n: number): CivilDate | null => map.get(n) ?? null;

// --- weekly rules ------------------------------------------------------------

const WEEKDAY = /\b(sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?(s)?\b\.?/gi;

const WEEKDAY_NUMBER: Readonly<Record<string, number>> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, wednes: 3, thu: 4, thur: 4, thurs: 4, thus: 4, fri: 5, sat: 6, satur: 6,
};

const RECURRING = /\b(every|each|weekly)\b/i;

/** Words that say when an assessment happens, not just that it exists. */
const SCHEDULING =
  /\b(?:every|each|weekly|due|held|written|given|scheduled|take place|takes place|run|runs|are on|is on|occur|occurs)\b/i;

const CLOCK = /\b(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?/gi;

/** The am/pm a range carries at its end: "5:30-6:20 pm". */
const RANGE_TAIL = /^\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*([ap])\.?m/i;

const to24 = (hour: number, pm: boolean): number => (hour % 12) + (pm ? 12 : 0);

/**
 * A class time. "5:30" with no am or pm is read as a class would be held:
 * 8 to 11 in the morning, 12 to 7 in the afternoon or evening.
 */
export const readClock = (line: string): { h: number; m: number } | null => {
  for (const hit of line.matchAll(CLOCK)) {
    const hour = Number(hit[1]);
    const minute = hit[2] === undefined ? null : Number(hit[2]);
    const suffix = (hit[3] ?? '').toLowerCase();
    // A bare number with neither minutes nor am/pm is a count, not a time.
    if (minute === null && suffix === '') continue;
    if (hour > 23 || (minute ?? 0) > 59) continue;

    if (suffix !== '') {
      if (hour < 1 || hour > 12) continue;
      return { h: to24(hour, suffix === 'p'), m: minute ?? 0 };
    }

    if (hour > 12) return { h: hour, m: minute ?? 0 };
    const tail = RANGE_TAIL.exec(line.slice((hit.index ?? 0) + hit[0].length));
    if (tail !== null) return { h: to24(hour, (tail[1] ?? '').toLowerCase() === 'p'), m: minute ?? 0 };
    return { h: hour >= 8 && hour <= 11 ? hour : to24(hour, true), m: minute ?? 0 };
  }
  return null;
};

/** The assessment kind a rule line is about, singular or plural. */
const ruleKind = (lower: string): { kind: TaskKind; plural: boolean; at: number } | null => {
  const sorted = [...ASSESSMENT_TERMS].sort((a, b) => b.term.length - a.term.length);
  for (const { term, kind } of sorted) {
    const plural = containsWord(lower, pluralOf(term));
    if (plural >= 0) return { kind, plural: true, at: plural };
    const single = containsWord(lower, term);
    if (single >= 0) return { kind, plural: false, at: single };
  }
  return null;
};

const ruleFrom = (raw: string): Rule | null => {
  const line = tidy(raw);
  const lower = line.toLowerCase();
  if (line.length > MAX_RULE_LINE) return null;
  if (VETO_TERMS.some((t) => lower.includes(t))) return null;
  if (CONTEXT_VETO_TERMS.some((t) => lower.includes(t))) return null;
  if (UNGRADED_TERMS.some((t) => lower.includes(t))) return null;

  const about = ruleKind(lower);
  if (about === null || isNegated(lower, about.at)) return null;

  const days = [...line.matchAll(WEEKDAY)];
  const distinct = new Set(days.map((d) => WEEKDAY_NUMBER[(d[1] ?? '').toLowerCase()]));
  const weekday = distinct.size === 1 ? [...distinct][0] : undefined;
  if (weekday === undefined) return null;

  const repeats = about.plural || days.some((d) => d[2] !== undefined) || RECURRING.test(line);
  if (!repeats) return null;

  // "Students do quizzes on Mondays when ready" is advice; a rule says when
  // the assessment is held or due, or gives its time.
  const clock = readClock(line);
  if (clock === null && !SCHEDULING.test(line)) return null;
  return { kind: about.kind, weekday, h: clock?.h ?? null, m: clock?.m ?? null, line };
};

/**
 * Weekly rules: "Quizzes are written on Mondays at 5:30", "Labs are due
 * every Friday at 11:59 pm". A rule names one kind of assessment, exactly
 * one weekday, and something that says it repeats. Two rules giving one
 * kind different days cancel out.
 */
export const readRules = (lines: readonly string[]): readonly Rule[] => {
  const byKind = new Map<TaskKind, Rule | 'conflict'>();

  for (const raw of lines) {
    const rule = ruleFrom(raw);
    if (rule === null) continue;
    const prior = byKind.get(rule.kind);
    if (prior === undefined) byKind.set(rule.kind, rule);
    else if (prior !== 'conflict' && prior.weekday !== rule.weekday) byKind.set(rule.kind, 'conflict');
  }

  return [...byKind.values()].filter((r): r is Rule => r !== 'conflict');
};

// --- placing -------------------------------------------------------------------

/** Window words, less the ones that are exactly what a week reference is. */
const PLACING_WINDOW_TERMS = WINDOW_TERMS.filter(
  (t) => !['week of', 'week beginning', 'week starting', 'week commencing', 'midterm week', 'exam week'].includes(t),
);


const nameCellIsUsable = (line: string, at: number): boolean => {
  const cell = (line.includes('|') ? cellAround(line, at) : line).toLowerCase();
  if (TOPIC_WORDS.test(cell)) return false;
  if (CONTEXT_VETO_TERMS.some((t) => cell.includes(t))) return false;
  if (UNGRADED_TERMS.some((t) => cell.includes(t))) return false;
  if (REVIEW_PREFIXES.some((t) => cell.includes(t))) return false;
  if (NOT_A_DEADLINE_TERMS.some((t) => containsWord(cell, t) >= 0)) return false;
  return !PLACING_WINDOW_TERMS.some((t) => containsWord(cell, t) >= 0);
};

/** A date on the line that is not part of a span, which the line reader owns. */
const hasOwnDate = (line: string, term: TermContext): boolean => {
  let rest = line;
  for (let i = 0; i < 6; i += 1) {
    const found = findDate(rest, term);
    if (found === null) return false;
    const at = rest.indexOf(found.matched);
    const after = rest.slice(at + found.matched.length);
    // "Week of Nov 9" names a week, which is placed like any other week.
    if (isWeekStart(rest, found.matched)) {
      rest = rest.slice(0, at) + ' ' + after;
      continue;
    }
    const range = /^\s*(?:-|–|—|to|through|until)\s*(?:[a-z]{3,9}\.?\s+)?\d{1,2}\b/i.exec(after);
    if (range === null) return true;
    // "Oct 26 - Nov 1" is one span: drop its end date too, or "Nov 1" would
    // read as a date of its own.
    rest = rest.slice(0, at) + ' ' + after.slice(range[0].length);
  }
  return false;
};

const numberIn = (title: string): string | null => /\b([0-9]{1,2})\b/.exec(title)?.[1] ?? null;

/** A written date for the same assessment wins over a placed one. */
const alreadyDated = (known: readonly Candidate[], kind: TaskKind, title: string, span: Span): boolean => {
  const n = numberIn(title);
  return known.some((c) => {
    if (c.kind !== kind) return false;
    const cn = numberIn(c.title);
    if (n !== null && cn !== null) return n === cn;
    return within(c.date, span);
  });
};

/** The week a line is about, from the line itself or the heading above it. */
const weekFor = (
  line: string,
  heading: Span | null,
  map: ReadonlyMap<number, CivilDate>,
  term: TermContext,
): Span | null => {
  const own = readSpan(line, term);
  if (own !== null) return own;

  const n = weekMentioned(line) ?? weekOfHeading(line);
  if (n !== null) {
    const monday = mondayOfWeek(map, n);
    return monday === null ? null : weekFrom(monday);
  }
  return heading;
};

/** A heading line's week, to carry down to the lines under it. */
const headingSpan = (line: string, map: ReadonlyMap<number, CivilDate>, term: TermContext): Span | null => {
  const span = readSpan(line, term);
  if (span !== null) return span;
  const n = weekOfHeading(line);
  const monday = n === null ? null : mondayOfWeek(map, n);
  return monday === null ? null : weekFrom(monday);
};

/** A name's own words: up to the next name, or the end of its table cell. */
const ownText = (line: string, mentions: readonly Mention[], k: number): string => {
  const at = mentions[k]?.at ?? 0;
  const next = mentions[k + 1]?.at ?? line.length;
  const cellEnd = line.indexOf('|', at);
  return line.slice(at, Math.min(next, cellEnd < 0 ? line.length : cellEnd));
};

/**
 * The rule's weekday inside the week, or null. With no rule, or a rule day
 * outside the week's dates (a short week), there is no one day to give.
 */
const place = (span: Span, rule: Rule | undefined): CivilDate | null => {
  if (rule === undefined) return null;
  const day = addDays(mondayOf(span.start), (rule.weekday + 6) % 7);
  return within(day, span) ? day : null;
};

/**
 * A line that only labels a week ("Week 7 (Oct 19 - 23)", a table row
 * "| 7 | Oct 19 - 23 |") sets the week for the lines under it.
 */
const labelsAWeek = (line: string, term: TermContext): boolean =>
  findMentions(line.toLowerCase()).length === 0 &&
  (HEADING.test(line) ||
    (line.includes('|') && weekOfHeading(line) !== null) ||
    (line.includes('|') && readSpan(line, term) !== null && cellsOf(line).length <= 3) ||
    // "Week of Nov 9" on a line of its own.
    (WEEK_LINE.test(line) && readSpan(line, term) !== null));

/** A line that opens with a week: "Week of Nov 9", "W/O Nov 9". */
const WEEK_LINE = /^\s*(?:week|wk\.?|w\/o)\b/i;

/**
 * Assessments the line reader could not date, placed by week and rule.
 *
 * `skip` holds the lines the line reader already used, so nothing is read
 * twice; `direct` is what it found, so a written date always wins.
 */
export const placeByContext = (
  lines: readonly string[],
  term: TermContext,
  direct: readonly Candidate[],
  skip: ReadonlySet<number>,
): readonly Candidate[] => {
  const map = buildWeekMap(lines, term);
  const rules = readRules(lines);
  const ruleLines = new Set(rules.map((r) => r.line));
  const out: Candidate[] = [];
  let heading: Span | null = null;

  lines.forEach((raw, i) => {
    const line = tidy(raw);
    const lower = line.toLowerCase();

    // A table's week labels stop at the end of that table.
    if (line === TABLE_START || line === TABLE_END) {
      heading = null;
      return;
    }
    // A heading sets the week for the lines under it, until the next one.
    if (labelsAWeek(line, term)) heading = headingSpan(line, map, term);

    // A line the line reader already used can still hold another name with
    // no date of its own: "Midterm: Nov 2 at 5pm ... Lab 6: functions".
    const wasRead = skip.has(i);
    if (ruleLines.has(line) || line.length > MAX_PLACED_LINE) return;
    if (VETO_TERMS.some((t) => lower.includes(t))) return;
    if (!wasRead && hasOwnDate(line, term)) return;

    const mentions = findMentions(lower).filter((m) => !isNegated(lower, m.at));
    if (mentions.length === 0) return;

    const week = weekFor(line, heading, map, term);
    if (week === null) return;

    mentions.forEach((mention, k) => {
      if (wasRead && findDate(ownText(line, mentions, k), term) !== null) return;
      if (!nameCellIsUsable(line, mention.at)) return;
      const own = ownText(line, mentions, k);
      const title = buildTitle(own, mention.term, '');
      if (alreadyDated([...direct, ...out], mention.kind, title, week)) return;

      const rule = rules.find((r) => r.kind === mention.kind);
      const day = place(week, rule);
      if (day === null || rule === undefined || !withinTerm(day, term)) return;

      out.push({
        title,
        kind: mention.kind,
        date: day,
        dueAt: toInstant(day, rule.h ?? 23, rule.m ?? 59),
        hasTime: rule.h !== null,
        weightPct: readWeight(own),
        sourceLine: `${line} · ${rule.line}`,
        matchedTerm: mention.term,
      });
    });
  });

  return out;
};
