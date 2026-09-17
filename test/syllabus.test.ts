import { describe, it, expect } from 'vitest';
import { findDate, inferYear, termFrom, withinTerm, maskNonDates } from '@core/syllabus/dates';
import { extractCandidates, readLine, readWeight, buildTitle } from '@core/syllabus/extract';

/** Fall 2026: starts September, runs into December. */
const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

const one = (line: string) => readLine(line, FALL);

describe('year inference', () => {
  it('reads a month after the term start as the term year', () => {
    expect(inferYear(10, FALL)).toBe(2026);
  });

  it('reads a month before the term start as the following year', () => {
    // A Fall syllabus mentioning January means the January after it.
    expect(inferYear(1, FALL)).toBe(2027);
  });

  it('keeps a Winter term inside one year', () => {
    const winter = termFrom(new Date(2026, 0, 5).getTime(), Date.now());
    expect(inferYear(3, winter)).toBe(2026);
  });
});

describe('findDate', () => {
  it('reads an explicit full date with total confidence', () => {
    const f = findDate('Midterm on October 23, 2026', FALL);
    expect(f?.date).toEqual({ y: 2026, m: 10, d: 23 });
    expect(f?.confidence).toBe(1);
    expect(f?.yearWasExplicit).toBe(true);
  });

  it('infers the year when the syllabus omits it', () => {
    expect(findDate('Midterm on Oct 23', FALL)?.date).toEqual({ y: 2026, m: 10, d: 23 });
  });

  it('accepts a day-first form', () => {
    expect(findDate('Test on 14 October', FALL)?.date.d).toBe(14);
  });

  it('uses a stated weekday as corroboration', () => {
    const f = findDate('Midterm Friday Oct 23', FALL);
    expect(f?.confidence).toBeGreaterThan(0.95);
  });

  it('loses confidence when the weekday contradicts the date', () => {
    const f = findDate('Midterm Monday Oct 23', FALL);
    expect(f?.confidence).toBeLessThan(0.6);
  });

  it('refuses a purely numeric date rather than guessing the order', () => {
    // 10/14 is ambiguous between October 14 and 10 April. Guessing is how you
    // land eleven days wrong, so it is declined outright.
    expect(findDate('Assignment due 10/14', FALL)).toBeNull();
  });

  it('is not fooled by a chapter number', () => {
    expect(findDate('Read Ch. 3 and Ch. 4', FALL)).toBeNull();
  });

  it('is not fooled by a page range', () => {
    expect(findDate('Problems pp. 10-14', FALL)).toBeNull();
  });

  it('is not fooled by a clock time', () => {
    expect(findDate('Class at 10:30', FALL)).toBeNull();
  });

  it('rejects an impossible day', () => {
    expect(findDate('Exam on Feb 30', FALL)).toBeNull();
  });
});

describe('masking', () => {
  it('strips the things that impersonate dates', () => {
    const masked = maskNonDates('MATH 135 Ch. 3.2 pp. 10-14 worth 25% at 10:30');
    expect(masked).not.toContain('135');
    expect(masked).not.toContain('3.2');
    expect(masked).not.toContain('25%');
  });
});

describe('term window', () => {
  it('accepts a date inside the term', () => {
    expect(withinTerm({ y: 2026, m: 10, d: 23 }, FALL)).toBe(true);
  });

  it('rejects a date a year away, whatever else the line said', () => {
    // The backstop against a copyright year becoming a deadline.
    expect(withinTerm({ y: 2028, m: 10, d: 23 }, FALL)).toBe(false);
  });
});

describe('weights', () => {
  it('reads a percentage', () => {
    expect(readWeight('Midterm 25%')).toBe(25);
  });

  it('ignores an impossible percentage', () => {
    expect(readWeight('scored 250%')).toBeNull();
  });
});

describe('titles', () => {
  it('keeps the ordinal, which is what distinguishes siblings', () => {
    expect(buildTitle('Tutorial Test 2 on Oct 14', 'tutorial test', 'Oct 14')).toBe('Tutorial Test 2');
  });

  it('falls back to the assessment name when there is no ordinal', () => {
    expect(buildTitle('Midterm Oct 14', 'midterm', 'Oct 14')).toBe('Midterm');
  });
});

