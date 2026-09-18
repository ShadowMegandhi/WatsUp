import { describe, it, expect } from 'vitest';
import {
  parseQuestDays,
  parseQuestDate,
  parseQuestDateRange,
  parseQuestRows,
  expandSessions,
} from '../src/portal/questTable';

/** Transcribed from a real Quest class schedule. */
const QUEST = [
  'GEN 100 - First-Year Engineering Seminar',
  'Status Units Grading Grade Deadlines',
  'Enrolled 0.00 Credit / Non-Credit Basis',
  'Class Nbr Section Component Days & Times Room Instructor Start/End Date',
  '5357 014 SEM F 12:30PM - 1:20PM DC 1000 Alex Instructor, Sam Instructor 09/09/2026 - 10/20/2026',
  'F 12:30PM - 1:20PM DC 1000 Alex Instructor, Sam Instructor 10/28/2026 - 12/08/2026',
  'MATH 101 - Linear Algebra (Eng)',
  'Status Units Grading Grade Deadlines',
  'Enrolled 0.50 Numeric Grading Basis',
  'Class Nbr Section Component Days & Times Room Instructor Start/End Date',
  '8162 011 LEC MWF 10:30AM - 11:20AM RCH 100 Jordan Instructor 09/09/2026 - 10/20/2026',
  'W 2:30PM - 3:20PM RCH 300 Jordan Instructor 09/16/2026 - 09/16/2026',
  'W 2:30PM - 3:20PM RCH 300 Jordan Instructor 09/30/2026 - 09/30/2026',
  'MWF 10:30AM - 11:20AM RCH 100 Jordan Instructor 10/28/2026 - 12/08/2026',
  'W 2:30PM - 3:20PM RCH 300 Jordan Instructor 10/28/2026 - 10/28/2026',
  'W 2:30PM - 3:20PM RCH 300 Jordan Instructor 11/11/2026 - 11/11/2026',
  '6665 201 TST M 8:00PM - 9:50PM TBA To be Announced 10/26/2026 - 10/26/2026',
].join('\n');

describe('parseQuestDays', () => {
  it('reads MWF', () => expect(parseQuestDays('MWF')).toEqual([1, 3, 5]));
  it('reads Th as Thursday', () => expect(parseQuestDays('TTh')).toEqual([2, 4]));
  it('reads a single day', () => expect(parseQuestDays('W')).toEqual([3]));
  it('reads a lone M', () => expect(parseQuestDays('M')).toEqual([1]));
});

describe('parseQuestDate', () => {
  it('reads month first, which is what Quest prints', () => {
    const at = parseQuestDate('09/09/2026');
    expect(new Date(at ?? 0).getMonth()).toBe(8);
    expect(new Date(at ?? 0).getDate()).toBe(9);
  });

  it('rejects an impossible date', () => {
    expect(parseQuestDate('02/30/2026')).toBeNull();
  });
});

describe('parseQuestDateRange', () => {
  it('reads a range', () => {
    const r = parseQuestDateRange('09/09/2026 - 10/20/2026');
    expect(r).not.toBeNull();
  });

  it('reads a single day written as a range', () => {
    const r = parseQuestDateRange('10/26/2026 - 10/26/2026');
    expect(r?.startsOn).toBe(r?.endsOn);
  });

  it('refuses a backwards range', () => {
    expect(parseQuestDateRange('12/08/2026 - 09/09/2026')).toBeNull();
  });
});

describe('parseQuestRows', () => {
  const rows = parseQuestRows(QUEST);

  it('reads every stated meeting row, not one per component', () => {
    // GEN 100 has two, MATH 101 LEC has six, and the test has one.
    expect(rows).toHaveLength(9);
  });

  it('carries course and component across continuation rows', () => {
    // Quest leaves those cells blank on continuation rows, and the row means
    // nothing without them.
    const math = rows.filter((r) => r.courseCode === 'MATH 101');
    expect(math).toHaveLength(7);
    expect(math.filter((r) => r.kind === 'LEC')).toHaveLength(6);
  });

  it('keeps the standalone test as its own component', () => {
    const test = rows.find((r) => r.kind === 'TST');
    expect(test?.courseCode).toBe('MATH 101');
    expect(test?.days).toEqual([1]);
  });

  it('reads the section label', () => {
    const sem = rows.find((r) => r.kind === 'SEM');
    expect(sem?.section).toBe('SEM 014');
  });

  it('reads the room', () => {
    const sem = rows.find((r) => r.kind === 'SEM');
    expect(sem?.room).toBe('DC 1000');
  });

  it('skips the header row', () => {
    expect(rows.some((r) => r.section.includes('Nbr'))).toBe(false);
  });
});

describe('expandSessions', () => {
  const sessions = expandSessions(parseQuestRows(QUEST));

  it('places the one-off test on exactly its stated day', () => {
    const tests = sessions.filter((s) => s.kind === 'TST');
    expect(tests).toHaveLength(1);
    expect(new Date(tests[0]?.startsAt ?? 0).getDate()).toBe(26);
    expect(new Date(tests[0]?.startsAt ?? 0).getMonth()).toBe(9);
  });

  it('applies the stated start time', () => {
    const test = sessions.find((s) => s.kind === 'TST');
    expect(new Date(test?.startsAt ?? 0).getHours()).toBe(20);
  });

  it('never places anything during reading week', () => {
    // Quest splits its ranges around the break, so expanding what it states
    // skips the gap for free. Inferring a weekly pattern would not.
    const gene = sessions.filter((s) => s.courseCode === 'GEN 100');
    const inBreak = gene.filter((s) => {
      const d = new Date(s.startsAt);
      return d.getMonth() === 9 && d.getDate() > 20 && d.getDate() < 28;
    });
    expect(inBreak).toEqual([]);
  });

  it('expands a weekly range into each day it names', () => {
    const gene = sessions.filter((s) => s.courseCode === 'GEN 100');
    // Fridays only, across both ranges.
    expect(gene.every((s) => new Date(s.startsAt).getDay() === 5)).toBe(true);
    expect(gene.length).toBeGreaterThan(8);
  });

  it('keeps the extra Wednesday sessions as their own dates', () => {
    const wednesdays = sessions.filter(
      (s) => s.courseCode === 'MATH 101' && new Date(s.startsAt).getHours() === 14,
    );
    const days = wednesdays.map((s) => new Date(s.startsAt).getDate()).sort((a, b) => a - b);
    expect(days).toContain(16);
    expect(days).toContain(30);
    expect(days).toContain(11);
  });

  it('returns sessions in date order', () => {
    const starts = sessions.map((s) => s.startsAt);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it('does not emit the same session twice', () => {
    const keys = sessions.map((s) => `${s.courseCode}|${s.kind}|${s.startsAt}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
