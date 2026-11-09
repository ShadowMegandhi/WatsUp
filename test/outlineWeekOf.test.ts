/**
 * "Week of Nov 9" names a week, not a day.
 *
 * Outlines often list labs and discussion posts by the week they fall in
 * and say the day somewhere else ("Labs are held on Tuesdays"). The date
 * after "week of" is only where the week starts: listing the item on it
 * would be a guess. It is placed only on a day the outline states, and
 * otherwise left out.
 */

import { describe, it, expect } from 'vitest';
import { termFrom } from '@core/syllabus/dates';
import { extractAssessments } from '@core/syllabus/extract';
import { toLines } from '@sync/syllabusSync';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

const read = (lines: readonly string[]): readonly string[] =>
  extractAssessments(lines, FALL).map((c) => {
    const d = new Date(c.dueAt);
    const time = c.hasTime ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `${c.title} ${d.getMonth() + 1}/${d.getDate()}${time}`;
  });

const RULE = 'Labs are held on Tuesdays at 2:30 pm.';

describe('"week of" in a line', () => {
  it('is left out when no day is stated', () => {
    expect(read(['Lab 3 - week of Nov 9'])).toEqual([]);
    expect(read(['Discussion post 5 (week of November 9)'])).toEqual([]);
    expect(read(['Lab 3: week beginning Nov 9'])).toEqual([]);
    expect(read(['Lab 3, w/o Nov 9'])).toEqual([]);
  });

  it('goes on the stated day of that week, and only there', () => {
    expect(read(['Lab 3 - week of Nov 9', RULE])).toEqual(['Lab 3 11/10 14:30']);
  });

  it('does not let a "Week of" line date the item under it', () => {
    expect(read(['Week of Nov 9', 'Lab 3'])).toEqual([]);
    expect(read(['Week of Nov 9', 'Lab 3', RULE])).toEqual(['Lab 3 11/10 14:30']);
  });

  it('still reads a plain due date', () => {
    expect(read(['Lab 3 due Nov 13'])).toEqual(['Lab 3 11/13']);
  });
});

describe('a "Week of" column', () => {
  const table = (rule: string): string =>
    '<table><tr><th>Week of</th><th>Topic</th><th>Due</th></tr>' +
    '<tr><td>Nov 2</td><td>Signals</td><td>Lab 3</td></tr>' +
    '<tr><td>Nov 9</td><td>Filters</td><td>Lab 4, Discussion post 5</td></tr></table>' +
    rule;

  it('leaves the items out when no day is stated', () => {
    expect(read(toLines(table('')))).toEqual([]);
  });

  it('places only the kinds whose day is stated', () => {
    expect(read(toLines(table(`<p>${RULE}</p>`)))).toEqual(['Lab 3 11/3 14:30', 'Lab 4 11/10 14:30']);
  });

  it('is read the same from a pipe table', () => {
    const lines = ['| Week of | Topic | Due |', '| Nov 9 | Filters | Discussion post 5 |'];
    expect(read(lines)).toEqual([]);
  });
});
