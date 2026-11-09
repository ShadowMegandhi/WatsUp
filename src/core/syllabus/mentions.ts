/**
 * Finding assessment names in a line of outline text, and naming them.
 *
 * Shared by the line reader (extract.ts) and the whole-document reader
 * (context.ts), so neither has to import the other.
 */

import type { TaskKind } from '../types';
import { ASSESSMENT_TERMS, NEGATION_TERMS, pluralOf } from './lexicon';

/** Mentions closer than this are one name ("Midterm Exam", "Midterm Test"). */
const ADJACENT_GAP = 2;

export interface Mention {
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
export const findMentions = (lower: string): readonly Mention[] => {
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

/**
 * The one assessment a line names in the plural ("Quizzes | Oct 2 | Oct 16"),
 * longest name first, or null. Used only where a plural plus dates lists a
 * series; elsewhere a plural describes a policy.
 */
export const findPluralMention = (lower: string): Mention | null => {
  const sorted = [...ASSESSMENT_TERMS].sort((a, b) => b.term.length - a.term.length);
  for (const { term, kind } of sorted) {
    const plural = pluralOf(term);
    const at = containsWord(lower, plural);
    if (at >= 0 && !isNegated(lower, at)) return { term, kind, at, end: at + plural.length };
  }
  return null;
};

export const variantsOf = (term: string): readonly string[] =>
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
export const isNegated = (lower: string, at: number): boolean => {
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
  if (m !== null) return base + ' ' + m[1];

  // "Unit 1 - Quiz" numbers the unit, not the quiz, but it is still what
  // tells this quiz from the others.
  const before = withoutDate.slice(0, at);
  const unit = /\b(unit|module|part|chapter|topic)\s*#?\s*([0-9]{1,2})\s*[-–—:|]?\s*$/i.exec(before);
  if (unit !== null) {
    const name = (unit[1] ?? '').charAt(0).toUpperCase() + (unit[1] ?? '').slice(1).toLowerCase();
    return `${name} ${unit[2] ?? ''} ${base}`;
  }

  return base;
};

export const tidy = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

export const cellAround = (line: string, at: number): string => {
  const start = at > 0 ? line.lastIndexOf('|', at - 1) + 1 : 0;
  const end = line.indexOf('|', at);
  return line.slice(start, end < 0 ? line.length : end);
};
