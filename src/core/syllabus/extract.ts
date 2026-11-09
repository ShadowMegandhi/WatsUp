/**
 * Reading dated assessments out of syllabus lines.
 *
 * The rule the whole file serves: do not guess. A line becomes an item only
 * when all of these hold, and any one failure drops it with no scoring and no
 * second chance:
 *
 *   1. It names an assessment: an exam, test, quiz, assignment, lab,
 *      project and so on (see ASSESSMENT_TERMS).
 *   2. It carries one complete date on that same line. Two dates are allowed
 *      only when exactly one of them is marked as the due date.
 *   3. That date is not a range, sits inside the term, and agrees with any
 *      weekday written beside it.
 *   4. Nothing says it is a window, a placeholder, a release rather than a
 *      deadline, a review session, ungraded, or not happening. In a table
 *      row only the cells naming and dating the assessment are checked, so
 *      a notes column cannot veto a real quiz.
 *
 * An outline that puts the name and the date on neighbouring lines (a PDF
 * cell that wrapped, a heading over a "Due: Nov 13" line) is read as one
 * line, but only when the neighbour is nothing but a date.
 *
 * Until v0.4 this read midterms and exams only. In-class quizzes and other
 * dated work that never appears in a LEARN tool were being missed, so the
 * vocabulary widened; the date rules did not loosen.
 */

import type { TaskKind } from '../types';
import {
  CONTEXT_VETO_TERMS,
  NOT_A_DEADLINE_TERMS,
  REVIEW_PREFIXES,
  UNGRADED_TERMS,
  VETO_TERMS,
  WINDOW_TERMS,
} from './lexicon';
import {
  findDate,
  toInstant,
  withinTerm,
  type CivilDate,
  type FoundDate,
  type TermContext,
} from './dates';
import { placeByContext } from './context';
import {
  buildTitle,
  cellAround,
  containsWord,
  findMentions,
  isNegated,
  readWeight,
  isWeekStart,
  markWeekColumns,
  tidy,
  type Mention,
} from './mentions';

export { buildTitle, containsWord, readWeight };

export interface Candidate {
  readonly title: string;
  readonly kind: TaskKind;
  readonly date: CivilDate;
  readonly dueAt: number;
  /** A clock time was written with the date; otherwise it is all-day. */
  readonly hasTime: boolean;
  readonly weightPct: number | null;
  readonly sourceLine: string;
  readonly matchedTerm: string;
}

/** A weekday that disagrees with the date drops the format score below this. */
const MIN_DATE_CONFIDENCE = 0.85;

/** At most this many dates are looked for on one line. */
const MAX_DATES_PER_LINE = 4;

/** A schedule row with a long notes cell is still one row. */
const MAX_LINE_LENGTH = 800;

/** A line naming an assessment without a date is a name, not prose. */
const MAX_NAME_LINE = 120;

/** What a date-only line may carry besides its date: "Due:", "Friday,". */
const MAX_DATE_LINE_EXTRA = 12;

export const extractAssessments = (
  given: readonly string[],
  term: TermContext,
): readonly Candidate[] => {
  const lines = markWeekColumns(given);
  const out: Candidate[] = [];
  // A date line lends its date to one name only.
  const claimed = new Set<number>();
  // Lines already read, which the whole-document pass leaves alone.
  const used = new Set<number>();

  lines.forEach((raw, i) => {
    const direct = readLine(raw, term);
    if (direct.length > 0) {
      out.push(...direct);
      used.add(i);
      return;
    }
    const split = readSplit(lines, i, term, claimed);
    if (split !== null) {
      claimed.add(split.used);
      used.add(i).add(split.used);
      out.push(...split.found);
    }
  });

  // What no single line dates, the outline as a whole may: a week in the
  // schedule plus a rule like "quizzes are on Mondays at 5:30".
  const placed = placeByContext(lines, term, out, used);

  return disambiguate(dropConflicts(dedupe([...out, ...placed])));
};

