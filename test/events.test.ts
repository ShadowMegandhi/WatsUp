import { describe, it, expect } from 'vitest';
import { parseDatedEvents, findFullDate, findKind, findCourseCode, nthActual } from '../src/portal/events';

describe('findFullDate', () => {
  it('reads the format a calendar prints', () => {
    expect(findFullDate('Friday, September 18, 2026')).toEqual({ y: 2026, m: 9, d: 18 });
  });

  it('reads an abbreviated month', () => {
    expect(findFullDate('Oct 3, 2026')).toEqual({ y: 2026, m: 10, d: 3 });
  });

  it('reads a day-first form', () => {
    expect(findFullDate('18 September 2026')).toEqual({ y: 2026, m: 9, d: 18 });
  });

  it('requires a year, because inferring one is the thing being avoided', () => {
    expect(findFullDate('Friday, September 18')).toBeNull();
  });

  it('rejects an impossible day', () => {
    expect(findFullDate('February 30, 2026')).toBeNull();
  });
});

describe('findKind', () => {
  it.each([
    ['MATH 102 Laboratory', 'LAB'],
    ['ECE 106 Tutorial', 'TUT'],
    ['Lecture - Induction', 'LEC'],
    ['Midterm Exam', 'TST'],
  ])('reads %s as %s', (text, expected) => {
    expect(findKind(text)).toBe(expected);
  });

  it('returns null when nothing names a component', () => {
    expect(findKind('Mind Body Run')).toBeNull();
  });
});

describe('findCourseCode', () => {
  it('finds a course code in surrounding text', () => {
    expect(findCourseCode('MATH 102 Tutorial, MC 4000')).toBe('MATH 102');
  });

  it('does not mistake a component label for a course', () => {
    expect(findCourseCode('TUT 102 Thursday')).toBeNull();
  });
});

describe('parseDatedEvents', () => {
  // Shaped like the Portal calendar text that was actually captured.
  const text = [
    'My calendar Events',
    'MATH 102 Tutorial 102',
    'Organized by Mathematics Thursday, September 18, 2026',
    '11:30 AM (EDT) 12:20 PM (EDT)',
    'MATH 102 Tutorial 102',
    'Organized by Mathematics Thursday, October 2, 2026',
    '11:30 AM (EDT) 12:20 PM (EDT)',
    'Mind Body Run',
    'Organized by Campus Wellness Tuesday, September 22, 2026',
    '4:00 PM (EDT) 5:00 PM (EDT)',
  ].join('\n');

  it('finds every dated entry', () => {
    expect(parseDatedEvents(text)).toHaveLength(3);
  });

  it('reads the real date rather than deriving one', () => {
    const first = parseDatedEvents(text)[0];
    expect(new Date(first?.startsAt ?? 0).getDate()).toBe(18);
    expect(new Date(first?.startsAt ?? 0).getMonth()).toBe(8);
  });

  it('reads the start time', () => {
    const first = parseDatedEvents(text)[0];
    expect(new Date(first?.startsAt ?? 0).getHours()).toBe(11);
    expect(new Date(first?.startsAt ?? 0).getMinutes()).toBe(30);
  });

  it('attaches a course and component when the text names them', () => {
    const tut = parseDatedEvents(text).find((e) => e.courseCode === 'MATH 102');
    expect(tut?.kind).toBe('TUT');
  });

  it('keeps unrelated campus events out of any course', () => {
    const run = parseDatedEvents(text).find((e) => e.title.includes('Mind Body'));
    expect(run?.courseCode).toBeNull();
  });

  it('returns events in date order', () => {
    // Compared as instants, not day numbers: 18 Sep, 22 Sep, 2 Oct is ordered
    // correctly even though the day numbers descend at the month boundary.
    const starts = parseDatedEvents(text).map((e) => e.startsAt);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts).toHaveLength(3);
  });

  it('finds nothing in text with no dates', () => {
    expect(parseDatedEvents('Welcome to Portal')).toEqual([]);
  });
});

describe('nthActual', () => {
  // Biweekly labs, which is exactly the case a weekly pattern gets wrong.
  const text = [
    'MATH 102 Lab',
    'Wednesday, September 17, 2026',
    '2:30 PM 5:20 PM',
    'MATH 102 Lab',
    'Wednesday, October 1, 2026',
    '2:30 PM 5:20 PM',
    'MATH 102 Lab',
    'Wednesday, October 15, 2026',
    '2:30 PM 5:20 PM',
  ].join('\n');

  const events = parseDatedEvents(text);

  it('counts real meetings, so a fortnightly gap is respected', () => {
    // A weekly pattern would have put Lab 3 on 1 October, two weeks early.
    const third = nthActual(events, 'MATH 102', 'LAB', 3);
    expect(new Date(third?.startsAt ?? 0).getDate()).toBe(15);
    expect(new Date(third?.startsAt ?? 0).getMonth()).toBe(9);
  });

  it('matches a course code however it is spaced', () => {
    expect(nthActual(events, 'MATH102', 'LAB', 1)).not.toBeNull();
  });

  it('returns nothing rather than guessing past the last meeting', () => {
    expect(nthActual(events, 'MATH 102', 'LAB', 9)).toBeNull();
  });

  it('returns nothing for a component with no meetings', () => {
    expect(nthActual(events, 'MATH 102', 'TUT', 1)).toBeNull();
  });
});
