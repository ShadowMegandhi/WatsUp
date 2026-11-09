/**
 * Dates a student adds by hand.
 *
 * For work the outline and LEARN never date in writing ("math tests every
 * week"), the student types it in: what it is, which course, the date, an
 * optional time, and optionally "every week until". Each occurrence becomes
 * an ordinary to-do item, ticked off like any other.
 */

import type { TaskItem, TaskKind } from './types';
import { contentHash } from './ids';
import { findMentions } from './syllabus/mentions';

export interface CustomDraft {
  readonly title: string;
  readonly courseId: string;
  readonly courseUrl: string;
  /** "YYYY-MM-DD", as a date input gives it. */
  readonly date: string;
  /** "HH:MM", or "" for all day. */
  readonly time: string;
  /** "YYYY-MM-DD", or "" for a one-off. */
  readonly repeatUntil: string;
}

export type CustomCheck =
  | { readonly ok: true; readonly items: readonly TaskItem[] }
  | { readonly ok: false; readonly reason: string };

/** A term is about 16 weeks; this leaves room without inviting a typo year. */
export const MAX_REPEATS = 26;

const MAX_TITLE = 120;
const ID_PREFIX = 'manual:';

export const isCustomItem = (item: TaskItem): boolean => item.id.startsWith(ID_PREFIX);

const parseDay = (text: string): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(y, mo - 1, d);
  return probe.getMonth() === mo - 1 && probe.getDate() === d ? { y, m: mo, d } : null;
};

const parseTime = (text: string): { h: number; m: number } | null | 'bad' => {
  if (text.trim() === '') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (m === null) return 'bad';
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? { h, m: min } : 'bad';
};

const kindOf = (title: string): TaskKind => findMentions(title.toLowerCase())[0]?.kind ?? 'other';

export const buildCustomItems = (draft: CustomDraft, now: number): CustomCheck => {
  const title = draft.title.replace(/\s+/g, ' ').trim();
  if (title === '') return { ok: false, reason: 'Give it a name.' };
  if (title.length > MAX_TITLE) return { ok: false, reason: 'That name is too long.' };
  if (draft.courseId === '') return { ok: false, reason: 'Pick a course.' };

  const first = parseDay(draft.date);
  if (first === null) return { ok: false, reason: 'Pick a date.' };

  const time = parseTime(draft.time);
  if (time === 'bad') return { ok: false, reason: 'That time is not valid.' };

  let count = 1;
  if (draft.repeatUntil.trim() !== '') {
    const last = parseDay(draft.repeatUntil);
    if (last === null) return { ok: false, reason: 'Pick an end date for the repeats.' };
    const days = Math.round(
      (Date.UTC(last.y, last.m - 1, last.d) - Date.UTC(first.y, first.m - 1, first.d)) / 86_400_000,
    );
    if (days < 0) return { ok: false, reason: 'The repeats have to end after the first date.' };
    count = Math.floor(days / 7) + 1;
    if (count > MAX_REPEATS) return { ok: false, reason: `Up to ${MAX_REPEATS} weeks at a time.` };
  }

  const seed = now.toString(36);
  const kind = kindOf(title);
  const items: TaskItem[] = [];
  for (let n = 0; n < count; n += 1) {
    const dueAt = new Date(first.y, first.m - 1, first.d + 7 * n, time?.h ?? 23, time?.m ?? 59).getTime();
    const id = `${ID_PREFIX}${seed}:${n}`;
    items.push({
      id,
      courseId: draft.courseId,
      title,
      kind,
      dueAt,
      availableFrom: null,
      endsAt: null,
      isAllDay: time === null,
      weightPct: null,
      url: draft.courseUrl,
      sources: [{ system: 'manual', sourceId: id, url: draft.courseUrl, observedAt: now }],
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: contentHash([title, dueAt, 'manual']),
      firstSeenAt: now,
      lastSyncedAt: now,
    });
  }

  return { ok: true, items };
};