/**
 * A name on one line and its date alone on the next (or the line before).
 * The pair is read as one table row, so every rule still applies to it.
 */
const readSplit = (
  lines: readonly string[],
  i: number,
  term: TermContext,
  claimed: ReadonlySet<number>,
): { found: readonly Candidate[]; used: number } | null => {
  const line = tidy(lines[i] ?? '');
  // A table row is whole on its own: its date is in its own cells or it has
  // none. Pairing is only for text a page or PDF wrapped across lines.
  if (line.includes('|')) return null;
  if (line.length > MAX_NAME_LINE || findDate(line, term) !== null) return null;

  const lower = line.toLowerCase();
  const named = findMentions(lower).filter((m) => !isNegated(lower, m.at));
  if (named.length !== 1) return null;

  const order = pairingOrder(lines, i, term, claimed);
  if (order === null) return null;

  for (const j of order) {
    if (claimed.has(j)) continue;
    const near = tidy(lines[j] ?? '');
    if (!isBareDateLine(near, term)) continue;

    const joined = j > i ? `${line} | ${near}` : `${near} | ${line}`;
    const found = readLine(joined, term);
    if (found.length > 0) return { found, used: j };
  }
  return null;
};

const namesOne = (raw: string | undefined): boolean => {
  const lower = tidy(raw ?? '').toLowerCase();
  return findMentions(lower).filter((m) => !isNegated(lower, m.at)).length === 1;
};

/**
 * Which neighbouring lines may lend line i their date, in the order to try.
 *
 * With a free date line on both sides the layout decides: names following
 * their dates ("Oct 10 / Quiz 1 / Oct 24 / Quiz 2") take the line above,
 * names followed by their dates take the line below. When the layout does
 * not say, nothing is paired, because either choice could be a wrong date.
 */
const pairingOrder = (
  lines: readonly string[],
  i: number,
  term: TermContext,
  claimed: ReadonlySet<number>,
): readonly number[] | null => {
  const free = (j: number): boolean => !claimed.has(j) && isBareDateLine(tidy(lines[j] ?? ''), term);
  const above = free(i - 1);
  const belowFree = free(i + 1);

  // Two date lines below a name are usually "Released: ..." then "Due: ...";
  // the second is looked at only when the first is a date line too.
  const below = belowFree ? [i + 1, i + 2] : [i + 1];

  if (!above || !belowFree) return [...below, i - 1];
  if (namesOne(lines[i + 2])) return [i - 1];
  if (namesOne(lines[i - 2])) return below;
  return null;
};

/** "Friday, November 13", "Due: Nov 13 at 11:59 pm", and nothing more. */
const isBareDateLine = (line: string, term: TermContext): boolean => {
  if (line === '' || line.includes('|')) return false;
  const found = findDate(line, term);
  if (found === null) return false;
  if (findMentions(line.toLowerCase()).length > 0) return false;
  // "Week of Nov 9" heads a week; it dates nothing under it.
  if (isWeekStart(line, found.matched)) return false;

  const extra = line
    .replace(found.matched, ' ')
    .replace(/\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?/gi, ' ')
    .replace(/\b(?:sun|mon|tues?|wed(?:nes)?|thur?s?|fri|sat(?:ur)?)(?:day)?\b/gi, ' ')
    .replace(/\b(?:due|date|deadline|on|by|at|before|until|submit|submission|in class)\b/gi, ' ')
    .replace(/[^a-z]/gi, '');
  return extra.length <= MAX_DATE_LINE_EXTRA;
};

/** The first assessment read from a line, or null. Kept for focused tests. */
export const readAssessmentLine = (raw: string, term: TermContext): Candidate | null =>
  readLine(raw, term)[0] ?? null;

