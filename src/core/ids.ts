/**
 * Identity.
 *
 * The rule: an id may contain only immutable facts. Never a due date, never a
 * status, never anything a professor can change. If an id moves when a
 * deadline moves, every user edit attached to it is silently orphaned.
 *
 * LEARN-sourced items are anchored to the source record, whose id is stable
 * within a course offering. Syllabus items have no such anchor, so they are
 * anchored to a slug of the title with the date deliberately excluded.
 */

import type { TaskId } from './types';

export const learnId = (
  courseId: string,
  system: 'dropbox' | 'quiz' | 'calendar',
  sourceId: string,
): TaskId =>
  `learn:${courseId}:${system}:${sourceId}`;

export const syllabusId = (courseId: string, title: string): TaskId =>
  `syn:${courseId}:${slug(title)}`;

export const manualId = (courseId: string, seed: string): TaskId => `man:${courseId}:${slug(seed)}`;

export const courseOf = (id: TaskId): string | null => id.split(':')[1] ?? null;

/**
 * Lowercased, punctuation stripped, filler words removed, but ordinals kept.
 * The ordinal is load-bearing: Assignment 3 and Assignment 4 must never
 * collapse to the same id, and "assignment" alone is not distinguishing.
 */
export const slug = (raw: string): string => {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w !== '' && !FILLER.has(w));

  const out = words.join('-').slice(0, 60);
  return out === '' ? 'untitled' : out;
};

const FILLER = new Set([
  'the', 'a', 'an', 'of', 'for', 'to', 'and', 'in', 'on',
  'due', 'submission', 'submit', 'dropbox', 'online', 'graded',
]);

/**
 * A digest of the fields that make an item meaningfully different. Used to
 * decide whether something actually changed rather than just being re-read.
 * Small and fast beats cryptographically strong here.
 */
export const contentHash = (parts: readonly (string | number | null)[]): string => {
  const joined = parts.map((p) => (p === null ? '~' : String(p))).join('|');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < joined.length; i += 1) {
    const c = joined.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
};
