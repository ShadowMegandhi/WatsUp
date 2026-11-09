/**
 * Outline recall: dated work the reader used to drop.
 *
 * A student reported quizzes and a task due on the 13th vanishing from an
 * outline they could see plainly. Each case here is a shape a real outline
 * takes that the stricter reader refused.
 */

import { describe, it, expect } from 'vitest';
import { findDate, termFrom } from '@core/syllabus/dates';
import { extractAssessments, readLine } from '@core/syllabus/extract';
import { looksLikeSame } from '@core/syllabus/toItems';
import { toLines } from '@sync/syllabusSync';
import type { TaskItem, TaskKind } from '@core/types';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

const titles = (lines: readonly string[]): readonly string[] =>
  extractAssessments(lines, FALL).map((c) => c.title);

const dayOf = (lines: readonly string[]): readonly string[] =>
  extractAssessments(lines, FALL).map((c) => {
    const d = new Date(c.dueAt);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

describe('names the reader did not know', () => {
  it('reads an activity', () => {
    expect(titles(['| Activity 3 | Nov 13 | 2% |'])).toEqual(['Activity 3']);
  });

  it('reads a task', () => {
    expect(titles(['Task 2 due Friday, November 13'])).toEqual(['Task 2']);
  });

  it('reads a worksheet, an exercise and a case study', () => {
    expect(titles(['Worksheet 4 - Nov 3', 'Exercise 2: Oct 30', 'Case Study 1 due Nov 20'])).toEqual([
      'Exercise 2',
      'Worksheet 4',
      'Case Study 1',
    ]);
  });

  it('reads an in-class check-in and a checkpoint', () => {
    expect(titles(['Check-in 2 | Oct 27', 'Project Checkpoint 1 | Nov 10'])).toHaveLength(2);
  });

  it('still ignores the plural, which describes a policy', () => {
    expect(titles(['Activities are completed weekly starting Sept 15'])).toEqual([]);
  });
});

describe('a table row with a notes cell', () => {
  it('keeps an assignment whose notes say where it is posted', () => {
    expect(titles(['| Assignment 4 | Nov 13 | 10% | Posted on LEARN, submit to Crowdmark |'])).toEqual([
      'Assignment 4',
    ]);
  });

  it('keeps a midterm whose notes mention accommodations', () => {
    expect(
      titles(['| Midterm | Oct 22 | 25% | Contact AccessAbility Services for accommodations |']),
    ).toEqual(['Midterm']);
  });

  it('keeps a quiz submitted through Turnitin', () => {
    expect(titles(['| Quiz 3 | Nov 13 | Submit through Turnitin |'])).toEqual(['Quiz 3']);
  });

  it('still drops a release date in the date cell', () => {
    expect(titles(['| Assignment 5 | Released Nov 13 |'])).toEqual([]);
  });

  it('still drops a practice quiz', () => {
    expect(titles(['| Practice Quiz | Nov 13 |'])).toEqual([]);
  });
});

describe('a release word beside a marked due date', () => {
  it('keeps the due date', () => {
    expect(titles(['Assignment 3 due Nov 13 (questions posted Oct 30)'])).toEqual(['Assignment 3']);
  });

  it('keeps a single marked due date even with the word posted', () => {
    expect(titles(['Assignment 6 is posted on LEARN and due Nov 27'])).toEqual(['Assignment 6']);
  });
});

describe('a name and its date on neighbouring lines', () => {
  it('pairs a name with a date-only line below it', () => {
    expect(titles(['Quiz 3', 'Friday, November 13'])).toEqual(['Quiz 3']);
    expect(dayOf(['Quiz 3', 'Friday, November 13'])).toEqual(['11/13']);
  });

  it('pairs a name with a labelled due line, keeping its time', () => {
    const found = extractAssessments(['Assignment 2: Statics', 'Due: Nov 13 at 11:00 pm'], FALL);
    expect(found.map((c) => c.title)).toEqual(['Assignment 2']);
    expect(found[0]?.hasTime).toBe(true);
    expect(new Date(found[0]?.dueAt ?? 0).getHours()).toBe(23);
  });

  it('pairs a date-only line with the name below it', () => {
    expect(titles(['November 13', 'Lab Report 2'])).toEqual(['Lab Report 2']);
  });

  it('does not pair a name with a lecture line that happens to carry a date', () => {
    expect(titles(['Lab 3', 'Oct 13 - Introduction to circuits and Kirchhoff laws'])).toEqual([]);
  });

  it('does not pair a line that already names its own assessment', () => {
    expect(titles(['Quiz 1', 'Quiz 2', 'Oct 13'])).toEqual(['Quiz 2']);
  });

  it('skips a release line to reach the due line below it', () => {
    expect(dayOf(['Assignment 1', 'Released: Sept 15', 'Due: Sept 29'])).toEqual(['9/29']);
  });

  it('does not take a release date as the due date', () => {
    expect(titles(['Assignment 1', 'Released: Sept 15'])).toEqual([]);
  });

  it('gives each name the date above it when dates come first', () => {
    expect(dayOf(['Oct 10', 'Quiz 1', 'Oct 24', 'Quiz 2'])).toEqual(['10/10', '10/24']);
  });

  it('gives each name the date below it when names come first', () => {
    expect(dayOf(['Quiz 1', 'Oct 10', 'Quiz 2', 'Oct 24'])).toEqual(['10/10', '10/24']);
  });

  it('refuses a name between two dates when the layout does not say which', () => {
    expect(titles(['Oct 10', 'Quiz 1', 'Oct 24'])).toEqual([]);
  });

  it('does not pair across a negation', () => {
    expect(titles(['No quiz this week', 'Oct 13'])).toEqual([]);
  });
});

describe('numeric dates', () => {
  it('reads month/day when the day cannot be a month', () => {
    expect(findDate('Assignment due 11/13', FALL)?.date).toEqual({ y: 2026, m: 11, d: 13 });
  });

  it('reads day/month the same way', () => {
    expect(findDate('Quiz on 13/11', FALL)?.date).toEqual({ y: 2026, m: 11, d: 13 });
  });

  it('reads an ISO date', () => {
    expect(findDate('Due 2026-11-13', FALL)?.date).toEqual({ y: 2026, m: 11, d: 13 });
  });

  it('refuses a slash date that reads two ways', () => {
    expect(findDate('Assignment due 10/11', FALL)).toBeNull();
  });

  it('refuses a same-number pair, which is usually a full score', () => {
    expect(titles(['Quiz 1 | 10/10 | worth 5%'])).toEqual([]);
  });

  it('refuses a numeric range rather than picking a day', () => {
    expect(titles(['Quiz 1 11/13-15'])).toEqual([]);
    expect(titles(['Quiz 1 11/13 to 11/15'])).toEqual([]);
  });

  it('refuses a score', () => {
    expect(findDate('Quiz 1 mark: 11/15 points', FALL)).toBeNull();
    expect(titles(['Quiz 1: 8/10'])).toEqual([]);
  });
});

describe('pasted outline text', () => {
  it('turns tab-separated cells into table cells', () => {
    const lines = toLines('Quiz 3\tNov 13\t5%\nAssignment 4\tNov 20\t10%');
    expect(lines).toEqual(['Quiz 3 | Nov 13 | 5%', 'Assignment 4 | Nov 20 | 10%']);
    expect(titles(lines)).toEqual(['Quiz 3', 'Assignment 4']);
  });
});

describe('a long schedule row', () => {
  it('is still read', () => {
    const notes = 'Read chapters 7 and 8 before class; bring a calculator and the formula sheet. '.repeat(4);
    expect(readLine(`| 10 | Nov 13 | ${notes} | Quiz 4 |`, FALL).map((c) => c.title)).toEqual(['Quiz 4']);
  });
});

describe('matching an outline item to a LEARN one', () => {
  const item = (title: string, kind: TaskKind, month: number, day: number): TaskItem =>
    ({
      id: title,
      courseId: 'c',
      title,
      kind,
      dueAt: new Date(2026, month - 1, day, 23, 59).getTime(),
      availableFrom: null,
      endsAt: null,
      isAllDay: true,
      weightPct: null,
      url: '',
      sources: [],
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: '',
      firstSeenAt: 0,
      lastSyncedAt: 0,
    }) as TaskItem;

  it('keeps an in-class quiz a few days from a numbered online quiz', () => {
    expect(looksLikeSame(item('Quiz', 'quiz', 11, 13), item('Quiz 4', 'quiz', 11, 9))).toBe(false);
  });

  it('keeps a midterm that only shares a word with a survey', () => {
    expect(
      looksLikeSame(item('Midterm', 'exam', 10, 22), item('Midterm Feedback Survey', 'quiz', 10, 24)),
    ).toBe(false);
  });

  it('does not read the date in a disambiguated title as a number', () => {
    expect(looksLikeSame(item('Quiz (Nov 13)', 'quiz', 11, 13), item('Quiz', 'quiz', 11, 13))).toBe(true);
  });

  it('still matches the same numbered assignment a few days apart', () => {
    expect(
      looksLikeSame(item('Assignment 3', 'assignment', 11, 13), item('Assignment 3', 'assignment', 11, 16)),
    ).toBe(true);
  });

  it('still matches an unnumbered name to a numbered one on the same day', () => {
    expect(looksLikeSame(item('Quiz', 'quiz', 11, 13), item('Quiz 4', 'quiz', 11, 13))).toBe(true);
  });
});

describe('a realistic mixed outline', () => {
  const lines = [
    'SYDE 161 Course Outline - Fall 2026',
    'Office hours: Tuesdays 2:30-3:30pm, starting Sept 15',
    'Textbook: Engineering Design, 5th edition (ISBN 978-0-07-339814-2)',
    'Assessment | Weight | Date',
    'Quiz 1 | 5% | Sept 28',
    'Quiz 2 | 5% | Oct 19',
    'In-class activity 3 | 2% | Wednesday, October 21',
    'Design Project Proposal | 10% | Oct 30, submit to Crowdmark',
    'Midterm | 25% | Thursday October 22, 7:00 pm, see accommodations section',
    'Final Exam | 40% | Scheduled by the Registrar',
    '| Week 6 | Oct 12 - 16 | Reading week, no classes |',
    '| Week 7 | Oct 19 | Lecture 13: Problem framing; in-class exercises |',
    '| Week 8 | Oct 26 | Lecture 15: Prototyping. Practice quiz posted |',
    'Task 2',
    'Due: Friday, November 13 at 11:59 pm',
    'Quizzes are held in tutorial every second week.',
    'Nov 13 - Last day to drop with WD',
    'Academic integrity: see Policy 71. Assignment 4 copyright notice, Nov 2',
  ];

  it('finds the dated work and nothing else', () => {
    expect(titles(lines)).toEqual([
      'Quiz 1',
      'Quiz 2',
      'In-Class Activity 3',
      'Midterm',
      'Proposal',
      'Task 2',
    ]);
  });
});

describe('a date followed by more day numbers', () => {
  // "Discussion post: Nov 9th, 12th and 13th" names three days; only the
  // first carries a month, so it used to read as the 9th alone.
  it('is a list of days, not one date, and is left out', () => {
    expect(titles(['Discussion post | Nov 9th, 12th and 13th'])).toEqual([]);
    expect(titles(['Discussion post: Nov 9, 12 & 13'])).toEqual([]);
    expect(titles(['Quiz 1 on Nov 9 and 12'])).toEqual([]);
    expect(titles(['Reflection due Nov 9/12/13'])).toEqual([]);
  });

  it('still reads a date followed by a time, a year or a weight', () => {
    expect(dayOf(['Quiz 2 Nov 9, 11:59 pm'])).toEqual(['11/9']);
    expect(titles(['Assignment 3 due Nov 13, 2026'])).toEqual(['Assignment 3']);
    expect(titles(['Midterm | Oct 23, 25%'])).toEqual(['Midterm']);
  });
});
