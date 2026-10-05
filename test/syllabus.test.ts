import { describe, it, expect } from 'vitest';
import { findDate, inferYear, termFrom, withinTerm, maskNonDates } from '@core/syllabus/dates';
import { extractAssessments, readAssessmentLine, readLine, readTime, readWeight, buildTitle } from '@core/syllabus/extract';
import { toLines } from '@sync/syllabusSync';

/** Fall 2026: starts September, runs into December. */
const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

const one = (line: string) => readAssessmentLine(line, FALL);

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
    expect(buildTitle('Midterm 2 on Oct 14', 'midterm', 'Oct 14')).toBe('Midterm 2');
  });

  it('falls back to the assessment name when there is no ordinal', () => {
    expect(buildTitle('Midterm Oct 14', 'midterm', 'Oct 14')).toBe('Midterm');
  });
});

describe('reads an exam with its date on the same line', () => {
  it('reads a midterm with a full date', () => {
    const c = one('Midterm Exam: Friday, October 23, 2026');
    expect(c?.title).toContain('Midterm');
    expect(c?.date).toEqual({ y: 2026, m: 10, d: 23 });
  });

  it('reads a midterm with a weekday, short date and time', () => {
    expect(one('Midterm – Fri Oct 23, 7pm')?.date).toEqual({ y: 2026, m: 10, d: 23 });
  });

  it('reads a schedule row naming the midterm', () => {
    expect(one('Week 7 | Oct 23 | Midterm (in class)')?.title).toBe('Midterm');
  });

  it('reads a dated final exam', () => {
    expect(one('Final Exam: December 14, 2026, 9:00am, PAC')?.title).toBe('Final Exam');
  });

  it('reads a term test', () => {
    expect(one('Term Test 2 - Nov 18')?.title).toBe('Term Test 2');
  });

  it('picks up a stated weight', () => {
    expect(one('Midterm, Oct 23, worth 25%')?.weightPct).toBe(25);
  });

  it('keeps the source line so the panel can show it', () => {
    const line = 'Midterm Exam - Oct 23';
    expect(one(line)?.sourceLine).toBe(line);
  });
});

describe('reads other dated assessments', () => {
  it('reads a quiz in a schedule row', () => {
    const c = one('Week 7 | Mon Oct 19 | Quiz 2');
    expect(c?.title).toBe('Quiz 2');
    expect(c?.kind).toBe('quiz');
    expect(c?.date).toEqual({ y: 2026, m: 10, d: 19 });
  });

  it('reads a quiz written day-first with a dash', () => {
    expect(one('19-Oct | Quiz 2')?.date).toEqual({ y: 2026, m: 10, d: 19 });
  });

  it('reads an assignment due date', () => {
    const c = one('Assignment 4 due November 6');
    expect(c?.title).toBe('Assignment 4');
    expect(c?.kind).toBe('assignment');
  });

  it('reads a tutorial test as a test', () => {
    const c = one('Tutorial Test 3 - Oct 28 - covers sections 4.1 to 4.6');
    expect(c?.title).toBe('Tutorial Test 3');
    expect(c?.kind).toBe('test');
  });

  it('reads a lab exam as one exam, not a lab and an exam', () => {
    const all = readLine('Lab exam Oct 30', FALL);
    expect(all.map((c) => c.title)).toEqual(['Lab Exam']);
  });

  it('reads a lab report as a lab', () => {
    expect(one('Lab Report 2 due Nov 4')?.kind).toBe('lab');
  });

  it('treats "Midterm Exam" and "Midterm Test" as one assessment', () => {
    expect(readLine('Midterm Exam Oct 23', FALL)).toHaveLength(1);
    expect(readLine('Midterm Test Oct 23', FALL)).toHaveLength(1);
  });

  it('reads two different assessments on one row, without a shared weight', () => {
    const all = readLine('Oct 19 | Quiz 2, Assignment 3 due | 5%', FALL);
    expect(all.map((c) => c.title)).toEqual(['Quiz 2', 'Assignment 3']);
    expect(all.every((c) => c.weightPct === null)).toBe(true);
  });

  it('takes the due date when a row also says when work was released', () => {
    expect(one('Assignment 2: out Oct 1, due Oct 15')?.date).toEqual({ y: 2026, m: 10, d: 15 });
  });

  it('keeps the weight when a row names one assessment', () => {
    expect(one('Quiz 1 - Sept 30 - 5%')?.weightPct).toBe(5);
  });
});

