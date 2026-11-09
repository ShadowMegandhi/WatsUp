import { describe, it, expect } from 'vitest';
import { buildCustomItems, isCustomItem, MAX_REPEATS } from '@core/customItems';

const NOW = new Date(2026, 10, 9, 12, 0).getTime();
const COURSE = { id: '100015', url: 'https://learn.uwaterloo.ca/d2l/home/100015' };

const draft = (over: Partial<Parameters<typeof buildCustomItems>[0]> = {}) => ({
  title: 'Math test',
  courseId: COURSE.id,
  courseUrl: COURSE.url,
  date: '2026-11-13',
  time: '',
  repeatUntil: '',
  ...over,
});

const day = (ms: number | null): string => {
  const d = new Date(ms ?? 0);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('buildCustomItems', () => {
  it('makes one all-day item from a title, course and date', () => {
    const r = buildCustomItems(draft(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    const item = r.items[0];
    expect(item?.title).toBe('Math test');
    expect(item?.courseId).toBe(COURSE.id);
    expect(item?.isAllDay).toBe(true);
    expect(day(item?.dueAt ?? null)).toBe('11/13 23:59');
    expect(item !== undefined && isCustomItem(item)).toBe(true);
  });

  it('uses the time when one is given', () => {
    const r = buildCustomItems(draft({ time: '17:30' }), NOW);
    expect(r.ok && r.items[0]?.isAllDay).toBe(false);
    expect(r.ok && day(r.items[0]?.dueAt ?? null)).toBe('11/13 17:30');
  });

  it('repeats weekly up to and including the end date', () => {
    const r = buildCustomItems(draft({ repeatUntil: '2026-12-04' }), NOW);
    expect(r.ok && r.items.map((i) => day(i.dueAt))).toEqual(['11/13 23:59', '11/20 23:59', '11/27 23:59', '12/4 23:59']);
    expect(r.ok && new Set(r.items.map((i) => i.id)).size).toBe(4);
  });

  it('reads the kind from the title', () => {
    const r = buildCustomItems(draft({ title: 'Statics quiz' }), NOW);
    expect(r.ok && r.items[0]?.kind).toBe('quiz');
  });

  it('refuses a missing title, course or date', () => {
    expect(buildCustomItems(draft({ title: '  ' }), NOW).ok).toBe(false);
    expect(buildCustomItems(draft({ courseId: '' }), NOW).ok).toBe(false);
    expect(buildCustomItems(draft({ date: '' }), NOW).ok).toBe(false);
    expect(buildCustomItems(draft({ date: '2026-02-30' }), NOW).ok).toBe(false);
  });

  it('refuses an end date before the first date', () => {
    expect(buildCustomItems(draft({ repeatUntil: '2026-11-01' }), NOW).ok).toBe(false);
  });

  it('refuses more repeats than a term holds', () => {
    expect(buildCustomItems(draft({ date: '2026-01-02', repeatUntil: '2027-12-31' }), NOW).ok).toBe(false);
    expect(MAX_REPEATS).toBeGreaterThanOrEqual(16);
  });
});
