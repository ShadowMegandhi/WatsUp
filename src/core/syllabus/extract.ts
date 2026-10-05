/**
 * Reading exam dates out of syllabus lines.
 *
 * The rule the whole file serves: do not guess. A line becomes an item only
 * when all of these hold, and any one failure drops it with no scoring and no
 * second chance:
 *
 *   1. It names a midterm or exam.
 *   2. It carries exactly one complete date, on that same line.
 *   3. That date is not a range, sits inside the term, and agrees with any
 *      weekday written beside it.
 *   4. Nothing on the line says it is a window, a placeholder, a tutorial or
 *      lab component, a review session, or not happening.
 *
 * Everything else a syllabus says (assignments, quizzes, tutorials) is left
 * to LEARN, which reports those as facts rather than readings.
 */

import {
  EXAM_TERMS,
  EXAM_VETO_TERMS,
  NEGATION_TERMS,
  REVIEW_PREFIXES,
  UNGRADED_TERMS,
  VETO_TERMS,
} from './lexicon';
import { findDate, toInstant, withinTerm, type CivilDate, type TermContext } from './dates';

export interface Candidate {
  readonly title: string;
  readonly date: CivilDate;
  readonly dueAt: number;
  readonly weightPct: number | null;
  readonly sourceLine: string;
  readonly matchedTerm: string;
}

/** A weekday that disagrees with the date drops the format score below this. */
const MIN_DATE_CONFIDENCE = 0.85;

export const extractExams = (
  lines: readonly string[],
  term: TermContext,
): readonly Candidate[] => {
  const out: Candidate[] = [];

  for (const raw of lines) {
    const candidate = readExamLine(raw, term);
    if (candidate !== null) out.push(candidate);
  }

  return dedupe(out);
};

export const readExamLine = (raw: string, term: TermContext): Candidate | null => {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line.length < 6 || line.length > 300) return null;

  const lower = line.toLowerCase();

  if (VETO_TERMS.some((t) => lower.includes(t))) return null;
  if (UNGRADED_TERMS.some((t) => lower.includes(t))) return null;
  if (REVIEW_PREFIXES.some((t) => lower.includes(t))) return null;
  // Word-bounded, because "lab" is inside "syllabus" and "available".
  if (EXAM_VETO_TERMS.some((t) => containsWord(lower, t) >= 0)) return null;

  const examTerm = firstExamTerm(lower);
  if (examTerm === null) return null;
  if (isNegated(lower, examTerm)) return null;

  const found = findDate(line, term);
  if (found === null) return null;
  if (found.confidence < MIN_DATE_CONFIDENCE) return null;
  if (!withinTerm(found.date, term)) return null;
  if (isRange(line, found.matched)) return null;

  // A second date on the line means the line is a schedule span or lists two
  // sittings. Picking one would be a guess.
  if (findDate(line.replace(found.matched, ' '), term) !== null) return null;

  return {
    title: buildTitle(line, examTerm, found.matched),
    date: found.date,
    // Shown as all-day. 23:59 keeps it sorting last on its day.
    dueAt: toInstant(found.date, 23, 59),
    weightPct: readWeight(line),
    sourceLine: line,
    matchedTerm: examTerm,
  };
};

/**
 * Word-boundary containment without a constructed regex.
 *
 * An index scan with an explicit boundary check avoids escaping lexicon
 * entries into patterns, which is fragile for no benefit.
 */
const isWordChar = (c: string | undefined): boolean =>
  c !== undefined && /[a-z0-9]/i.test(c);

export const containsWord = (haystack: string, needle: string): number => {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return at;
    from = at + 1;
  }
};

const firstExamTerm = (lower: string): string | null => {
  // Longest first, so "final exam" wins over "exam".
  const sorted = [...EXAM_TERMS].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (containsWord(lower, t) >= 0) return t;
    if (t.includes('-') && containsWord(lower, t.replace(/-/g, ' ')) >= 0) return t;
  }
  return null;
};

/** "No midterm this term" must never produce a midterm. */
const isNegated = (lower: string, term: string): boolean => {
  const at = lower.indexOf(term);
  if (at < 0) return false;
  const before = lower.slice(Math.max(0, at - 28), at);
  return NEGATION_TERMS.some((n) => containsWord(before, n) >= 0);
};

/**
 * "Oct 20-24" or "Oct 20 to 24" is a window, not an exam day. The number
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

  const at = containsWord(withoutDate.toLowerCase(), term);
  if (at < 0) return base;

  // An ordinal counts only right after the name. A number further along is
  // usually the weight, and "Midterm 25" would be wrong.
  const rest = withoutDate.slice(at + term.length);
  const m = /^[ #:.-]{0,4}([0-9]{1,2})(?![0-9%])/.exec(rest);

  return m === null ? base : base + ' ' + m[1];
};

/**
 * One row per exam. A syllabus commonly names the same midterm in a grading
 * table and again in a schedule. The reading with a weight wins.
 */
const dedupe = (items: readonly Candidate[]): readonly Candidate[] => {
  const best = new Map<string, Candidate>();

  for (const c of items) {
    const key = `${c.title.toLowerCase()}|${c.date.y}-${c.date.m}-${c.date.d}`;
    const existing = best.get(key);
    if (existing === undefined || (existing.weightPct === null && c.weightPct !== null)) {
      best.set(key, c);
    }
  }

  return [...best.values()].sort((a, b) => a.dueAt - b.dueAt);
};