describe('readLine accepts only clearly labelled assessments', () => {
  it('reads a midterm with a date', () => {
    const c = one('Midterm Exam: Friday, October 23, 2026');
    expect(c?.title).toContain('Midterm');
    expect(c?.date.m).toBe(10);
  });

  it('reads the math tutorial test case', () => {
    const c = one('Tutorial Test 3 - Oct 28 - covers sections 4.1 to 4.6');
    expect(c).not.toBeNull();
    expect(c?.title).toBe('Tutorial Test 3');
  });

  it('picks up a stated weight', () => {
    expect(one('Midterm, Oct 23, worth 25%')?.weightPct).toBe(25);
  });

  it('keeps the source line so the UI can show its working', () => {
    const line = 'Assignment 4 due November 6';
    expect(one(line)?.sourceLine).toBe(line);
  });
});

describe('readLine refuses to assume', () => {
  it('ignores a lecture topic that merely has a date', () => {
    expect(one('Oct 23 - Induction and recursion')).toBeNull();
  });

  it('ignores reading week', () => {
    expect(one('Oct 12 to Oct 16 - Reading Week, no classes')).toBeNull();
  });

  it('ignores a registrar drop deadline', () => {
    expect(one('Nov 7 - Last day to drop a course')).toBeNull();
  });

  it('ignores office hours', () => {
    expect(one('Office hours Tuesdays from Sept 15')).toBeNull();
  });

  it('ignores a cancelled class', () => {
    expect(one('Oct 13 - No class, Thanksgiving')).toBeNull();
  });

  it('never invents a quiz from a negation', () => {
    expect(one('Oct 23 - No quiz this week')).toBeNull();
  });

  it('ignores a practice test', () => {
    expect(one('Practice test posted Oct 20')).toBeNull();
  });

  it('ignores a review session for a real exam', () => {
    expect(one('Oct 21 - Review for midterm')).toBeNull();
  });

  it('ignores an assessment with no date at all', () => {
    expect(one('There will be a midterm and a final exam')).toBeNull();
  });

  it('ignores a date with nothing gradeable named', () => {
    expect(one('October 23')).toBeNull();
  });

  it('ignores academic integrity policy text', () => {
    expect(one('See Policy 71 regarding academic integrity, revised Oct 2026')).toBeNull();
  });

  it('ignores a textbook reference', () => {
    expect(one('Textbook chapter 4, published Oct 2019')).toBeNull();
  });
});

describe('extractCandidates on a realistic outline', () => {
  const lines = [
    'MATH 135 Course Outline, Fall 2026',
    'Instructor office hours: Mondays 2-4pm',
    'Week 1 - Sept 8 - Introduction to proofs',
    'Tutorial Test 1 - Sept 23 - 5%',
    'Week 5 - Oct 6 - Modular arithmetic',
    'Oct 12 to 16 - Reading Week, no classes',
    'Midterm Exam - Friday October 23, 2026 - 25%',
    'Tutorial Test 2 - Nov 4 - 5%',
    'Nov 7 - Last day to drop',
    'Final Exam - date set by the Registrar',
  ];

  it('finds the assessments that are actually labelled', () => {
    const titles = extractCandidates(lines, FALL).map((c) => c.title);
    expect(titles).toContain('Tutorial Test 1');
    expect(titles).toContain('Tutorial Test 2');
    expect(titles.some((t) => t.includes('Midterm'))).toBe(true);
  });

  it('leaves everything else alone', () => {
    const titles = extractCandidates(lines, FALL).map((c) => c.title);
    expect(titles.some((t) => t.includes('Reading'))).toBe(false);
    expect(titles.some((t) => t.includes('drop'))).toBe(false);
    expect(titles.some((t) => t.includes('Introduction'))).toBe(false);
  });

  it('does not invent a date for the final exam', () => {
    // The registrar sets it and the syllabus does not say when. Inventing one
    // is exactly the failure this whole design is built to avoid.
    const titles = extractCandidates(lines, FALL).map((c) => c.title);
    expect(titles.some((t) => t.toLowerCase().includes('final'))).toBe(false);
  });

  it('returns items in date order', () => {
    const found = extractCandidates(['Midterm Nov 4 25%', 'Tutorial Test 1 Sept 23 5%'], FALL);
    expect(found.map((c) => c.title)).toEqual(['Tutorial Test 1', 'Midterm']);
  });

  it('collapses the same assessment named twice', () => {
    const found = extractCandidates(
      ['Midterm Exam October 23, 2026', 'Midterm Exam - Oct 23 - 25%'],
      FALL,
    );
    expect(found).toHaveLength(1);
  });
});
