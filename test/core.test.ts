import { describe, it, expect } from 'vitest';
import { learnId, syllabusId, slug, contentHash, courseOf } from '@core/ids';
import { deriveStatus, resolve, effectiveDueAt } from '@core/status';
import { normalizeDropboxFolders, kindFromTitle, asArray } from '@core/normalize/dropbox';
import { normalizeQuizzes, hasAnySubmission, withSubmission } from '@core/normalize/quiz';
import { group, counts, attentionCount, sectionOf, search } from '@core/selectors';
import type { TaskItem, TaskOverride } from '@core/types';

const ORIGIN = 'https://learn.uwaterloo.ca';
const NOW = Date.UTC(2026, 8, 17, 12, 0, 0);
const DAY = 86_400_000;

const item = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 'learn:1:dropbox:1',
  courseId: '1',
  title: 'Assignment 1',
  kind: 'assignment',
  dueAt: NOW + DAY,
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

describe('ids', () => {
  it('builds a stable id from immutable facts only', () => {
    expect(learnId('100001', 'dropbox', '44881')).toBe('learn:100001:dropbox:44881');
  });

  it('keeps ordinals so sibling assignments never collide', () => {
    expect(syllabusId('1', 'Assignment 3')).not.toBe(syllabusId('1', 'Assignment 4'));
  });

  it('strips filler so wording changes do not orphan user edits', () => {
    expect(slug('Submission for the Midterm')).toBe(slug('Midterm'));
  });

  it('survives a title made entirely of punctuation', () => {
    expect(slug('!!!')).toBe('untitled');
  });

  it('recovers the course from an id', () => {
    expect(courseOf('learn:100001:quiz:7')).toBe('100001');
  });

  it('changes the content hash when a due date moves', () => {
    expect(contentHash(['A1', 100, null])).not.toBe(contentHash(['A1', 200, null]));
  });

  it('gives the same hash for the same input', () => {
    expect(contentHash(['A1', 100, null])).toBe(contentHash(['A1', 100, null]));
  });
});

describe('deriveStatus', () => {
  const past = item({ dueAt: NOW - DAY });
  const future = item({ dueAt: NOW + DAY });

  it('marks a future deadline upcoming', () => {
    expect(deriveStatus(future, null, NOW)).toBe('upcoming');
  });

  it('marks a passed deadline overdue', () => {
    expect(deriveStatus(past, null, NOW)).toBe('overdue');
  });

  it('marks a dateless item undated rather than guessing', () => {
    expect(deriveStatus(item({ dueAt: null }), null, NOW)).toBe('undated');
  });

  it('trusts a LEARN submission', () => {
    expect(deriveStatus(item({ learnCompleted: true }), null, NOW)).toBe('completed');
  });

  it('lets the user tick something off that LEARN does not track', () => {
    const o: TaskOverride = { completion: 'done', updatedAt: NOW };
    expect(deriveStatus(past, o, NOW)).toBe('completed');
  });

  it('believes the user over LEARN when they say it is not done', () => {
    // LEARN reports a saved draft as a submission, so the student has to win.
    const o: TaskOverride = { completion: 'not-done', updatedAt: NOW };
    expect(deriveStatus(item({ dueAt: NOW - DAY, learnCompleted: true }), o, NOW)).toBe('overdue');
  });

  it('honours a user-corrected due date', () => {
    const o: TaskOverride = { dueAt: NOW + 5 * DAY, updatedAt: NOW };
    expect(deriveStatus(past, o, NOW)).toBe('upcoming');
  });

  it('falls back to the close date when there is no due date', () => {
    expect(effectiveDueAt(item({ dueAt: null, endsAt: NOW + DAY }), null)).toBe(NOW + DAY);
  });

  it('lets a user clear a due date explicitly', () => {
    const o: TaskOverride = { dueAt: null, updatedAt: NOW };
    expect(deriveStatus(future, o, NOW)).toBe('undated');
  });
});

