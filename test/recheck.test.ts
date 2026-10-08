// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { checkItems } from '@sync/recheck';
import { parseQuizAttempts, parseSubmittedFolders } from '@core/normalize/quiz';
import { courseOfWorkPage, isSubmitClick } from '../src/content/submitWatch';
import { fakeFetcher } from '@test/doubles/fakeFetcher';
import type { TaskItem } from '@core/types';

const NOW = new Date(2026, 9, 8, 12, 0).getTime();

/** Shaped like a LEARN quiz list page: GoToQuiz(id) and a "used / allowed" cell. */
const quizRow = (id: string, name: string, used: string, allowed: string): string =>
  `<tr><td><div class="dco"><a class="d2l-link" onclick="GoToQuiz(${id}, true);;return false;" href="javascript://">${name}</a>` +
  `<span class="ds_b">Due on Oct 8, 2026 11:59 PM</span></div></td><td class="d_gn">&nbsp;</td>` +
  `<td class="d_gn d_gc"><label>${used}</label><label> / ${allowed}</label></td></tr>`;

const QUIZ_PAGE =
  '<table><tr><th>Current Quizzes</th><th>Evaluation Status</th><th>Attempts</th></tr>' +
  quizRow('501', 'Check-in Survey', '1', '1') +
  quizRow('502', 'Knowledge Quiz', '2', '3') +
  quizRow('503', 'Safety Quiz', '0', '3') +
  quizRow('504', 'Practice Set', '1', 'Unlimited') +
  '</table>';
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

  it('ticks off quizzes the quiz list shows an attempt for, from one page read', async () => {
    const fetcher = fakeFetcher([['/quizzing/user/quizzes_list.d2l?ou=100012', { text: QUIZ_PAGE }]]);
    const quizzes = ['501', '502', '503'].map((id) => item(id, 'quiz', NOW + DAY));
    const out = await checkItems(fetcher, '100012', '1.80', quizzes, NOW);
    expect(out.map((i) => i.learnCompleted)).toEqual([true, true, false]);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('leaves quizzes alone when the quiz list cannot be read', async () => {
    const out = await checkItems(fakeFetcher([]), '100012', '1.80', [item('q1', 'quiz', NOW + DAY)], NOW);
    expect(out[0]?.learnCompleted).toBe(false);
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

describe('parseQuizAttempts', () => {
  it('reads attempts used per quiz', () => {
    const used = parseQuizAttempts(QUIZ_PAGE);
    expect([...used.entries()]).toEqual([['501', 1], ['502', 2], ['503', 0], ['504', 1]]);
  });

  it('skips rows that are not quizzes', () => {
    expect(parseQuizAttempts('<table><tr><td>Heading</td><td><label>3</label></td></tr></table>').size).toBe(0);
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

/** Shaped like a LEARN assignment list page row. */
const folderRow = (id: string, name: string, status: 'submitted' | 'none'): string =>
  `<tr><th scope="row"><label><strong>${name}</strong></label></th><td class="d_gt">` +
  (status === 'submitted'
    ? `<a class="d2l-link" href="/d2l/lms/dropbox/user/folders_history.d2l?db=${id}&amp;grpid=0&amp;ou=100012" title="Submission history">1 Submission, 2 Files</a>`
    : '<label>Not Submitted</label>') +
  '</td></tr>';

describe('closed assignment folders', () => {
  const page = `<table>${folderRow('701', 'Certificate', 'submitted')}${folderRow('702', 'Presentation', 'none')}</table>`;

  it('reads which folders have a submission', () => {
    expect([...parseSubmittedFolders(page)]).toEqual(['701']);
  });

  it('falls back to the assignment list when LEARN refuses the direct check', async () => {
    const fetcher = fakeFetcher([['/dropbox/user/folders_list.d2l?ou=100012', { text: page }]]);
    const out = await checkItems(fetcher, '100012', '1.80', [item('701', 'dropbox', NOW - DAY), item('702', 'dropbox', NOW - DAY)], NOW);
    expect(out.map((i) => i.learnCompleted)).toEqual([true, false]);
  });
});
