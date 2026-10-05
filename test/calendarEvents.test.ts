import { describe, it, expect } from 'vitest';
import { normalizeCalendarEvents } from '@core/normalize/calendar';

const ORIGIN = 'https://learn.uwaterloo.ca';
const NOW = Date.UTC(2026, 9, 1);

const event = (over: Record<string, unknown>) => ({
  CalendarEventId: 501,
  Title: 'Midterm',
  StartDateTime: '2026-10-23T23:00:00.000Z',
  EndDateTime: '2026-10-24T01:00:00.000Z',
  IsAllDayEvent: false,
  AssociatedEntity: null,
  ...over,
});

describe('normalizeCalendarEvents', () => {
  it('turns an instructor-entered midterm into an exam item', () => {
    const [item] = normalizeCalendarEvents([event({})], '1234', ORIGIN, NOW);
    expect(item?.kind).toBe('exam');
    expect(item?.dueAt).toBe(Date.UTC(2026, 9, 23, 23, 0));
    expect(item?.id).toBe('learn:1234:calendar:501');
    expect(item?.sources[0]?.system).toBe('calendar');
    expect(item?.confidence).toBe(1);
  });

  it('keeps tests as well as exams', () => {
    const items = normalizeCalendarEvents([event({ Title: 'Term Test 2' })], '1234', ORIGIN, NOW);
    expect(items[0]?.kind).toBe('test');
  });

  it('drops lectures, office hours and anything else that is not an exam', () => {
    const items = normalizeCalendarEvents(
      [event({ Title: 'Lecture 12' }), event({ CalendarEventId: 502, Title: 'Office hours' })],
      '1234',
      ORIGIN,
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('drops events tied to a dropbox or quiz, which are read from those tools', () => {
    const tied = event({
      Title: 'Midterm quiz due',
      AssociatedEntity: { AssociatedEntityType: 'D2L.LE.Quizzing.Quiz', AssociatedEntityId: 9 },
    });
    expect(normalizeCalendarEvents([tied], '1234', ORIGIN, NOW)).toEqual([]);
  });

  it('drops an event with no usable start time', () => {
    expect(normalizeCalendarEvents([event({ StartDateTime: null })], '1234', ORIGIN, NOW)).toEqual([]);
  });

  it('reads the paged envelope too', () => {
    const items = normalizeCalendarEvents({ Objects: [event({})] }, '1234', ORIGIN, NOW);
    expect(items).toHaveLength(1);
  });

  it('links to the course home, a LEARN path known to work', () => {
    const [item] = normalizeCalendarEvents([event({})], '1234', ORIGIN, NOW);
    expect(item?.url).toBe(`${ORIGIN}/d2l/home/1234`);
  });
});