describe('resolve', () => {
  it('flags disagreement between the user and LEARN', () => {
    const o: TaskOverride = { completion: 'not-done', updatedAt: NOW };
    const r = resolve(item({ learnCompleted: true }), o, null, NOW);
    expect(r.completionConflict).toBe(true);
  });

  it('does not flag agreement as a conflict', () => {
    const r = resolve(item({ learnCompleted: true }), null, null, NOW);
    expect(r.completionConflict).toBe(false);
  });
});

describe('normalizeDropboxFolders', () => {
  const raw = [
    { Id: 44881, Name: 'Assignment 1', DueDate: '2026-09-30T03:59:00.000Z' },
    { Id: 44882, Name: 'Midterm Report', DueDate: null, EndDate: '2026-10-20T03:59:00.000Z' },
  ];

  it('maps folders to items with parsed dates', () => {
    const items = normalizeDropboxFolders(raw, '100001', ORIGIN, NOW);
    expect(items).toHaveLength(2);
    expect(items[0]?.dueAt).toBe(Date.parse('2026-09-30T03:59:00.000Z'));
  });

  it('builds a deep link that lands on the assignment', () => {
    const items = normalizeDropboxFolders(raw, '100001', ORIGIN, NOW);
    expect(items[0]?.url).toContain('db=44881');
    expect(items[0]?.url).toContain('ou=100001');
  });

  it('reads a midterm as an exam, not a generic assignment', () => {
    const items = normalizeDropboxFolders(raw, '100001', ORIGIN, NOW);
    expect(items[1]?.kind).toBe('exam');
  });

  it('skips rows with no usable id instead of inventing one', () => {
    expect(normalizeDropboxFolders([{ Name: 'orphan' }], '1', ORIGIN, NOW)).toHaveLength(0);
  });

  it('gives an unnamed folder a title rather than showing a blank row', () => {
    const items = normalizeDropboxFolders([{ Id: 5, Name: '  ' }], '1', ORIGIN, NOW);
    expect(items[0]?.title).toBe('Assignment 5');
  });

  it('returns nothing for a payload that is not a list', () => {
    expect(normalizeDropboxFolders({ error: 'nope' }, '1', ORIGIN, NOW)).toHaveLength(0);
  });
});