export const readLine = (raw: string, term: TermContext): readonly Candidate[] => {
  const line = tidy(raw);
  if (line.length < 6 || line.length > MAX_LINE_LENGTH) return [];

  const lower = line.toLowerCase();

  // Breaks and registrar dates veto the whole row: it is not coursework.
  if (VETO_TERMS.some((t) => lower.includes(t))) return [];

  const mentions = findMentions(lower).filter((m) => !isNegated(lower, m.at));
  if (mentions.length === 0) return [];

  const found = pickDate(line, term);
  if (found === null) return readEachMention(line, mentions, term);

  // With several assessments on one line, a single percentage could belong
  // to any of them, so it is attached only when there is one.
  const weight = mentions.length === 1 ? readWeight(line) : null;
  const time = mentions.length === 1 ? readTime(line, found.matched) : null;

  return mentions.filter((m) => passesScopedRules(line, m.at, found.matched)).map((m) => ({
    title: buildTitle(line, m.term, found.matched),
    kind: m.kind,
    date: found.date,
    // Without a stated time it is shown as all-day; 23:59 keeps it sorting
    // last on its day.
    dueAt: toInstant(found.date, time?.h ?? 23, time?.m ?? 59),
    hasTime: time !== null,
    weightPct: weight,
    sourceLine: line,
    matchedTerm: m.term,
  }));
};

/**
 * The fallback when a whole line is ambiguous: read each assessment with
 * only the text that follows its own name, up to the next name or the end
 * of its table cell.
 *
 * A weekly schedule row carries the week's span ("Nov 2 - 6") as well as
 * the note "Midterm Exam: Monday November 2 at 5:00pm", so the line as a
 * whole has two dates and is rightly refused. The midterm's own words name
 * exactly one, though, and reading that is not a guess. A mention whose own
 * text has no date ("Lab 6: functions") still yields nothing.
 */
const readEachMention = (
  line: string,
  mentions: readonly Mention[],
  term: TermContext,
): readonly Candidate[] => {
  const out: Candidate[] = [];

  mentions.forEach((m, i) => {
    const nextMention = mentions[i + 1]?.at ?? line.length;
    const cellEnd = line.indexOf('|', m.at);
    const end = Math.min(nextMention, cellEnd < 0 ? line.length : cellEnd);
    const own = line.slice(m.at, end);

    const found = pickDate(own, term);
    if (found === null) return;
    if (!passesScopedRules(line, m.at, found.matched)) return;

    const time = readTime(own, found.matched);
    out.push({
      title: buildTitle(own, m.term, found.matched),
      kind: m.kind,
      date: found.date,
      dueAt: toInstant(found.date, time?.h ?? 23, time?.m ?? 59),
      hasTime: time !== null,
      weightPct: readWeight(own),
      sourceLine: line,
      matchedTerm: m.term,
    });
  });

  return out;
};

/**
 * The text an assessment is read from. In a table row that is the cell
 * naming it and the cell dating it; elsewhere, the whole line.
 */
const scopeOf = (line: string, mentionAt: number, dateText: string): string => {
  if (!line.includes('|')) return line;
  const fromMention = line.indexOf(dateText, mentionAt);
  const dateAt = fromMention >= 0 ? fromMention : Math.max(0, line.indexOf(dateText));
  return `${cellAround(line, mentionAt)} ${cellAround(line, dateAt)}`;
};

/**
 * Logistics, ungraded work, review sessions, windows and release dates,
 * checked against the assessment's own text. A release word does not veto
 * a date the line marks as the due date: "posted Oct 30, due Nov 13".
 */
const passesScopedRules = (line: string, mentionAt: number, dateText: string): boolean => {
  // Logistics words veto only the cell naming the assessment: a date cell
  // reading "Oct 22, 7 pm, see accommodations" is still the midterm's date.
  const nameText = (line.includes('|') ? cellAround(line, mentionAt) : line).toLowerCase();
  if (CONTEXT_VETO_TERMS.some((t) => nameText.includes(t))) return false;

  const scope = scopeOf(line, mentionAt, dateText).toLowerCase();
  if (UNGRADED_TERMS.some((t) => scope.includes(t))) return false;
  if (REVIEW_PREFIXES.some((t) => scope.includes(t))) return false;
  // Word-bounded, because "tba" can sit inside other words.
  if (WINDOW_TERMS.some((t) => containsWord(scope, t) >= 0)) return false;
  if (NOT_A_DEADLINE_TERMS.some((t) => containsWord(scope, t) >= 0) && !isMarkedDue(line, dateText)) {
    return false;
  }
  return true;
};