describe('refuses to guess', () => {
  it('ignores a release date', () => {
    expect(one('Assignment 3 released Oct 2')).toBeNull();
  });

  it('ignores a policy line about quizzes in general', () => {
    expect(one('Quizzes are held weekly starting Sept 15')).toBeNull();
  });

  it('ignores two dates when neither is marked due', () => {
    expect(one('Quiz 2 Oct 19 or Oct 21')).toBeNull();
  });

  it('ignores a practice quiz', () => {
    expect(one('Practice quiz Oct 9')).toBeNull();
  });

  it('never invents a quiz from a negation', () => {
    expect(one('Oct 12 - No quiz this week')).toBeNull();
  });

  it('ignores "hypothesis testing" as a lecture topic', () => {
    expect(one('Oct 14 - Hypothesis testing')).toBeNull();
  });

  it('ignores "midterm week", which is a window rather than a day', () => {
    expect(one('Midterm week of Oct 19')).toBeNull();
  });

  it('ignores a final scheduled in the exam period', () => {
    expect(one('Final exam during the exam period, Dec 9 to Dec 23')).toBeNull();
  });

  it('ignores a date range', () => {
    expect(one('Midterm Oct 20-24')).toBeNull();
  });

  it('ignores a line with two dates', () => {
    expect(one('Midterm Oct 23 (makeup Oct 30)')).toBeNull();
  });

  it('ignores a final set by the registrar', () => {
    expect(one('Final Exam - date set by the Registrar, Dec 2026')).toBeNull();
  });

  it('ignores TBA', () => {
    expect(one('Midterm: Oct 23 TBA')).toBeNull();
  });

  it('ignores a weekday that disagrees with the date', () => {
    // Oct 23 2026 is a Friday. A mismatch means something is wrong, so no item.
    expect(one('Midterm Monday Oct 23')).toBeNull();
  });

  it('ignores a review session', () => {
    expect(one('Oct 21 - Review for midterm')).toBeNull();
  });

  it('ignores a practice exam', () => {
    expect(one('Practice exam posted Oct 20')).toBeNull();
  });

  it('never invents a midterm from a negation', () => {
    expect(one('Oct 23 - No midterm this term')).toBeNull();
  });

  it('ignores an exam with no date at all', () => {
    expect(one('There will be a midterm and a final exam')).toBeNull();
  });

  it('ignores reading week', () => {
    expect(one('Oct 12 - Reading Week, no classes, no exam')).toBeNull();
  });

  it('does not mistake "syllabus" for a lab', () => {
    // The lab veto is word-bounded; a substring match would drop this line.
    expect(one('Midterm (see syllabus) Oct 23')?.title).toBe('Midterm');
  });
});

describe('extractExams on a realistic outline', () => {
  const lines = [
    'MATH 135 Course Outline, Fall 2026',
    'Instructor office hours: Mondays 2-4pm',
    'Week 1 - Sept 8 - Introduction to proofs',
    'Tutorial Test 1 - Sept 23 - 5%',
    'Assignment 2 due Oct 2',
    'Office hours: Tuesdays from Sept 9',
    'Oct 12 to 16 - Reading Week, no classes',
    'Midterm Exam - Friday October 23, 2026 - 25%',
    'Nov 7 - Last day to drop',
    'Final Exam - date set by the Registrar',
  ];

  it('finds every dated assessment and nothing else', () => {
    expect(extractAssessments(lines, FALL).map((c) => c.title)).toEqual([
      'Tutorial Test 1',
      'Assignment 2',
      'Midterm',
    ]);
  });

  it('keeps two undated-ordinal quizzes apart by date', () => {
    const found = extractAssessments(['Oct 5 - Quiz', 'Oct 19 - Quiz'], FALL);
    expect(found.map((c) => c.title)).toEqual(['Quiz (Oct 5)', 'Quiz (Oct 19)']);
  });

  it('returns exams in date order', () => {
    const found = extractAssessments(['Midterm 2 Nov 20', 'Midterm 1 Oct 16'], FALL);
    expect(found.map((c) => c.title)).toEqual(['Midterm 1', 'Midterm 2']);
  });

  it('collapses the same exam named twice, keeping the weighted reading', () => {
    const found = extractAssessments(['Midterm Exam October 23, 2026', 'Midterm Exam - Oct 23 - 25%'], FALL);
    expect(found).toHaveLength(1);
    expect(found[0]?.weightPct).toBe(25);
  });
});