describe('normalizeQuizzes', () => {
  it('reads the paged envelope UW actually returns', () => {
    const payload = {
      Objects: [{ QuizId: 77, Name: 'Quiz 1', DueDate: '2026-10-01T03:59:00.000Z' }],
      Next: null,
    };
    const items = normalizeQuizzes(payload, '100001', ORIGIN, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe('learn:100001:quiz:77');
  });

  it('treats the close date as the deadline when no due date is set', () => {
    const payload = { Objects: [{ QuizId: 78, Name: 'Quiz 2', EndDate: '2026-10-05T03:59:00.000Z' }] };
    const items = normalizeQuizzes(payload, '1', ORIGIN, NOW);
    expect(effectiveDueAt(items[0] as TaskItem, null)).toBe(Date.parse('2026-10-05T03:59:00.000Z'));
  });

  it('ignores a hidden quiz', () => {
    const payload = { Objects: [{ QuizId: 79, Name: 'Draft', IsActive: false }] };
    expect(normalizeQuizzes(payload, '1', ORIGIN, NOW)).toHaveLength(0);
  });
});

describe('submission evidence', () => {
  it('detects a handed-in submission', () => {
    expect(hasAnySubmission([{ Submissions: [{ Id: 1 }] }])).toBe(true);
  });

  it('reports nothing handed in for an empty list', () => {
    expect(hasAnySubmission([{ Submissions: [] }])).toBe(false);
  });

  it('marks an item complete without mutating the original', () => {
    const original = item();
    const updated = withSubmission(original, true);
    expect(updated.learnCompleted).toBe(true);
    expect(original.learnCompleted).toBe(false);
  });
});

describe('kindFromTitle', () => {
  it.each([
    ['Final Exam', 'exam'],
    ['Midterm 1', 'exam'],
    ['Tutorial Test 2', 'test'],
    ['Quiz 4', 'quiz'],
    ['Lab 3 Report', 'lab'],
    ['Project Proposal', 'project'],
    ['Participation', 'participation'],
    ['Assignment 7', 'assignment'],
  ])('reads %s as %s', (title, expected) => {
    expect(kindFromTitle(title, 'assignment')).toBe(expected);
  });
});

describe('asArray', () => {
  it('accepts a bare array', () => {
    expect(asArray([1, 2])).toHaveLength(2);
  });

  it('unwraps the Objects envelope', () => {
    expect(asArray({ Objects: [1] })).toHaveLength(1);
  });

  it('unwraps the Items envelope', () => {
    expect(asArray({ Items: [1, 2, 3] })).toHaveLength(3);
  });

  it('returns empty for junk', () => {
    expect(asArray('nope')).toHaveLength(0);
  });
});

describe('selectors', () => {
  const tasks = [
    resolve(item({ id: 'a', dueAt: NOW - DAY }), null, null, NOW),
    resolve(item({ id: 'b', dueAt: NOW + 2 * DAY }), null, null, NOW),
    resolve(item({ id: 'c', dueAt: NOW + 30 * DAY }), null, null, NOW),
    resolve(item({ id: 'd', dueAt: null }), null, null, NOW),
    resolve(item({ id: 'e', learnCompleted: true }), null, null, NOW),
  ];

  it('splits tasks into the sections the panel shows', () => {
    const g = group(tasks, NOW);
    expect(g.overdue.map((t) => t.item.id)).toEqual(['a']);
    expect(g['due-soon'].map((t) => t.item.id)).toEqual(['b']);
    expect(g.upcoming.map((t) => t.item.id)).toEqual(['c']);
    expect(g.undated.map((t) => t.item.id)).toEqual(['d']);
    expect(g.completed.map((t) => t.item.id)).toEqual(['e']);
  });

  it('counts only what needs attention today', () => {
    // Overdue plus due-soon. Counting everything outstanding produces a number
    // so large it stops meaning anything.
    expect(attentionCount(tasks, NOW)).toBe(2);
  });

  it('orders outstanding work by soonest deadline', () => {
    const g = group(
      [
        resolve(item({ id: 'later', dueAt: NOW + 3 * DAY }), null, null, NOW),
        resolve(item({ id: 'sooner', dueAt: NOW + DAY }), null, null, NOW),
      ],
      NOW,
    );
    expect(g['due-soon'].map((t) => t.item.id)).toEqual(['sooner', 'later']);
  });

  it('orders completed work most recent first', () => {
    const g = group(
      [
        resolve(item({ id: 'old', dueAt: NOW - 10 * DAY, learnCompleted: true }), null, null, NOW),
        resolve(item({ id: 'recent', dueAt: NOW - DAY, learnCompleted: true }), null, null, NOW),
      ],
      NOW,
    );
    expect(g.completed.map((t) => t.item.id)).toEqual(['recent', 'old']);
  });

  it('counts every section', () => {
    expect(counts(tasks, NOW)).toEqual({
      overdue: 1,
      dueSoon: 1,
      upcoming: 1,
      completed: 1,
      undated: 1,
    });
  });

  it('puts an item due later today in due-soon, not overdue', () => {
    const t = resolve(item({ dueAt: NOW + 3_600_000 }), null, null, NOW);
    expect(sectionOf(t, NOW)).toBe('due-soon');
  });

  it('filters by title and by course code', () => {
    const withCourse = resolve(
      item({ title: 'Problem Set 2' }),
      null,
      { id: '1', name: 'Electricity', code: 'ECE106', looksAcademic: true, url: 'x' },
      NOW,
    );
    expect(search([withCourse], 'problem')).toHaveLength(1);
    expect(search([withCourse], 'ece106')).toHaveLength(1);
    expect(search([withCourse], 'math')).toHaveLength(0);
  });
});