/**
 * A clock time written just after the date ("November 2 at 5:00pm",
 * "Oct 23, 7 pm"). Needs am/pm, so a bare "10.1" or a room number is never
 * read as a time, and a span ("2:30-4:20pm") is refused rather than picking
 * an end.
 */
export const readTime = (text: string, dateText: string): { h: number; m: number } | null => {
  const at = text.indexOf(dateText);
  if (at < 0) return null;
  const after = text.slice(at + dateText.length, at + dateText.length + 30);

  const m = /^[^|]*?\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])/i.exec(after);
  if (m === null) return null;

  const before = after.slice(0, m.index + m[0].indexOf(m[1] ?? ''));
  if (/(?:-|–|—|\bto)\s*$/i.test(before) || /\d\s*(?:-|–|—)\s*$/.test(before)) return null;
  if (/\d(?::\d{2})?\s*(?:-|–|—)\s*\d/.test(after.slice(0, m.index + m[0].length))) return null;

  const hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  if (hour < 1 || hour > 12 || minute > 59) return null;

  const pm = (m[3] ?? '').toLowerCase() === 'p';
  return { h: (hour % 12) + (pm ? 12 : 0), m: minute };
};

/**
 * The one date a line is about, or null when that is not certain.
 *
 * A second date normally means a schedule span or two sittings, and picking
 * one would be a guess. The exception is a line that marks exactly one of
 * them as the deadline: "released Oct 1, due Oct 15" says which it means.
 */
const pickDate = (line: string, term: TermContext): FoundDate | null => {
  const dates: FoundDate[] = [];
  let rest = line;
  while (dates.length < MAX_DATES_PER_LINE) {
    const found = findDate(rest, term);
    if (found === null) break;
    dates.push(found);
    rest = rest.replace(found.matched, ' ');
  }

  const usable = (d: FoundDate): boolean =>
    d.confidence >= MIN_DATE_CONFIDENCE &&
    withinTerm(d.date, term) &&
    !isRange(line, d.matched) &&
    !isDayList(line, d.matched) &&
    !isWeekStart(line, d.matched);

  if (dates.length === 0) return null;
  if (dates.length === 1) {
    const only = dates[0] as FoundDate;
    return usable(only) ? only : null;
  }

  const marked = dates.filter((d) => isMarkedDue(line, d.matched));
  if (marked.length !== 1) return null;
  const due = marked[0] as FoundDate;
  return usable(due) ? due : null;
};

/** "due Oct 15", "due: Fri, Oct 15", "deadline Oct 15", "submit by Oct 15". */
const isMarkedDue = (line: string, matched: string): boolean => {
  const at = line.indexOf(matched);
  if (at < 0) return false;
  const before = line.slice(Math.max(0, at - 24), at).toLowerCase();
  return /\b(?:due|deadline|submit(?:ted)?\s+by|hand\s+in\s+by)\b[\s:,-]*(?:(?:on|by)\s+)?(?:[a-z]{3,9}\.?,?\s+)?$/.test(
    before,
  );
};

/**
 * "Oct 20-24" or "Oct 20 to 24" is a window, not a due day. The number
 * after the dash has to be a day: "Oct 23 - 25%" is a date and a weight.
 */
/**
 * "Nov 9th, 12th and 13th", "Nov 9, 12 & 13", "Nov 9/12/13": one month and
 * several days. Only the first day reads as a date by itself, so without
 * this the line looked like it named one day. It names several, and
 * picking one would be a guess. A time ("Nov 9, 11:59 pm"), a year
 * ("Nov 13, 2026") or a weight ("Oct 23, 25%") after the date is not a day.
 */
