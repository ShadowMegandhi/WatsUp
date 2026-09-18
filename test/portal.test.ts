import { describe, it, expect } from 'vitest';
import { parseDays, parseClock, parseKind, parseScheduleText, findDateRange } from '../src/portal/parse';
import { nthOccurrence, findMeeting, type SectionMeeting, type TermSchedule } from '@core/schedule/types';

describe('parseDays', () => {
  it('reads a Monday Wednesday Friday pattern', () => {
    expect(parseDays('MWF')).toEqual([1, 3, 5]);
  });

  it('reads Th as Thursday, not Tuesday plus something', () => {
    expect(parseDays('TTh')).toEqual([2, 4]);
  });

  it('reads a full week', () => {
    expect(parseDays('MTWThF')).toEqual([1, 2, 3, 4, 5]);
  });

  it('ignores separators', () => {
    expect(parseDays('M/W/F')).toEqual([1, 3, 5]);
  });

  it('returns nothing for text that is not a day set', () => {
    expect(parseDays('1234')).toEqual([]);
  });
});

describe('parseClock', () => {
  it('reads a 24 hour time', () => {
    expect(parseClock('14:30')).toBe(14 * 60 + 30);
  });

  it('reads an afternoon 12 hour time', () => {
    expect(parseClock('2:30PM')).toBe(14 * 60 + 30);
  });

  it('reads a morning 12 hour time', () => {
    expect(parseClock('9:05 a.m.')).toBe(9 * 60 + 5);
  });

  it('handles noon and midnight correctly', () => {
    expect(parseClock('12:00PM')).toBe(12 * 60);
    expect(parseClock('12:00AM')).toBe(0);
  });

  it('returns null when there is no time', () => {
    expect(parseClock('MWF')).toBeNull();
  });
});

describe('parseKind', () => {
  it.each([
    ['LEC 001', 'LEC'],
    ['LAB 102', 'LAB'],
    ['TUT 205', 'TUT'],
    ['TST 101', 'TST'],
  ])('reads %s as %s', (line, expected) => {
    expect(parseKind(line)).toBe(expected);
  });

  it('returns null for a line with no component', () => {
    expect(parseKind('MATH 135 Algebra')).toBeNull();
  });
});

describe('parseScheduleText', () => {
  const text = [
    'MATH 135 - Algebra for Honours Mathematics',
    'LEC 001 MWF 10:30AM - 11:20AM MC 4000',
    'TUT 102 Th 2:30PM - 3:20PM MC 4000',
    'ECE 106 - Electricity and Magnetism',
    'LEC 002 TTh 8:30AM - 9:50AM E7 4000',
    'LAB 103 W 2:30PM - 5:20PM E7 5000',
  ].join('\n');

  it('finds every component across courses', () => {
    expect(parseScheduleText(text)).toHaveLength(4);
  });

  it('attaches components to the course above them', () => {
    const tut = parseScheduleText(text).find((m) => m.kind === 'TUT');
    expect(tut?.courseCode).toBe('MATH 135');
  });

  it('reads the day and start time', () => {
    const lab = parseScheduleText(text).find((m) => m.kind === 'LAB');
    expect(lab?.pattern.days).toEqual([3]);
    expect(lab?.pattern.startMinute).toBe(14 * 60 + 30);
  });

  it('keeps the section label the student sees', () => {
    const tut = parseScheduleText(text).find((m) => m.kind === 'TUT');
    expect(tut?.section).toBe('TUT 102');
  });

  it('reads the room without mistaking it for the course code', () => {
    const lec = parseScheduleText(text).find((m) => m.courseCode === 'MATH 135' && m.kind === 'LEC');
    expect(lec?.pattern.location).toBe('MC 4000');
  });

  it('returns nothing for text with no schedule in it', () => {
    expect(parseScheduleText('Welcome to Portal. You have 3 new messages.')).toEqual([]);
  });
});

