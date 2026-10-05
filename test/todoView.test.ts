// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { h, render } from 'preact';
import { TodoView } from '../src/content/panel/TodoView';
import type { ResolvedTask } from '@core/types';

beforeAll(() => {
  // colorVars asks for the colour scheme; jsdom has no matchMedia.
  window.matchMedia = ((q: string) => ({ matches: false, media: q })) as unknown as typeof window.matchMedia;
});

const NOW = new Date(2026, 9, 5, 12, 0).getTime();
const WED = (h24: number) => new Date(2026, 9, 7, h24, 59).getTime();

const task = (id: string, title: string, dueAt: number): ResolvedTask =>
  ({
    item: { id, courseId: 'c1', title, kind: 'assignment', isAllDay: false, sources: [], url: '' },
    override: null,
    course: null,
    status: 'upcoming',
    effectiveDueAt: dueAt,
    effectiveTitle: title,
    completionConflict: false,
  }) as unknown as ResolvedTask;

const mount = (tasks: readonly ResolvedTask[]): HTMLElement => {
  const el = document.createElement('div');
  render(
    h(TodoView, {
      tasks,
      newIds: new Set<string>(),
      now: NOW,
      searching: false,
      showCompleted: false,
      onShowCompleted: () => undefined,
      onToggle: () => undefined,
    }),
    el,
  );
  return el;
};

describe('Next up', () => {
  it('lists every item due on the next due day', () => {
    const el = mount([task('a', 'Journey Map', WED(23)), task('b', 'Team Charter', WED(17)), task('c', 'Later', WED(23) + 3 * 86_400_000)]);
    const titles = [...el.querySelectorAll('.nextup .ntitle')].map((n) => n.firstChild?.textContent);
    expect(titles).toEqual(['Team Charter', 'Journey Map']);
  });

  it('keeps both when two records share an id', () => {
    const el = mount([task('dup', 'Journey Map', WED(23)), task('dup', 'Journey Map reflection', WED(23))]);
    expect(el.querySelectorAll('.nextup .nitem')).toHaveLength(2);
    expect(el.querySelectorAll('.row')).toHaveLength(2);
  });
});