const isDayList = (line: string, matched: string): boolean => {
  const at = line.indexOf(matched);
  if (at < 0) return false;
  const after = line.slice(at + matched.length);
  return /^\s*(?:,|&|\/|\+|\band\b)\s*(?:and\s+|&\s*)?\d{1,2}(?:st|nd|rd|th)?(?![\d:.]|\s*%|\s*[ap]\.?m\b)/i.test(
    after,
  );
};

const isRange = (line: string, matched: string): boolean => {
  const at = line.indexOf(matched);
  if (at < 0) return false;
  const after = line.slice(at + matched.length);
  return /^\s*(?:-|–|—|to|through|until)\s*\d{1,2}(?![\d.]|\s*%)/i.test(after);
};

const dateKey = (d: CivilDate): string => `${d.y}-${d.m}-${d.d}`;

/**
 * One row per assessment. A syllabus commonly names the same one in a
 * grading table and again in a schedule. The reading with a weight wins.
 */
const dedupe = (items: readonly Candidate[]): readonly Candidate[] => {
  const kept: Candidate[] = [];

  for (const c of items) {
    const at = kept.findIndex((k) => sameAssessment(k, c));
    if (at < 0) {
      kept.push(c);
      continue;
    }
    const existing = kept[at] as Candidate;
    kept[at] = preferred(existing, c);
  }

  return kept.sort((a, b) => a.dueAt - b.dueAt);
};

const numberIn = (title: string): string | null => /\b([0-9]{1,2})\b/.exec(title)?.[1] ?? null;

/**
 * Same kind on the same day is one assessment named twice, as when a schedule
 * says "Quiz 4" and the grading table says "Unit 4 - Quiz". Different numbers
 * keep them apart: Lab 3 and Lab 4 can share a day.
 */
const sameAssessment = (a: Candidate, b: Candidate): boolean => {
  if (a.kind !== b.kind || dateKey(a.date) !== dateKey(b.date)) return false;
  const an = numberIn(a.title);
  const bn = numberIn(b.title);
  return an === null || bn === null || an === bn;
};

/** The reading with a weight wins, then the more descriptive title. */
const preferred = (a: Candidate, b: Candidate): Candidate => {
  if ((a.weightPct === null) !== (b.weightPct === null)) return a.weightPct !== null ? a : b;
  return b.title.length > a.title.length ? b : a;
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Item ids come from the title, so two quizzes both called "Quiz" on
 * different days would collapse into one. When a title repeats with
 * different dates, each copy gets its date in the title to keep them apart.
 */
/**
 * One numbered assessment given two different dates ("Quiz 2" on Oct 19 and
 * on Oct 21) is a contradiction, and picking one would be a guess, so every
 * copy is left out. Unnumbered names are different: "Oct 5 - Quiz" and
 * "Oct 19 - Quiz" each date their own quiz.
 */
const dropConflicts = (items: readonly Candidate[]): readonly Candidate[] => {
  const datesByTitle = new Map<string, Set<string>>();
  for (const c of items) {
    if (numberIn(c.title) === null) continue;
    const key = `${c.kind}:${c.title.toLowerCase()}`;
    const set = datesByTitle.get(key) ?? new Set<string>();
    set.add(dateKey(c.date));
    datesByTitle.set(key, set);
  }
  return items.filter(
    (c) => (datesByTitle.get(`${c.kind}:${c.title.toLowerCase()}`)?.size ?? 0) <= 1,
  );
};

const disambiguate = (items: readonly Candidate[]): readonly Candidate[] => {
  const datesByTitle = new Map<string, Set<string>>();
  for (const c of items) {
    const key = c.title.toLowerCase();
    const set = datesByTitle.get(key) ?? new Set<string>();
    set.add(dateKey(c.date));
    datesByTitle.set(key, set);
  }

  return items.map((c) =>
    (datesByTitle.get(c.title.toLowerCase())?.size ?? 0) > 1
      ? { ...c, title: `${c.title} (${MONTH_ABBR[c.date.m - 1]} ${c.date.d})` }
      : c,
  );
};
