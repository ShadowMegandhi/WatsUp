import { describe, it, expect } from 'vitest';
import { buildMonth, addMonths, byDay, dayKeyOf, toneForDay, initialMonth } from '@core/calendar';
import { resolve } from '@core/status';
import type { TaskItem } from '@core/types';

const NOW = new Date(2026, 8, 17, 12, 0, 0).getTime();
const DAY = 86_400_000;

const item = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 'x',
  courseId: '1',
  title: 'Assignment 1',
  kind: 'assignment',
  dueAt: NOW,
  availableFrom: null,
  endsAt: null,
  isAllDay: false,
  weightPct: null,
  url: 'https://x',
  sources: [],
  learnCompleted: false,
  learnCompletionEvidence: 'none',
  confidence: 1,
  contentHash: 'h',
  firstSeenAt: NOW,
  lastSyncedAt: NOW,
  ...over,
});

describe('dayKeyOf', () => {
  it('uses the local calendar day, not the UTC one', () => {
    // A late-evening deadline must not slide onto tomorrow.
    const lateLocal = new Date(2026, 8, 30, 23, 59).getTime();
    expect(dayKeyOf(lateLocal)).toBe('2026-09-30');
  });

  it('zero-pads so keys sort correctly', () => {
    expect(dayKeyOf(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
  });
});

describe('buildMonth', () => {
  const view = buildMonth(2026, 8, NOW);

  it('always returns six rows so the panel does not jump between months', () => {
    expect(view.weeks).toHaveLength(6);
    for (const w of view.weeks) expect(w).toHaveLength(7);
  });

  it('labels the month', () => {
    expect(view.label).toContain('2026');
  });

  it('pads with the neighbouring months and marks them out of month', () => {
    const firstCell = view.weeks[0]?.[0];
    expect(firstCell?.inMonth).toBe(false);
    expect(firstCell?.dayOfMonth).toBe(30);
  });

  it('starts each row on a Sunday', () => {
    for (const week of view.weeks) {
      expect(new Date(week[0]?.date ?? 0).getDay()).toBe(0);
    }
  });

  it('marks today exactly once', () => {
    const todays = view.weeks.flat().filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0]?.dayOfMonth).toBe(17);
  });

  it('marks weekends', () => {
    const week = view.weeks[1] ?? [];
    expect(week[0]?.isWeekend).toBe(true);
    expect(week[3]?.isWeekend).toBe(false);
  });

  it('handles February in a leap year', () => {
    const feb = buildMonth(2028, 1, NOW);
    const inMonth = feb.weeks.flat().filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
  });
});

describe('addMonths', () => {
  it('rolls forward over a year boundary', () => {
    expect(addMonths(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
  });

  it('rolls backward over a year boundary', () => {
    expect(addMonths(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe('byDay', () => {
  it('buckets tasks onto their local due day', () => {
    const tasks = [
      resolve(item({ id: 'a', dueAt: NOW }), null, null, NOW),
      resolve(item({ id: 'b', dueAt: NOW + 60_000 }), null, null, NOW),
      resolve(item({ id: 'c', dueAt: NOW + 3 * DAY }), null, null, NOW),
    ];
    const map = byDay(tasks);
    expect(map.get(dayKeyOf(NOW))).toHaveLength(2);
    expect(map.get(dayKeyOf(NOW + 3 * DAY))).toHaveLength(1);
  });

  it('orders a day by time so the earliest deadline reads first', () => {
    const late = resolve(item({ id: 'late', dueAt: NOW + 7_200_000 }), null, null, NOW);
    const early = resolve(item({ id: 'early', dueAt: NOW + 60_000 }), null, null, NOW);
    const map = byDay([late, early]);
    expect(map.get(dayKeyOf(NOW))?.map((t) => t.item.id)).toEqual(['early', 'late']);
  });

  it('leaves undated tasks out of the calendar entirely', () => {
    const map = byDay([resolve(item({ dueAt: null }), null, null, NOW)]);
    expect(map.size).toBe(0);
  });
});

describe('toneForDay', () => {
  const overdue = resolve(item({ dueAt: NOW - DAY }), null, null, NOW);
  const due = resolve(item({ dueAt: NOW + DAY }), null, null, NOW);
  const done = resolve(item({ learnCompleted: true }), null, null, NOW);

  it('reports nothing for an empty day', () => {
    expect(toneForDay(undefined)).toBe('none');
    expect(toneForDay([])).toBe('none');
  });

  it('lets one overdue item colour the whole day', () => {
    expect(toneForDay([done, due, overdue])).toBe('overdue');
  });

  it('shows due when something is outstanding but nothing is late', () => {
    expect(toneForDay([done, due])).toBe('due');
  });

  it('shows done only when everything on the day is finished', () => {
    expect(toneForDay([done])).toBe('done');
  });
});

describe('initialMonth', () => {
  it('opens on the current month', () => {
    expect(initialMonth(NOW)).toEqual({ year: 2026, month: 8 });
  });
});
