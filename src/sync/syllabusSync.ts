/**
 * Reading a course syllabus.
 *
 * Deliberately limited to documents whose text can be read without a PDF
 * engine: LEARN HTML pages, and plain or markdown files. PDF and DOCX need
 * pdf.js and mammoth running in an offscreen document, which is a larger piece
 * of work and is not started here.
 *
 * A course whose outline is a PDF therefore contributes nothing yet, and says
 * so through its health record rather than failing silently.
 */

import { type Result, ok } from '@shared/result';
import type { AppError } from '@shared/errors';
import { flattenToc, pickSyllabusTopics } from '@core/syllabus/discover';
import { extractCandidates } from '@core/syllabus/extract';
import { termFrom } from '@core/syllabus/dates';
import { candidatesToItems, dropDuplicatesOfLearn } from '@core/syllabus/toItems';
import { LEARN_ORIGIN } from '@shared/constants';
import type { Course, TaskItem } from '@core/types';
import type { Fetcher } from './fetchProxy';

export interface SyllabusOutcome {
  readonly items: readonly TaskItem[];
  /** Set when a syllabus was found but could not be read. */
  readonly unreadable: string | null;
}

const READABLE = /\.(html?|txt|md)$/i;

export const syncSyllabus = async (
  fetcher: Fetcher,
  course: Course,
  le: string,
  learnItems: readonly TaskItem[],
  now: number,
): Promise<Result<SyllabusOutcome, AppError>> => {
  const toc = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/content/toc`);
  if (!toc.ok) return ok({ items: [], unreadable: null });

  const topics = flattenToc(toc.value.json, LEARN_ORIGIN, course.id);
  const picked = pickSyllabusTopics(topics, now);
  if (picked.length === 0) return ok({ items: [], unreadable: null });

  const term = termFrom(null, now);
  const collected: TaskItem[] = [];
  let unreadable: string | null = null;

  for (const topic of picked) {
    const isHtmlTopic = topic.typeIdentifier === 'Html' || READABLE.test(topic.title);
    if (!isHtmlTopic) {
      unreadable = topic.title;
      continue;
    }

    const text = await fetchText(fetcher, topic.url);
    if (text === null) continue;

    const candidates = extractCandidates(toLines(text), term);
    collected.push(
      ...candidatesToItems(candidates, course.id, {
        topicId: topic.id,
        title: topic.title,
        url: topic.url,
      }, now),
    );
  }

  return ok({ items: dropDuplicatesOfLearn(collected, learnItems), unreadable });
};

/**
 * The relay returns parsed JSON, so an HTML document arrives as a parse
 * failure rather than a body. Until the relay grows a text mode, a syllabus
 * page that is not JSON simply yields nothing, which is the safe direction.
 */
const fetchText = async (fetcher: Fetcher, url: string): Promise<string | null> => {
  const path = url.startsWith(LEARN_ORIGIN) ? url.slice(LEARN_ORIGIN.length) : url;
  const res = await fetcher.getJson(path);
  if (!res.ok) return null;
  return typeof res.value.json === 'string' ? res.value.json : null;
};

/**
 * Splits document text into candidate lines.
 *
 * Table rows in HTML collapse onto one line, which suits the extractor: it
 * wants a date and an assessment name in the same string, and a table row is
 * exactly that.
 */
export const toLines = (text: string): readonly string[] =>
  text
    .replace(/<\s*(br|\/tr|\/p|\/div|\/li|\/h[1-6])\s*>/gi, '\n')
    .replace(/<\s*\/?\s*t[dh][^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);