describe('toLines', () => {
  it('removes script contents, not just the tags', () => {
    // Page code reaching the assessment reader looks like prose full of braces
    // and regular expressions, which is noise at best and a false match at worst.
    const html = '<p>Midterm Oct 23</p><script>if (/test/.test(x)) { quiz(); }</script>';
    const lines = toLines(html);
    expect(lines.join(' ')).not.toContain('querySelector');
    expect(lines.join(' ')).not.toContain('quiz()');
    expect(lines.join(' ')).toContain('Midterm Oct 23');
  });

  it('removes style blocks', () => {
    const lines = toLines('<style>.exam { color: red }</style><p>Lab 1 Sept 15</p>');
    expect(lines.join(' ')).not.toContain('color');
  });

  it('removes comments', () => {
    const lines = toLines('<!-- Quiz 9 Dec 1 --><p>Quiz 1 Oct 2</p>');
    expect(lines.join(' ')).not.toContain('Dec 1');
  });

  it('keeps a table row on one line so a date and a name stay together', () => {
    const row = '<tr><td>Oct 28</td><td>Tutorial Test 3</td></tr>';
    const lines = toLines(row);
    expect(lines[0]).toContain('Oct 28');
    expect(lines[0]).toContain('Tutorial Test 3');
  });
});

describe('outline-site page layout', () => {
  // Shaped like outline.uwaterloo.ca: cells indented across source lines,
  // schedule cells wrapped in <p>, weights as bare numbers.
  const page = `<html><body>
    <table class="multitable"><tbody>
      <tr>
        <td>
          Unit 1 - Quiz
        </td>
        <td>
          October 2nd
        </td>
        <td>
          In-person
        </td>
      </tr>
      <tr>
        <td>
          Unit 2 - Tutorial activity
        </td>
        <td>
          October 23rd
        </td>
      </tr>
    </tbody></table>
    <table><tr><td><p>Dec 8th</p></td><td><p>L23</p></td><td><p>Quiz 4</p></td></tr></table>
    <table><tr><td><p>Unit 4 - Quiz</p></td><td><p>December 8th</p></td></tr></table>
  </body></html>`;

  it('keeps each table row on one line', () => {
    const lines = toLines(page);
    expect(lines.some((l) => l.includes('Unit 1 - Quiz') && l.includes('October 2nd'))).toBe(true);
    expect(lines.some((l) => l.includes('Dec 8th') && l.includes('Quiz 4'))).toBe(true);
  });

  it('reads the quizzes and tutorial activities, named by unit', () => {
    const found = extractAssessments(toLines(page), FALL);
    expect(found.map((c) => c.title)).toEqual([
      'Unit 1 Quiz',
      'Unit 2 Tutorial Activity',
      'Unit 4 Quiz',
    ]);
  });

  it('keeps plain text line breaks', () => {
    expect(toLines('Quiz 1 Oct 2\nQuiz 2 Oct 9')).toEqual(['Quiz 1 Oct 2', 'Quiz 2 Oct 9']);
  });
});

describe('a schedule row with a week span and a dated note', () => {
  // Shaped like the ENGR 121 Fall 2026 weekly schedule.
  const row =
    '| 9 | | Nov 2 - 6 | | 8. Arrays & Structs | | 10.1, Chapters 7 | | Midterm Exam: Monday November 2 at 5:00pm in RCH 100 and RCH 100 Lab 6: functions |';

  it('reads the midterm from its own note, with its time', () => {
    const found = readLine(row, FALL);
    expect(found.map((c) => c.title)).toEqual(['Midterm']);
    const due = new Date(found[0]?.dueAt ?? 0);
    expect([due.getMonth() + 1, due.getDate(), due.getHours(), due.getMinutes()]).toEqual([11, 2, 17, 0]);
    expect(found[0]?.hasTime).toBe(true);
  });

  it('does not give the undated lab in the same cell the midterm date', () => {
    expect(readLine(row, FALL).some((c) => c.kind === 'lab')).toBe(false);
  });

  it('still refuses a row whose only dates are the week span', () => {
    expect(readLine('| 8 | | Oct 26 - 30 | | Lab 5: Loops & Decisions |', FALL)).toEqual([]);
  });
});

describe('readTime', () => {
  it('reads a time written after the date', () => {
    expect(readTime('Midterm Monday November 2 at 5:00pm', 'November 2')).toEqual({ h: 17, m: 0 });
    expect(readTime('Midterm Oct 23, 7 pm', 'Oct 23')).toEqual({ h: 19, m: 0 });
    expect(readTime('Quiz Oct 23 9:30 a.m.', 'Oct 23')).toEqual({ h: 9, m: 30 });
  });

  it('refuses a time span rather than picking an end', () => {
    expect(readTime('Lab 3 Oct 6 2:30-4:20pm', 'Oct 6')).toBeNull();
  });

  it('needs am or pm', () => {
    expect(readTime('Midterm Oct 23 in room 10', 'Oct 23')).toBeNull();
  });

  it('leaves an untimed date all-day', () => {
    expect(readLine('Quiz 1 - Sept 30 - 5%', FALL)[0]?.hasTime).toBe(false);
  });
});
