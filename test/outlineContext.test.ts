/**
 * Reading an outline as a whole, not line by line.
 *
 * An outline often says when a quiz happens in two places: a schedule row
 * puts "Quiz 2" in week 7, and a paragraph elsewhere says quizzes are on
 * Mondays at 5:30. Neither line dates the quiz; together they do.
 */

import { describe, it, expect } from 'vitest';
import { termFrom } from '@core/syllabus/dates';
import { extractAssessments } from '@core/syllabus/extract';
import { buildWeekMap, readRules } from '@core/syllabus/context';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

interface Seen {
  readonly title: string;
  readonly when: string;
}

const read = (lines: readonly string[]): readonly Seen[] =>
  extractAssessments(lines, FALL).map((c) => {
    const d = new Date(c.dueAt);
    const time = c.hasTime ? ` ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return { title: c.title, when: `${d.getMonth() + 1}/${d.getDate()}${time}` };
  });

describe('a weekly rule and a week in the schedule', () => {
  it('puts the two together', () => {
    const lines = [
      'Quizzes are written in class on Mondays at 5:30',
      '| Week | Dates | Topic | Assessment |',
      '| 7 | Oct 19 - 23 | Trusses | Quiz 2 |',
    ];
    expect(read(lines)).toEqual([{ title: 'Quiz 2', when: '10/19 17:30' }]);
  });

  it('reads the week from prose, with the rule after it', () => {
    const lines = [
      '| 3 | Sept 21 - 25 | Vectors |',
      'Quiz 1 will be held during Week 3.',
      'Quizzes take place on Mondays at 5:30 pm.',
    ];
    expect(read(lines)).toEqual([{ title: 'Quiz 1', when: '9/21 17:30' }]);
  });

  it('reads a week heading above the item', () => {
    const lines = ['Week 9 (Nov 9 - 13)', 'Lab 4 due', 'Labs are due on Fridays at 11:59 pm'];
    expect(read(lines)).toEqual([{ title: 'Lab 4', when: '11/13 23:59' }]);
  });

  it('counts weeks forward from the one the outline dates', () => {
    const lines = ['| 1 | Sept 8 - 11 | Introduction |', 'Quiz 2 in week 4', 'Quizzes are on Mondays'];
    expect(read(lines)).toEqual([{ title: 'Quiz 2', when: '9/28' }]);
  });

  it('applies a rule only to its own kind', () => {
    const lines = ['Labs are due Fridays at 11:59 pm', '| 7 | Oct 19 - 23 | Quiz 3 |'];
    expect(read(lines)).toEqual([{ title: 'Quiz 3 (week of Oct 19)', when: '10/19' }]);
  });

  it('lets a written date win over the week', () => {
    const lines = ['Quiz 2 | Oct 21', '| 7 | Oct 19 - 23 | Quiz 2 |', 'Quizzes on Mondays at 5:30pm'];
    expect(read(lines)).toEqual([{ title: 'Quiz 2', when: '10/21' }]);
  });
});

describe('what the reviewers caught', () => {
  it('places a quiz in a week that crosses a month', () => {
    expect(read(['| 8 | Oct 26 - Nov 1 | Quiz 3 |', 'Quizzes are on Fridays'])).toEqual([
      { title: 'Quiz 3', when: '10/30' },
    ]);
  });

  it('does not number lectures or a review as a series', () => {
    expect(read(['Midterm review lectures | Oct 2 | Oct 16'])).toEqual([]);
    expect(read(['Quizzes: lectures Oct 2 and Oct 16'])).toEqual([]);
  });

  it('does not take advice as a rule', () => {
    expect(readRules(['Students are expected to do quizzes on Mondays when they feel ready'])).toEqual([]);
  });

  it('does not take a numbered grading row as a week', () => {
    expect(buildWeekMap(['| 10 | 20% | Nov 20 |'], FALL).size).toBe(0);
  });
});

describe('a week with no rule for the day', () => {
  it('still lists the item, for the start of its week', () => {
    expect(read(['| 7 | Oct 19 - 23 | Quiz 3 |'])).toEqual([{ title: 'Quiz 3 (week of Oct 19)', when: '10/19' }]);
  });

  it('does not take a rule naming two days', () => {
    const lines = ['Quizzes are on Mondays and Wednesdays', '| 7 | Oct 19 - 23 | Quiz 3 |'];
    expect(read(lines)).toEqual([{ title: 'Quiz 3 (week of Oct 19)', when: '10/19' }]);
  });

  it('ignores a review session in its week', () => {
    expect(read(['| 7 | Oct 19 - 23 | Review for midterm |'])).toEqual([]);
  });

  it('ignores an assessment named as a lecture topic', () => {
    expect(read(['| 7 | Oct 19 - 23 | Midterm review |', '| 5 | Oct 5 - 9 | Project introduction |'])).toEqual([]);
  });

  it('ignores a week with no classes', () => {
    expect(read(['| 6 | Oct 12 - 16 | Reading week, no quiz |'])).toEqual([]);
  });
});

describe('one assessment dated across several columns', () => {
  it('lists each date as its own quiz, numbered in order', () => {
    expect(read(['| Quizzes | Oct 2 | Oct 16 | Oct 30 | 15% |'])).toEqual([
      { title: 'Quiz 1', when: '10/2' },
      { title: 'Quiz 2', when: '10/16' },
      { title: 'Quiz 3', when: '10/30' },
    ]);
  });

  it('reads a singular name with its dates in a list', () => {
    expect(read(['Tutorial quiz: Sept 25, Oct 9, Oct 23, Nov 6']).map((s) => s.when)).toEqual([
      '9/25',
      '10/9',
      '10/23',
      '11/6',
    ]);
  });

  it('still refuses a makeup sitting', () => {
    expect(read(['Midterm Oct 23 (makeup Oct 30)'])).toEqual([]);
  });

  it('still refuses two dates offered as a choice', () => {
    expect(read(['Quiz 2 Oct 19 or Oct 21'])).toEqual([]);
  });

  it('does not number a series when the name already has a number', () => {
    expect(read(['Quiz 2 | Oct 19 | Oct 21'])).toEqual([]);
  });
});

describe('buildWeekMap', () => {
  it('maps week numbers to the Monday of each week', () => {
    const map = buildWeekMap(['| 1 | Sept 8 - 11 | Intro |', 'Week 9 (Nov 9 - 13)'], FALL);
    expect(map.get(1)).toEqual({ y: 2026, m: 9, d: 7 });
    expect(map.get(9)).toEqual({ y: 2026, m: 11, d: 9 });
  });
});

describe('readRules', () => {
  it('reads a bare clock time as an afternoon class time', () => {
    const rules = readRules(['Quizzes at 5:30 on Mondays']);
    expect(rules).toEqual([expect.objectContaining({ kind: 'quiz', weekday: 1, h: 17, m: 30 })]);
  });

  it('reads a morning time as morning', () => {
    expect(readRules(['Tests are held on Fridays at 9:30'])[0]).toEqual(
      expect.objectContaining({ kind: 'test', weekday: 5, h: 9, m: 30 }),
    );
  });

  it('ignores a line with no weekday', () => {
    expect(readRules(['Quizzes are worth 10% in total'])).toEqual([]);
  });
});

describe('an outline-site weekly schedule', () => {
  // Shaped like outline.uwaterloo.ca: empty spacer cells, a notes column
  // holding the week's work, and the lab rule written once elsewhere.
  const lines = [
    '| Week | | Dates | | Topic | | Readings | | Notes |',
    '| 8 | | Oct 26 - 30 | | 7. Loops | | Chapter 6 | | Lab 5: Loops & Decisions |',
    '| 9 | | Nov 2 - 6 | | 8. Arrays & Structs | | 10.1, Chapters 7 | | Midterm Exam: Monday November 2 at 5:00pm in E7 1000 and E7 1000 Lab 6: functions |',
    '| 10 | | Nov 9 - 13 | | 9. Pointers | | Chapter 8 | | Lab 7: pointers |',
    'Labs are submitted on Fridays by 11:59 pm.',
  ];

  it('dates every lab by the rule and keeps the midterm its written time', () => {
    expect(read(lines)).toEqual([
      { title: 'Lab 5', when: '10/30 23:59' },
      { title: 'Midterm', when: '11/2 17:00' },
      { title: 'Lab 6', when: '11/6 23:59' },
      { title: 'Lab 7', when: '11/13 23:59' },
    ]);
  });
});
