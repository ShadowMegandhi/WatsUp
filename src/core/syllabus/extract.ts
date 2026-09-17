/**
 * Turning syllabus lines into assessment candidates.
 *
 * The rule the whole file serves: do not assume. Three conditions must all
 * hold before a line becomes an item, and any one veto kills it outright.
 *
 *   1. It names something gradeable.
 *   2. It carries a real date, inside the term window.
 *   3. Nothing about it says otherwise.
 *
 * A date alone is never enough. In a weekly schedule table most dated rows are
 * lecture topics, and treating those as deadlines would bury the real ones.
 */

import {
  ASSESSMENT_TERMS,
  NEGATION_TERMS,
  REVIEW_PREFIXES,
  SUPPORTING_TERMS,
  UNGRADED_TERMS,
  VETO_TERMS,
} from './lexicon';
import { findDate, toInstant, withinTerm, type CivilDate, type TermContext } from './dates';

export interface Candidate {
  readonly title: string;
  readonly date: CivilDate;
  readonly dueAt: number;
  readonly weightPct: number | null;
  readonly confidence: number;
  readonly sourceLine: string;
  readonly matchedTerm: string;
}

/** Below this, a line is discarded rather than shown. */
export const ACCEPT_THRESHOLD = 0.62;

export const extractCandidates = (
  lines: readonly string[],
  term: TermContext,
): readonly Candidate[] => {
  const out: Candidate[] = [];

  for (const raw of lines) {
    const candidate = readLine(raw, term);
    if (candidate !== null) out.push(candidate);
  }

  return dedupe(out);
};

export const readLine = (raw: string, term: TermContext): Candidate | null => {
  const line = raw.replace(/\s+/g, ' ').trim();
  if (line.length < 6 || line.length > 400) return null;

  const lower = line.toLowerCase();

  if (VETO_TERMS.some((t) => lower.includes(t))) return null;
  if (UNGRADED_TERMS.some((t) => lower.includes(t))) return null;
  if (REVIEW_PREFIXES.some((t) => lower.includes(t))) return null;

  const term_ = firstAssessmentTerm(lower);
  if (term_ === null) return null;
  if (isNegated(lower, term_)) return null;

  const found = findDate(line, term);
  if (found === null) return null;
  if (!withinTerm(found.date, term)) return null;

  const weightPct = readWeight(line);
  const confidence = score(found.confidence, lower, weightPct);
  if (confidence < ACCEPT_THRESHOLD) return null;

  return {
    title: buildTitle(line, term_, found.matched),
    date: found.date,
    // Exams read as all-day; anything submitted defaults to end of day. Both
    // land at 23:59 so the item sorts last on its day, where a deadline goes.
    dueAt: toInstant(found.date, 23, 59),
    weightPct,
    confidence,
    sourceLine: line,
    matchedTerm: term_,
  };
};

/**
 * Word-boundary containment without a constructed regex.
 *
 * Building patterns from lexicon entries meant escaping them correctly at
 * two levels, which is fragile for no benefit. An index scan with an
 * explicit boundary check is both clearer and impossible to get subtly
 * wrong.
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
const firstAssessmentTerm = (lower: string): string | null => {
  // Longest first, so "final exam" wins over "exam" and "tutorial test" over
  // "test". The longer phrase is the more specific description.
  const sorted = [...ASSESSMENT_TERMS].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    // Hyphenated entries also match the spaced spelling, since syllabi use both.
    if (containsWord(lower, t) >= 0) return t;
    if (t.includes('-') && containsWord(lower, t.replace(/-/g, ' ')) >= 0) return t;
  }
  return null;
};

/** "No quiz this week" must never produce a quiz. */
const isNegated = (lower: string, term: string): boolean => {
  const at = lower.indexOf(term);
  if (at < 0) return false;
  const before = lower.slice(Math.max(0, at - 28), at);
  return NEGATION_TERMS.some((n) => containsWord(before, n) >= 0);
};

export const readWeight = (line: string): number | null => {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
};

/**
 * Confidence combines the date format with corroborating signals. A weight is
 * the strongest of those: a percentage beside an assessment name is the
 * document stating plainly that the thing is marked.
 */
const score = (dateConfidence: number, lower: string, weightPct: number | null): number => {
  let s = 0.45 + dateConfidence * 0.35;

  if (weightPct !== null) s += 0.15;
  if (SUPPORTING_TERMS.some((t) => lower.includes(t))) s += 0.08;

  return Math.min(1, s);
};

/**
 * A short human title. The source line is kept separately and shown in the UI,
 * so this only has to be recognisable, not complete.
 */
export const buildTitle = (line: string, term: string, dateText: string): string => {
  const withoutDate = line.replace(dateText, ' ').replace(/ +/g, ' ').trim();
  const base = term.replace(/(^|[ -])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());

  const at = containsWord(withoutDate.toLowerCase(), term);
  if (at < 0) return base;

  // An ordinal counts only when it sits right after the name. A number
  // further along the line is usually the weight, and "Midterm 25" would be
  // both wrong and unstable between two mentions of the same exam.
  const rest = withoutDate.slice(at + term.length);
  const m = /^[ #:.-]{0,4}([0-9]{1,2})(?![0-9%])/.exec(rest);

  return m === null ? base : base + ' ' + m[1];
};

/**
 * One row per assessment. A syllabus commonly names the same midterm in a
 * grading table and again in a schedule, and two entries for one exam is worse
 * than one. The higher-confidence reading wins.
 */
const dedupe = (items: readonly Candidate[]): readonly Candidate[] => {
  const best = new Map<string, Candidate>();

  for (const c of items) {
    const key = `${c.title.toLowerCase()}|${c.date.y}-${c.date.m}-${c.date.d}`;
    const existing = best.get(key);
    if (existing === undefined || c.confidence > existing.confidence) best.set(key, c);
  }

  return [...best.values()].sort((a, b) => a.dueAt - b.dueAt);
};
