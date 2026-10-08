// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { checkItems } from '@sync/recheck';
import { hasFinishedAttempt } from '@core/normalize/quiz';
import { courseOfWorkPage, isSubmitClick } from '../src/content/submitWatch';
import { fakeFetcher } from '@test/doubles/fakeFetcher';
import type { TaskItem } from '@core/types';

const NOW = new Date(2026, 9, 8, 12, 0).getTime();
const DAY = 86_400_000;

const item = (id: string, system: 'dropbox' | 'quiz' | 'calendar', dueAt: number | null, done = false): TaskItem =>
  ({
    id,
    courseId: '100012',
    title: id,
    kind: system === 'quiz' ? 'quiz' : 'assignment',
    dueAt,
    endsAt: null,
    sources: [{ system, sourceId: id, url: '', observedAt: NOW }],
    learnCompleted: done,
    learnCompletionEvidence: done ? 'submission' : 'none',
  }) as unknown as TaskItem;

describe('checkItems', () => {
  it('ticks off an assignment LEARN has a submission for', async () => {
    const fetcher = fakeFetcher([
      ['/dropbox/folders/a1/submissions/mysubmissions/', { json: [{ Submissions: [{ Id: 1 }] }] }],
      ['/dropbox/folders/a2/submissions/mysubmissions/', { json: [{ Submissions: [] }] }],
    ]);
    const out = await checkItems(fetcher, '100012', '1.80', [item('a1', 'dropbox', NOW + DAY), item('a2', 'dropbox', NOW + DAY)], NOW);
    expect(out.map((i) => i.learnCompleted)).toEqual([true, false]);
    expect(out[0]?.learnCompletionEvidence).toBe('submission');
  });

  it('ticks off a quiz with a finished attempt', async () => {
    const fetcher = fakeFetcher([['/quizzes/q1/attempts/', { json: [{ AttemptId: 1, Completed: '2026-10-08T15:00:00.000Z' }] }]]);
    const out = await checkItems(fetcher, '100012', '1.80', [item('q1', 'quiz', NOW + DAY)], NOW);
    expect(out[0]?.learnCompleted).toBe(true);
  });

  it('does not ask about work already done or long past', async () => {
    const fetcher = fakeFetcher([]);
    await checkItems(fetcher, '100012', '1.80', [item('d', 'dropbox', NOW, true), item('old', 'dropbox', NOW - 60 * DAY)], NOW);
    expect(fetcher.calls).toEqual([]);
  });

  it('leaves an item alone when LEARN will not answer', async () => {
    const fetcher = fakeFetcher([]);
    const out = await checkItems(fetcher, '100012', '1.80', [item('a3', 'dropbox', NOW + DAY)], NOW);
    expect(out[0]?.learnCompleted).toBe(false);
  });
});

describe('hasFinishedAttempt', () => {
  it('counts an attempt with a completion stamp', () => {
    expect(hasFinishedAttempt({ Objects: [{ AttemptId: 1, Completed: '2026-10-08T15:00:00Z' }] })).toBe(true);
    expect(hasFinishedAttempt([{ IsSubmitted: true }])).toBe(true);
  });

  it('does not count an attempt that was opened but never submitted', () => {
    expect(hasFinishedAttempt([{ AttemptId: 1, Completed: null }])).toBe(false);
    expect(hasFinishedAttempt([{ AttemptId: 1 }])).toBe(false);
    expect(hasFinishedAttempt([])).toBe(false);
  });
});

describe('courseOfWorkPage', () => {
  it('finds the course on an assignment or quiz page', () => {
    expect(courseOfWorkPage('https://learn.uwaterloo.ca/d2l/lms/dropbox/user/folder_submit_files.d2l?db=5&ou=100012')).toBe('100012');
    expect(courseOfWorkPage('https://learn.uwaterloo.ca/d2l/lms/quizzing/user/quiz_summary.d2l?qi=9&ou=100013')).toBe('100013');
  });

  it('ignores other LEARN pages', () => {
    expect(courseOfWorkPage('https://learn.uwaterloo.ca/d2l/home/100012')).toBeNull();
    expect(courseOfWorkPage('https://learn.uwaterloo.ca/d2l/lms/dropbox/user/folders_list.d2l')).toBeNull();
  });
});

describe('isSubmitClick', () => {
  const el = (html: string): Element => {
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.firstElementChild as Element;
  };

  it('recognises a Submit button', () => {
    expect(isSubmitClick([el('<button>Submit</button>')])).toBe(true);
    expect(isSubmitClick([el('<input type="button" value="Submit Quiz">')])).toBe(true);
    expect(isSubmitClick([el('<d2l-button>Submit</d2l-button>')])).toBe(true);
  });

  it('ignores other buttons and plain text', () => {
    expect(isSubmitClick([el('<button>Add a File</button>')])).toBe(false);
    expect(isSubmitClick([el('<p>Submit your work by Friday</p>')])).toBe(false);
  });
});
