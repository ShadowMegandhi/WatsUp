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
 *   4. Nothing on the line says it is a window, a placeholder, a release
 *      rather than a deadline, a review session, ungraded, or not happening.
 *
 * Until v0.4 this read midterms and exams only. In-class quizzes and other
 * dated work that never appears in a LEARN tool were being missed, so the
 * vocabulary widened; the date rules did not loosen.
 */

import type { TaskKind } from '../types';
import {
  ASSESSMENT_TERMS,
  NEGATION_TERMS,
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

export interface Candidate {
  readonly title: string;
  readonly kind: TaskKind;
  readonly date: CivilDate;
  readonly dueAt: number;
  readonly weightPct: number | null;
  readonly sourceLine: string;
  readonly matchedTerm: string;
}

/** A weekday that disagrees with the date drops the format score below this. */
const MIN_DATE_CONFIDENCE = 0.85;

/** Mentions closer than this are one name ("Midterm Exam", "Midterm Test"). */
const ADJACENT_GAP = 2;

/** At most this many dates are looked for on one line. */
const MAX_DATES_PER_LINE = 4;

export const extractAssessments = (
  lines: readonly string[],
  term: TermContext,
): readonly Candidate[] => {
  const out: Candidate[] = [];
  for (const raw of lines) out.push(...readLine(raw, term));
  return disambiguate(dedupe(out));
};

/** The first assessment read from a line, or null. Kept for focused tests. */
export const readAssessmentLine = (raw: string, term: TermContext): Candidate | null =>
  readLine(raw, term)[0] ?? null;

export const readLine = (raw: string, term: TermContext): readonly Candidate[] => {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line.length < 6 || line.length > 300) return [];

  const lower = line.toLowerCase();

  if (VETO_TERMS.some((t) => lower.includes(t))) return [];
  if (UNGRADED_TERMS.some((t) => lower.includes(t))) return [];
  if (REVIEW_PREFIXES.some((t) => lower.includes(t))) return [];
  // Word-bounded, because "tba" can sit inside other words.
  if (WINDOW_TERMS.some((t) => containsWord(lower, t) >= 0)) return [];
  if (NOT_A_DEADLINE_TERMS.some((t) => containsWord(lower, t) >= 0)) return [];

  const mentions = findMentions(lower).filter((m) => !isNegated(lower, m.at));
  if (mentions.length === 0) return [];

  const found = pickDate(line, term);
  if (found === null) return [];

  // With several assessments on one line, a single percentage could belong
  // to any of them, so it is attached only when there is one.
  const weight = mentions.length === 1 ? readWeight(line) : null;

  return mentions.map((m) => ({
    title: buildTitle(line, m.term, found.matched),
    kind: m.kind,
    date: found.date,
    // Shown as all-day. 23:59 keeps it sorting last on its day.
    dueAt: toInstant(found.date, 23, 59),
    weightPct: weight,
    sourceLine: line,
    matchedTerm: m.term,
  }));
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
    d.confidence >= MIN_DATE_CONFIDENCE && withinTerm(d.date, term) && !isRange(line, d.matched);

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

interface Mention {
  readonly term: string;
  readonly kind: TaskKind;
  readonly at: number;
  readonly end: number;
}

/**
 * Every distinct assessment named on a line.
 *
 * Longest names claim their span first, so "final exam" wins over "exam" and
 * "lab report" over "lab". A shorter name sitting right beside an accepted
 * one is part of the same name ("Midterm Exam", "Midterm Test") and is not
 * a second assessment.
 */
const findMentions = (lower: string): readonly Mention[] => {
  const sorted = [...ASSESSMENT_TERMS].sort((a, b) => b.term.length - a.term.length);
  const accepted: Mention[] = [];

  for (const { term, kind } of sorted) {
    for (const variant of variantsOf(term)) {
      let from = 0;
      for (;;) {
        const at = containsWord(lower, variant, from);
        if (at < 0) break;
        const end = at + variant.length;
        const clashes = accepted.some(
          (m) => at < m.end + ADJACENT_GAP && end > m.at - ADJACENT_GAP,
        );
        if (!clashes) accepted.push({ term, kind, at, end });
        from = end;
      }
    }
  }

  return accepted.sort((a, b) => a.at - b.at);
};

const variantsOf = (term: string): readonly string[] =>
  term.includes('-') ? [term, term.replace(/-/g, ' ')] : [term];

/**
 * Word-boundary containment without a constructed regex.
 *
 * An index scan with an explicit boundary check avoids escaping lexicon
 * entries into patterns, which is fragile for no benefit.
 */
const isWordChar = (c: string | undefined): boolean =>
  c !== undefined && /[a-z0-9]/i.test(c);

export const containsWord = (haystack: string, needle: string, start = 0): number => {
  let from = start;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
};

/** "No quiz this week" must never produce a quiz. */
const isNegated = (lower: string, at: number): boolean => {
  const before = lower.slice(Math.max(0, at - 28), at);
  return NEGATION_TERMS.some((n) => containsWord(before, n) >= 0);
};

/**
 * "Oct 20-24" or "Oct 20 to 24" is a window, not a due day. The number
 * after the dash has to be a day: "Oct 23 - 25%" is a date and a weight.
 */
const isRange = (line: string, matched: string): boolean => {
  const at = line.indexOf(matched);
  if (at < 0) return false;
  const after = line.slice(at + matched.length);
  return /^\s*(?:-|–|—|to|through|until)\s*\d{1,2}(?![\d.]|\s*%)/i.test(after);
};

export const readWeight = (line: string): number | null => {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
};

/**
 * A short human title. The source line is kept separately and shown in the
 * UI, so this only has to be recognisable.
 */
export const buildTitle = (line: string, term: string, dateText: string): string => {
  const withoutDate = line.replace(dateText, ' ').replace(/ +/g, ' ').trim();
  const base = term.replace(/(^|[ -])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());

  const lower = withoutDate.toLowerCase();
  let at = -1;
  for (const variant of variantsOf(term)) {
    at = containsWord(lower, variant);
    if (at >= 0) break;
  }
  if (at < 0) return base;

  // An ordinal counts only right after the name. A number further along is
  // usually the weight, and "Midterm 25" would be wrong.
  const rest = withoutDate.slice(at + term.length);
  const m = /^[ #:.-]{0,4}([0-9]{1,2})(?![0-9%])/.exec(rest);

  return m === null ? base : base + ' ' + m[1];
};

const dateKey = (d: CivilDate): string => `${d.y}-${d.m}-${d.d}`;

/**
 * One row per assessment. A syllabus commonly names the same one in a
 * grading table and again in a schedule. The reading with a weight wins.
 */
const dedupe = (items: readonly Candidate[]): readonly Candidate[] => {
  const best = new Map<string, Candidate>();

  for (const c of items) {
    const key = `${c.title.toLowerCase()}|${dateKey(c.date)}`;
    const existing = best.get(key);
    if (existing === undefined || (existing.weightPct === null && c.weightPct !== null)) {
      best.set(key, c);
    }
  }

  return [...best.values()].sort((a, b) => a.dueAt - b.dueAt);
};

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Item ids come from the title, so two quizzes both called "Quiz" on
 * different days would collapse into one. When a title repeats with
 * different dates, each copy gets its date in the title to keep them apart.
 */
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
