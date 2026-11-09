/**
 * Reading outline tables as tables.
 *
 * Outlines spread one quiz across table structure: a week cell spanning
 * several rows, a "Quiz" column header over a bare "2", a week label row
 * above the rows it covers, the weekly rule in a different table. These are
 * read from the table itself, never guessed.
 */

import { describe, it, expect } from 'vitest';
import { termFrom } from '@core/syllabus/dates';
import { extractAssessments } from '@core/syllabus/extract';
import { slimPastedHtml } from '@core/outlineLinks';
import { toLines } from '@sync/syllabusSync';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

const read = (html: string): readonly string[] =>
  extractAssessments(toLines(html), FALL).map((c) => {
    const d = new Date(c.dueAt);
    const time = c.hasTime ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `${c.title} ${d.getMonth() + 1}/${d.getDate()}${time}`;
  });

const RULES =
  '<p>Quizzes are written on Mondays at 5:30 pm.</p><p>Labs are due on Fridays at 11:59 pm.</p>';

describe('a week cell spanning several rows', () => {
  const html =
    '<table><tr><th>Week</th><th>Dates</th><th>Topic</th><th>Assessment</th></tr>' +
    '<tr><td rowspan="2">7</td><td rowspan="2">Oct 19 - 23</td><td>Trusses</td><td>Quiz 2</td></tr>' +
    '<tr><td>Frames</td><td>Lab 3</td></tr></table>' +
    RULES;

  it('gives every row its week, then its stated day', () => {
    expect(read(html)).toEqual(['Quiz 2 10/19 17:30', 'Lab 3 10/23 23:59']);
  });

  it('survives being copied and pasted', () => {
    expect(read(slimPastedHtml(html))).toEqual(['Quiz 2 10/19 17:30', 'Lab 3 10/23 23:59']);
  });
});

describe('a column headed by the assessment', () => {
  it('reads a numbered list under a "Quiz" header', () => {
    const html =
      '<table><tr><th>Quiz</th><th>Date</th></tr>' +
      '<tr><td>1</td><td>Oct 2</td></tr><tr><td>2</td><td>Oct 16</td></tr></table>';
    expect(read(html)).toEqual(['Quiz 1 10/2', 'Quiz 2 10/16']);
  });

  it('reads a tick in a "Quiz" column of a dated schedule', () => {
    const html =
      '<table><tr><th>Date</th><th>Topic</th><th>Quiz</th></tr>' +
      '<tr><td>Mon Oct 19</td><td>Trusses</td><td>✓</td></tr>' +
      '<tr><td>Mon Oct 26</td><td>Frames</td><td></td></tr>' +
      '<tr><td>Mon Nov 2</td><td>Beams</td><td>-</td></tr></table>';
    expect(read(html)).toEqual(['Quiz 10/19']);
  });

  it('reads a numbered entry in a "Quiz" column', () => {
    const html =
      '<table><tr><th>Date</th><th>Topic</th><th>Quiz</th></tr>' +
      '<tr><td>Mon Oct 19</td><td>Trusses</td><td>3</td></tr></table>';
    expect(read(html)).toEqual(['Quiz 3 10/19']);
  });
});

describe('the week and the rule in different tables', () => {
  it('reads the rule from a grading table', () => {
    const html =
      '<table><tr><th>Week</th><th>Dates</th><th>Assessment</th></tr>' +
      '<tr><td>7</td><td>Oct 19 - 23</td><td>Quiz 2</td></tr></table>' +
      '<table><tr><th>Component</th><th>When</th></tr>' +
      '<tr><td>Quizzes</td><td>Mondays at 5:30 pm</td></tr></table>';
    expect(read(html)).toEqual(['Quiz 2 10/19 17:30']);
  });

  it('carries a week label row down its own table', () => {
    const html =
      '<table><tr><td colspan="2">Week 7 (Oct 19 - 23)</td></tr>' +
      '<tr><td>Trusses</td><td>Quiz 2</td></tr></table>' +
      RULES;
    expect(read(html)).toEqual(['Quiz 2 10/19 17:30']);
  });

  it('does not carry a week into the next table', () => {
    const html =
      '<table><tr><td>Week 7 (Oct 19 - 23)</td></tr></table>' +
      '<table><tr><td>Statics</td><td>Quiz 4</td></tr></table>' +
      RULES;
    expect(read(html)).toEqual([]);
  });
});

describe('an assessment cell spanning several dated rows', () => {
  const days =
    '<tr><td>Mon Oct 19</td><td>Trusses</td><td rowspan="3">Quiz 2</td></tr>' +
    '<tr><td>Wed Oct 21</td><td>Frames</td></tr>' +
    '<tr><td>Fri Oct 23</td><td>Beams</td></tr>';

  it('is left out: it covers three days and says none of them', () => {
    const html = `<table><tr><th>Date</th><th>Topic</th><th>Assessment</th></tr>${days}</table>`;
    expect(read(html)).toEqual([]);
  });

  it('is left out when it is a tick under a "Quiz" header', () => {
    const html =
      '<table><tr><th>Date</th><th>Topic</th><th>Quiz</th></tr>' +
      '<tr><td>Mon Oct 19</td><td>Trusses</td><td rowspan="3">✓</td></tr>' +
      '<tr><td>Wed Oct 21</td><td>Frames</td></tr><tr><td>Fri Oct 23</td><td>Beams</td></tr></table>';
    expect(read(html)).toEqual([]);
  });

  it('is placed when a week cell spans the same rows and a rule names the day', () => {
    const html =
      '<table><tr><th>Week</th><th>Date</th><th>Topic</th><th>Assessment</th></tr>' +
      '<tr><td rowspan="3">Week 7 (Oct 19 - 23)</td><td>Mon Oct 19</td><td>Trusses</td><td rowspan="3">Quiz 2</td></tr>' +
      '<tr><td>Wed Oct 21</td><td>Frames</td></tr><tr><td>Fri Oct 23</td><td>Beams</td></tr></table>' +
      RULES;
    expect(read(html)).toEqual(['Quiz 2 10/19 17:30']);
  });
});

describe('one numbered assessment given two different dates', () => {
  it('is left out rather than picking one', () => {
    expect(extractAssessments(['Quiz 2 | Oct 19', 'Quiz 2 | Oct 21'], FALL)).toEqual([]);
  });

  it('still keeps two separately dated unnumbered quizzes', () => {
    expect(extractAssessments(['Oct 5 - Quiz', 'Oct 19 - Quiz'], FALL)).toHaveLength(2);
  });
});
