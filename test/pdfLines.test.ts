import { describe, it, expect } from 'vitest';
import { linesFromItems } from '@core/syllabus/pdfLines';
import { extractAssessments } from '@core/syllabus/extract';
import { termFrom } from '@core/syllabus/dates';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

/** A pdf.js text run at (x, y), about 5pt per character. */
const run = (str: string, x: number, y: number) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width: str.length * 5,
});

describe('linesFromItems', () => {
  it('joins runs on one baseline into one row, top of the page first', () => {
    const lines = linesFromItems([run('Week 2', 50, 600), run('Course Outline', 50, 700)]);
    expect(lines).toEqual(['Course Outline', 'Week 2']);
  });

  it('keeps words of one phrase together', () => {
    // "Quiz" ends at 70; "3" starts 3pt later.
    expect(linesFromItems([run('Quiz', 50, 500), run('3', 73, 500)])).toEqual(['Quiz 3']);
  });

  it('marks a wide gap as a column break', () => {
    const lines = linesFromItems([
      run('Quiz 3', 50, 500),
      run('Nov 13', 200, 500),
      run('Submit through Turnitin', 320, 500),
    ]);
    expect(lines).toEqual(['Quiz 3 | Nov 13 | Submit through Turnitin']);
  });

  it('lets a notes column sit beside a real quiz', () => {
    const lines = linesFromItems([
      run('Quiz 3', 50, 500),
      run('Nov 13', 200, 500),
      run('Submit through Turnitin', 320, 500),
    ]);
    expect(extractAssessments(lines, FALL).map((c) => c.title)).toEqual(['Quiz 3']);
  });

  it('falls back to a space when a run has no width', () => {
    expect(linesFromItems([{ str: 'Lab', transform: [1, 0, 0, 1, 10, 5] }, run('2', 400, 5)])).toEqual([
      'Lab 2',
    ]);
  });

  it('skips blank and malformed runs', () => {
    expect(linesFromItems([run('  ', 1, 1), { str: 'x' }, { str: 'ok', transform: [1, 0, 0, 1, 0, 0] }])).toEqual([
      'ok',
    ]);
  });
});