describe('nthOccurrence', () => {
  // Term starts Monday 8 September 2026.
  const termStart = new Date(2026, 8, 7).getTime();

  const tutorial: SectionMeeting = {
    courseCode: 'MATH 135',
    kind: 'TUT',
    section: 'TUT 102',
    pattern: { days: [4], startMinute: 14 * 60 + 30, endMinute: null, location: null },
    startsOn: null,
    endsOn: null,
  };

  it('finds the first meeting', () => {
    const at = nthOccurrence(tutorial, 1, termStart);
    expect(new Date(at ?? 0).getDay()).toBe(4);
    expect(new Date(at ?? 0).getDate()).toBe(10);
  });

  it('counts occurrences, not calendar weeks', () => {
    // Tutorial 3 is the third time it actually meets.
    const at = nthOccurrence(tutorial, 3, termStart);
    expect(new Date(at ?? 0).getDate()).toBe(24);
  });

  it('applies the start time', () => {
    const at = nthOccurrence(tutorial, 1, termStart);
    expect(new Date(at ?? 0).getHours()).toBe(14);
    expect(new Date(at ?? 0).getMinutes()).toBe(30);
  });

  it('refuses a meeting with no days', () => {
    const broken = { ...tutorial, pattern: { ...tutorial.pattern, days: [] } };
    expect(nthOccurrence(broken, 1, termStart)).toBeNull();
  });

  it('refuses an occurrence past the end of term', () => {
    const bounded = { ...tutorial, endsOn: termStart + 14 * 86_400_000 };
    expect(nthOccurrence(bounded, 9, termStart)).toBeNull();
  });
});

describe('findMeeting', () => {
  const schedule: TermSchedule = {
    capturedAt: 0,
    termLabel: 'Fall 2026',
    termStartsOn: null,
    meetings: parseScheduleText('MATH 135\nTUT 102 Th 2:30PM - 3:20PM MC 4000'),
  };

  it('matches a course code however it is spaced', () => {
    expect(findMeeting(schedule, 'MATH135', 'TUT')).not.toBeNull();
    expect(findMeeting(schedule, 'math 135', 'TUT')).not.toBeNull();
  });

  it('returns null for a component the student does not have', () => {
    expect(findMeeting(schedule, 'MATH 135', 'LAB')).toBeNull();
  });
});

describe('Quest table layout', () => {
  // Quest prints one column per field, so the section number lands before the
  // component rather than attached to it, and each row carries its run of dates.
  const quest = [
    'MATH 102 - Calculus 1',
    'Status Enrolled Units 0.50 Grading Numeric Grading Basis',
    'Class Nbr Section Component Days & Times Room Instructor Start/End Date',
    '4021 001 LEC MWF 8:30AM - 9:20AM RCH 300 A Smith 09/08/2026 - 12/02/2026',
    '4022 102 TUT Th 11:30AM - 12:20PM MC 4000 Staff 09/08/2026 - 12/02/2026',
  ].join('\n');

  it('reads the section number from the column before the component', () => {
    const tut = parseScheduleText(quest).find((m) => m.kind === 'TUT');
    expect(tut?.section).toBe('TUT 102');
  });

  it('attaches both components to the right course', () => {
    const all = parseScheduleText(quest);
    expect(all).toHaveLength(2);
    expect(all.every((m) => m.courseCode === 'MATH 102')).toBe(true);
  });

  it('reads the day and time of a single-day tutorial', () => {
    const tut = parseScheduleText(quest).find((m) => m.kind === 'TUT');
    expect(tut?.pattern.days).toEqual([4]);
    expect(tut?.pattern.startMinute).toBe(11 * 60 + 30);
  });

  it('reads the run of dates the section meets between', () => {
    const tut = parseScheduleText(quest).find((m) => m.kind === 'TUT');
    expect(tut?.startsOn).not.toBeNull();
    expect(new Date(tut?.startsOn ?? 0).getMonth()).toBe(8);
    expect(new Date(tut?.startsOn ?? 0).getDate()).toBe(8);
  });

  it('does not mistake the header row for a meeting', () => {
    const headerOnly = 'Class Nbr Section Component Days & Times Room Instructor';
    expect(parseScheduleText(headerOnly)).toEqual([]);
  });
});

describe('findDateRange', () => {
  it('reads month first, which is what Quest emits', () => {
    const r = findDateRange('09/08/2026 - 12/02/2026');
    expect(new Date(r.startsOn ?? 0).getMonth()).toBe(8);
    expect(new Date(r.endsOn ?? 0).getMonth()).toBe(11);
  });

  it('returns nulls when there is no range', () => {
    expect(findDateRange('TUT 102 Th 2:30PM')).toEqual({ startsOn: null, endsOn: null });
  });
});
