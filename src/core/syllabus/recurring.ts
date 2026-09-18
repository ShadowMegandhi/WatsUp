/**
 * Assessments a syllabus counts rather than dates.
 *
 * MATH 102 says "Tutorial Assignments (best 7 of 9)" and never prints a single
 * date, because from the course's point of view the dates are obvious: they
 * happen in tutorial. A reader that only looks for dated lines finds nothing
 * here and reports the outline as empty, which is both true and useless.
 *
 * What the line actually states is a count and a component. Combined with when
 * that component really meets, that is enough to place every one of them.
 */

import type { ComponentKind } from '@core/schedule/types';

export interface RecurringAssessment {
  readonly title: string;
  readonly kind: ComponentKind;
  /** How many exist in total, not how many count toward the grade. */
  readonly count: number;
  readonly weightPct: number | null;
  readonly sourceLine: string;
}

/** Sanity bound: a term has no room for more than this many of anything. */
const MAX_COUNT = 24;

const COMPONENTS: readonly (readonly [RegExp, ComponentKind, string])[] = [
  [/\btutorial\b|\btut\b/i, 'TUT', 'Tutorial'],
  [/\blab(oratory)?\b/i, 'LAB', 'Lab'],
  [/\bseminar\b/i, 'SEM', 'Seminar'],
];

const NOUNS = /\b(assignment|quiz|test|worksheet|exercise|problem set|submission|deliverable|report)s?\b/i;

/**
 * Reads lines that count assessments instead of dating them.
 *
 * Only two shapes are accepted, both of which state a total explicitly:
 * "best 7 of 9", and "9 tutorial assignments". Anything vaguer is left alone,
 * because inventing a count would invent deadlines.
 */
export const parseRecurring = (lines: readonly string[]): readonly RecurringAssessment[] => {
  const out: RecurringAssessment[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (line.length < 8 || line.length > 200) continue;

    const component = COMPONENTS.find(([re]) => re.test(line));
    if (component === undefined) continue;
    if (!NOUNS.test(line)) continue;

    const count = readCount(line);
    if (count === null) continue;

    out.push({
      title: `${component[2]} ${nounFor(line)}`,
      kind: component[1],
      count,
      weightPct: readPercent(line),
      sourceLine: line,
    });
  }

  return dedupe(out);
};

/**
 * The total, never the number that counts toward the grade.
 *
 * "best 7 of 9" means nine exist and you attend nine; seven is a grading rule,
 * not a schedule. Placing seven would silently drop two real deadlines.
 */
export const readCount = (line: string): number | null => {
  const bestOf = /\bbest\s+(\d{1,2})\s+(?:of|out of)\s+(\d{1,2})\b/i.exec(line);
  if (bestOf !== null) return bound(Number(bestOf[2]));

  const topOf = /\b(?:top|highest)\s+(\d{1,2})\s+(?:of|out of)\s+(\d{1,2})\b/i.exec(line);
  if (topOf !== null) return bound(Number(topOf[2]));

  const plain = /\b(\d{1,2})\s+(?:weekly\s+)?(?:tutorial|lab|seminar)/i.exec(line);
  if (plain !== null) return bound(Number(plain[1]));

  const trailing = /\b(?:there are|a total of)\s+(\d{1,2})\b/i.exec(line);
  if (trailing !== null) return bound(Number(trailing[1]));

  return null;
};

const bound = (n: number): number | null => (Number.isFinite(n) && n >= 2 && n <= MAX_COUNT ? n : null);

const readPercent = (line: string): number | null => {
  const m = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(line);
  if (m === null) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
};

const nounFor = (line: string): string => {
  const m = NOUNS.exec(line);
  const word = (m?.[1] ?? 'assignment').toLowerCase();
  return word.charAt(0).toUpperCase() + word.slice(1);
};

const dedupe = (items: readonly RecurringAssessment[]): readonly RecurringAssessment[] => {
  const best = new Map<string, RecurringAssessment>();
  for (const item of items) {
    const key = `${item.kind}|${item.title.toLowerCase()}`;
    const existing = best.get(key);
    // Prefer the reading that knows a weight, then the larger count.
    if (
      existing === undefined ||
      (item.weightPct !== null && existing.weightPct === null) ||
      item.count > existing.count
    ) {
      best.set(key, item);
    }
  }
  return [...best.values()];
};
