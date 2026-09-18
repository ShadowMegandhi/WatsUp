import { describe, it, expect } from 'vitest';
import { parseRecurring, readCount } from '@core/syllabus/recurring';

describe('readCount', () => {
  it('takes the total, not the number that counts toward the grade', () => {
    // MATH 102: nine tutorial assignments exist and all nine happen. Seven is a
    // grading rule. Placing seven would silently drop two real deadlines.
    expect(readCount('Tutorial Assignments (best 7 of 9)')).toBe(9);
  });

  it('handles the out-of spelling', () => {
    expect(readCount('best 8 out of 10 labs')).toBe(10);
  });

  it('handles top N of M', () => {
    expect(readCount('top 5 of 6 tutorial quizzes')).toBe(6);
  });

  it('reads a plain count before the component', () => {
    expect(readCount('There are 6 lab sessions')).toBe(6);
  });

  it('reads a weekly phrasing', () => {
    expect(readCount('9 weekly tutorial assignments')).toBe(9);
  });

  it('refuses an implausible count rather than inventing deadlines', () => {
    expect(readCount('best 1 of 99 tutorials')).toBeNull();
  });

  it('returns nothing when no total is stated', () => {
    expect(readCount('Tutorial assignments will be posted weekly')).toBeNull();
  });
});

describe('parseRecurring', () => {
  it('reads the MATH 102 line that dated extraction cannot use', () => {
    const found = parseRecurring(['Tutorial Assignments (best 7 of 9) 20%']);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('TUT');
    expect(found[0]?.count).toBe(9);
    expect(found[0]?.weightPct).toBe(20);
  });

  it('names the component and the kind of work', () => {
    expect(parseRecurring(['Tutorial Assignments (best 7 of 9)'])[0]?.title).toBe('Tutorial Assignment');
  });

  it('reads labs', () => {
    const found = parseRecurring(['There are 6 lab reports, best 5 of 6 count']);
    expect(found[0]?.kind).toBe('LAB');
    expect(found[0]?.count).toBe(6);
  });

  it('ignores a line naming a component but no gradeable work', () => {
    expect(parseRecurring(['Tutorials meet weekly in MC 4000'])).toEqual([]);
  });

  it('ignores a line naming work but no component', () => {
    expect(parseRecurring(['best 7 of 9 assignments'])).toEqual([]);
  });

  it('ignores a line with no stated total', () => {
    expect(parseRecurring(['Tutorial assignments are posted each week'])).toEqual([]);
  });

  it('keeps the source line so the panel can show its working', () => {
    const line = 'Tutorial Assignments (best 7 of 9)';
    expect(parseRecurring([line])[0]?.sourceLine).toBe(line);
  });

  it('collapses the same series mentioned twice, preferring the one with a weight', () => {
    const found = parseRecurring([
      'Tutorial Assignments (best 7 of 9)',
      'Tutorial Assignments (best 7 of 9) worth 20%',
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.weightPct).toBe(20);
  });
});
