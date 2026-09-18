/**
 * Course announcements.
 *
 * Deliberately not TaskItems. An announcement is something to read, not
 * something to finish, and giving it a checkbox and a due date would put it in
 * competition with real deadlines for the same attention. It sits alongside
 * the work rather than inside it.
 */

import { parseUtcDateTime } from '@shared/time';
import { asArray, asString, numericId } from './dropbox';

export interface Announcement {
  readonly id: string;
  readonly courseId: string;
  readonly title: string;
  /** Plain text, since the panel renders no markup a course wrote. */
  readonly summary: string;
  readonly postedAt: number | null;
  readonly url: string;
}

const SUMMARY_CHARS = 220;

export const deepLinkForNews = (learnOrigin: string, courseId: string): string =>
  `${learnOrigin}/d2l/le/news/${courseId}/news/list`;

interface RawNews {
  readonly Id?: unknown;
  readonly Title?: unknown;
  readonly Body?: unknown;
  readonly StartDate?: unknown;
  readonly CreatedDate?: unknown;
  readonly IsHidden?: unknown;
}

export const normalizeNews = (
  json: unknown,
  courseId: string,
  learnOrigin: string,
): readonly Announcement[] => {
  const out: Announcement[] = [];

  for (const row of asArray(json)) {
    const item = row as RawNews;
    const id = numericId(item.Id);
    if (id === null) continue;
    if (item.IsHidden === true) continue;

    const title =
      typeof item.Title === 'string' && item.Title.trim() !== ''
        ? item.Title.trim()
        : 'Announcement';

    out.push({
      id: `news:${courseId}:${id}`,
      courseId,
      title,
      summary: toPlainText(item.Body),
      postedAt:
        parseUtcDateTime(asString(item.StartDate)) ??
        parseUtcDateTime(asString(item.CreatedDate)),
      url: deepLinkForNews(learnOrigin, courseId),
    });
  }

  return out.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
};

/**
 * Announcement bodies are course-authored HTML. Rendering that inside the
 * panel would hand a course control over the extension interface, so it is
 * reduced to text and truncated.
 */
export const toPlainText = (body: unknown): string => {
  const raw =
    typeof body === 'string'
      ? body
      : typeof (body as { Html?: unknown })?.Html === 'string'
        ? (body as { Html: string }).Html
        : typeof (body as { Text?: unknown })?.Text === 'string'
          ? (body as { Text: string }).Text
          : '';

  const text = raw
    .replace(SCRIPT_BLOCK, ' ')
    .replace(STYLE_BLOCK, ' ')
    .replace(ANY_TAG, ' ')
    .replace(NBSP, ' ')
    .replace(AMP, '&')
    .replace(LT, '<')
    .replace(GT, '>')
    .replace(WHITESPACE, ' ')
    .trim();

  return text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS).trimEnd()}\u2026` : text;
};

const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style[\s\S]*?<\/style>/gi;
const ANY_TAG = /<[^>]+>/g;
const NBSP = /&nbsp;/gi;
const AMP = /&amp;/gi;
const LT = /&lt;/gi;
const GT = /&gt;/gi;
const WHITESPACE = /\s+/g;
