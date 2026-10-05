import { describe, it, expect } from 'vitest';
import { countdown, formatDueShort, summaryLine } from '../src/content/panel/format';
import { groupByDay, nextUp } from '../src/content/panel/groups';
import type { ResolvedTask, TaskStatus } from '@core/types';

/** Mon Oct 19 2026, 10:00 local. */
const NOW = new Date(2026, 9, 19, 10, 0).getTime();
const at = (d: number, h = 23, m = 59): number => new Date(2026, 9, d, h, m).getTime();

const task = (title: string, dueAt: number | null, status: TaskStatus = 'upcoming'): ResolvedTask =>
  ({
    item: { id: title, title, kind: 'assignment', isAllDay: false, sources: [] },
    override: null,
    course: null,
    status,
    effectiveDueAt: dueAt,
    effectiveTitle: title,
    completionConflict: false,
  }) as unknown as ResolvedTask;

describe('groupByDay', () => {
  const tasks = [
    task('late', at(17), 'overdue'),
    task('today', at(19)),
    task('tomorrow', at(20)),
    task('thursday', at(22)),
    task('next week', at(28)),
    task('november', at(40)),
    task('someday', null, 'undated'),
    task('finished', at(19), 'completed'),
  ];

  it('puts each open item under the right day, in order', () => {
    const groups = groupByDay(tasks, NOW);
    expect(groups.map((g) => [g.label, g.tasks.map((t) => t.effectiveTitle)])).toEqual([
      ['Overdue', ['late']],
      ['Today', ['today']],
      ['Tomorrow', ['tomorrow']],
      ['This week', ['thursday']],
      ['Next week', ['next week']],
      ['Later', ['november']],
      ['No due date', ['someday']],
    ]);
  });

  it('marks overdue red and today gold', () => {
    const groups = groupByDay(tasks, NOW);
    expect(groups[0]?.tone).toBe('late');
    expect(groups[1]?.tone).toBe('today');
  });

  it('leaves empty groups out', () => {
    expect(groupByDay([task('only', at(20))], NOW).map((g) => g.id)).toEqual(['tomorrow']);
  });
});

describe('nextUp', () => {
  it('is the soonest item not yet late or done', () => {
    const t = nextUp([task('b', at(22)), task('a', at(19)), task('x', at(17), 'overdue')], NOW);
    expect(t?.effectiveTitle).toBe('a');
  });

  it('is null when nothing is coming', () => {
    expect(nextUp([task('x', at(17), 'overdue')], NOW)).toBeNull();
  });
});

describe('formatDueShort', () => {
  it('says how late an overdue item is', () => {
    expect(formatDueShort(at(17), NOW)).toBe('2 days late');
    expect(formatDueShort(at(18), NOW)).toBe('1 day late');
  });

  it('leaves the time off an all-day item', () => {
    expect(formatDueShort(at(19), NOW, true)).toBe('Today');
    expect(formatDueShort(at(30), NOW, true)).toBe('Oct 30');
  });

  it('does not call an all-day item due today late', () => {
    expect(formatDueShort(at(19, 0, 0), NOW, true)).toBe('Today');
  });

  it('says "No date" when there is none', () => {
    expect(formatDueShort(null, NOW)).toBe('No date');
  });
});

describe('countdown', () => {
  it('counts down in plain words', () => {
    expect(countdown(NOW + 30 * 60_000, NOW)).toBe('in 30 min');
    expect(countdown(NOW + 5 * 3_600_000, NOW)).toBe('in 5 hours');
    expect(countdown(at(20), NOW)).toBe('tomorrow');
    expect(countdown(at(23), NOW)).toBe('in 4 days');
  });
});

describe('summaryLine', () => {
  it('leads with what is late, then today', () => {
    expect(summaryLine(1, 2, 5)).toBe('1 overdue · 2 due today');
  });

  it('falls back to the week when nothing is due today', () => {
    expect(summaryLine(0, 0, 3)).toBe('3 due this week');
  });

  it('says so when there is nothing', () => {
    expect(summaryLine(0, 0, 0)).toBe("You're all caught up");
  });
});
