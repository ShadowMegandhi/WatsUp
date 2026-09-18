import { describe, it, expect } from 'vitest';
import { dedupeById } from '@core/dedupe';
import type { SourceRef, TaskItem } from '@core/types';

const NOW = 1_790_000_000_000;

const src = (system: SourceRef['system'], sourceId = '1'): SourceRef => ({
  system,
  sourceId,
  url: 'https://x',
  observedAt: NOW,
});

const item = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: 'syn:1:midterm',
  courseId: '1',
  title: 'Midterm',
  kind: 'exam',
  dueAt: NOW,
  availableFrom: null,
  endsAt: null,
  isAllDay: false,
  weightPct: null,
  url: 'https://x',
  sources: [src('syllabus')],
  learnCompleted: false,
  learnCompletionEvidence: 'none',
  confidence: 0.8,
  contentHash: 'h',
  firstSeenAt: NOW,
  lastSyncedAt: NOW,
  ...over,
});

describe('dedupeById', () => {
  it('leaves distinct items alone', () => {
    const out = dedupeById([item({ id: 'a' }), item({ id: 'b' })]);
    expect(out).toHaveLength(2);
  });

  it('collapses two readings of the same assessment', () => {
    // An outline and a schedule both describing one midterm.
    const out = dedupeById([item({ confidence: 0.7 }), item({ confidence: 0.9 })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.confidence).toBe(0.9);
  });

  it('lets a LEARN record win over a syllabus reading', () => {
    const syllabus = item({ confidence: 0.99, title: 'Midterm' });
    const learn = item({ confidence: 0.5, title: 'Midterm Exam', sources: [src('quiz', '77')] });
    const out = dedupeById([syllabus, learn]);
    expect(out[0]?.title).toBe('Midterm Exam');
  });

  it('keeps provenance from both sides after a merge', () => {
    const out = dedupeById([item(), item({ sources: [src('quiz', '77')] })]);
    expect(out[0]?.sources).toHaveLength(2);
  });

  it('does not duplicate identical sources', () => {
    const out = dedupeById([item(), item()]);
    expect(out[0]?.sources).toHaveLength(1);
  });

  it('takes a due date from whichever side knows one', () => {
    const out = dedupeById([item({ dueAt: null, confidence: 0.9 }), item({ dueAt: NOW })]);
    expect(out[0]?.dueAt).toBe(NOW);
  });

  it('treats completion as evidence, so either side reporting it counts', () => {
    const out = dedupeById([
      item({ sources: [src('quiz', '77')] }),
      item({ learnCompleted: true, learnCompletionEvidence: 'submission' }),
    ]);
    expect(out[0]?.learnCompleted).toBe(true);
  });

  it('keeps the earliest sighting so the new marker stays honest', () => {
    const out = dedupeById([item({ firstSeenAt: NOW }), item({ firstSeenAt: NOW - 100_000 })]);
    expect(out[0]?.firstSeenAt).toBe(NOW - 100_000);
  });

  it('takes a weight from the syllabus when LEARN has none', () => {
    const learn = item({ sources: [src('dropbox', '9')], weightPct: null });
    const syllabus = item({ weightPct: 25 });
    expect(dedupeById([learn, syllabus])[0]?.weightPct).toBe(25);
  });

  it('handles an empty list', () => {
    expect(dedupeById([])).toEqual([]);
  });
});
