/**
 * Assignment folders to TaskItems.
 *
 * Shaped against what UW LEARN actually returned on le 1.97. Every field is
 * read defensively: this is an undocumented-in-practice API surface, and a
 * single unexpected null must not take down a course, let alone a sync.
 */

import { contentHash, learnId } from '../ids';
import { parseUtcDateTime } from '@shared/time';
import type { SourceRef, TaskItem, TaskKind } from '../types';

interface RawFolder {
  readonly Id?: unknown;
  readonly Name?: unknown;
  readonly DueDate?: unknown;
  readonly StartDate?: unknown;
  readonly EndDate?: unknown;
  readonly TotalFiles?: unknown;
  readonly Availability?: unknown;
  readonly GradeItemId?: unknown;
}

export const deepLinkForFolder = (
  learnOrigin: string,
  courseId: string,
  folderId: string,
): string => `${learnOrigin}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folderId}&ou=${courseId}`;

export const normalizeDropboxFolders = (
  json: unknown,
  courseId: string,
  learnOrigin: string,
  now: number,
): readonly TaskItem[] => {
  const rows = asArray(json);
  const out: TaskItem[] = [];

  for (const row of rows) {
    const folder = row as RawFolder;
    const id = numericId(folder.Id);
    if (id === null) continue;

    const title = typeof folder.Name === 'string' && folder.Name.trim() !== '' ? folder.Name.trim() : `Assignment ${id}`;
    const dueAt = parseUtcDateTime(asString(folder.DueDate));
    const endsAt = parseUtcDateTime(asString(folder.EndDate));
    const availableFrom = parseUtcDateTime(asString(folder.StartDate));
    const url = deepLinkForFolder(learnOrigin, courseId, id);

    const source: SourceRef = { system: 'dropbox', sourceId: id, url, observedAt: now };

    out.push({
      id: learnId(courseId, 'dropbox', id),
      courseId,
      title,
      kind: kindFromTitle(title, 'assignment'),
      dueAt,
      availableFrom,
      endsAt,
      isAllDay: false,
      weightPct: null,
      url,
      sources: [source],
      gradeItemId: numericId(folder.GradeItemId),
      // Filled in by a follow-up mysubmissions call; absent means not known yet.
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: contentHash([title, dueAt, endsAt, 'dropbox']),
      firstSeenAt: now,
      lastSyncedAt: now,
    });
  }

  return out;
};

/**
 * A title is the only signal available for telling a midterm apart from a
 * weekly assignment, and it is worth using: a student reads "Midterm" very
 * differently from "Assignment 3".
 */
export const kindFromTitle = (title: string, fallback: TaskKind): TaskKind => {
  const t = title.toLowerCase();
  if (/\bfinal\b/.test(t) && /\bexam\b/.test(t)) return 'exam';
  if (/\bmidterm\b|\bmid-term\b/.test(t)) return 'exam';
  if (/\bexam\b/.test(t)) return 'exam';
  if (/\btest\b/.test(t)) return 'test';
  if (/\bquiz\b/.test(t)) return 'quiz';
  if (/\blab\b|\bprelab\b|\bpre-lab\b/.test(t)) return 'lab';
  if (/\bproject\b|\bmilestone\b|\bproposal\b/.test(t)) return 'project';
  if (/\bparticipation\b|\battendance\b/.test(t)) return 'participation';
  return fallback;
};

export const asArray = (json: unknown): readonly unknown[] => {
  if (Array.isArray(json)) return json;
  // Some routes wrap the same payload in a paged envelope.
  const obj = json as { Objects?: unknown; Items?: unknown } | null;
  if (obj !== null && typeof obj === 'object') {
    if (Array.isArray(obj.Objects)) return obj.Objects;
    if (Array.isArray(obj.Items)) return obj.Items;
  }
  return [];
};

export const numericId = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return value;
  return null;
};

export const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;
