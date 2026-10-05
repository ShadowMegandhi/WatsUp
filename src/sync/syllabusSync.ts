/**
 * Reading a course syllabus.
 *
 * Handles the two shapes a UW outline actually takes: a LEARN HTML page, and
 * a PDF. PDFs go through an offscreen document because pdf.js cannot run in a
 * service worker.
 *
 * When a syllabus is found but cannot be read, that is recorded and surfaced,
 * rather than looking identical to a course that simply had no assessments.
 */

import { type Result, ok } from '@shared/result';
import type { AppError } from '@shared/errors';
import { flattenToc, pickSyllabusTopics } from '@core/syllabus/discover';
import { extractAssessments } from '@core/syllabus/extract';
import { termFrom } from '@core/syllabus/dates';
import { candidatesToItems, dropDuplicatesOfLearn, type SourceDoc } from '@core/syllabus/toItems';
import { LEARN_ORIGIN } from '@shared/constants';
import type { Course, TaskItem } from '@core/types';
import type { Fetcher } from './fetchProxy';
import { fetchExternalText, isFollowable } from './fetchProxy';
import { extractPdfLines } from '@platform/offscreenHost';

export interface SyllabusOutcome {
  readonly items: readonly TaskItem[];
  /** What was searched, so the panel can explain an empty result. */
  readonly docsFound: number;
  readonly docsRead: number;
  readonly note: string | null;
}

const PDF = /\.pdf(\?|$)/i;
const UNREADABLE = /\.docx?(\?|$)/i;

export const syncSyllabus = async (
  fetcher: Fetcher,
  course: Course,
  le: string,
  learnItems: readonly TaskItem[],
  now: number,
): Promise<Result<SyllabusOutcome, AppError>> => {
  const empty = { items: [], docsFound: 0, docsRead: 0, note: null } as const;

  const overview = await readOverview(fetcher, course.id, le);

  const toc = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/content/toc`);
  const picked = toc.ok
    ? pickSyllabusTopics(flattenToc(toc.value.json, LEARN_ORIGIN, course.id), now)
    : [];

  if (picked.length === 0 && overview.length === 0) {
    return ok({
      ...empty,
      note: toc.ok ? "No syllabus found in this course." : "Could not read the course content list.",
    });
  }

  const term = termFrom(null, now);
  const collected: TaskItem[] = [];
  const problems: string[] = [];
  let read = 0;

  const take = (lines: readonly string[], doc: SourceDoc): void => {
    read += 1;
    collected.push(
      ...candidatesToItems(extractAssessments(lines, term), course.id, doc, now),
    );
  };

  for (const part of overview) take(part.lines, part.doc);

  for (const topic of picked) {
    const lines = await readDocument(fetcher, topic.url, topic.typeIdentifier, topic.title);

    if (lines.error !== null) {
      problems.push(`${topic.title}: ${lines.error}`);
      continue;
    }
    if (lines.value.length === 0) continue;

    take(lines.value, { topicId: topic.id, title: topic.title, url: topic.url });
  }

  const items = dropDuplicatesOfLearn(collected, learnItems);

  return ok({
    items,
    docsFound: picked.length + overview.length,
    docsRead: read,
    note:
      problems.length > 0
        ? problems.join(SEP)
        : read > 0 && items.length === 0
          ? "Syllabus read. No assessment had a date written beside it."
          : null,
  });
};

const SEP = "; ";

interface OverviewPart {
  readonly lines: readonly string[];
  readonly doc: SourceDoc;
}

/**
 * The course's Overview page, which many instructors use instead of a
 * content-tree outline: its text, plus the file attached to it if any.
 *
 * Best effort. A course with no overview, or one this account cannot read,
 * yields nothing rather than a problem note, since most courses leave it
 * empty.
 */
const readOverview = async (
  fetcher: Fetcher,
  courseId: string,
  le: string,
): Promise<readonly OverviewPart[]> => {
  const res = await fetcher.getJson(`/d2l/api/le/${le}/${courseId}/overview`);
  if (!res.ok) return [];

  const json = res.value.json as Record<string, unknown> | null;
  const desc = (json?.['Description'] ?? null) as Record<string, unknown> | null;
  const html = typeof desc?.['Html'] === 'string' ? desc['Html'] : '';
  const text = typeof desc?.['Text'] === 'string' ? desc['Text'] : '';
  const pageUrl = `${LEARN_ORIGIN}/d2l/home/${courseId}`;

  const parts: OverviewPart[] = [];
  const lines = toLines(html !== '' ? html : text);
  if (lines.length > 0) {
    parts.push({ lines, doc: { topicId: 'overview', title: 'Course Overview', url: pageUrl } });
  }

  if (json?.['HasAttachment'] === true) {
    const url = `${LEARN_ORIGIN}/d2l/api/le/${le}/${courseId}/overview/attachment`;
    const file = await readDocument(fetcher, url, 'File', 'Course Overview attachment');
    if (file.error === null && file.value.length > 0) {
      parts.push({
        lines: file.value,
        doc: { topicId: 'overview-file', title: 'Course Overview attachment', url: pageUrl },
      });
    }
  }

  return parts;
};

/**
 * Reads one document, deciding how by looking at it rather than at its name.
 *
 * D2L reports an uploaded outline as type "File" with a viewContent URL that
 * carries no extension, so routing on the filename rejected exactly the
 * documents most worth reading. Fetching first and checking the leading bytes
 * settles it: a PDF announces itself, and anything else is treated as markup.
 */
const readDocument = async (
  fetcher: Fetcher,
  url: string,
  typeIdentifier: string,
  title: string,
): Promise<{ value: readonly string[]; error: string | null }> => {
  if (UNREADABLE.test(url) || UNREADABLE.test(title)) {
    return { value: [], error: "Word documents cannot be read yet" };
  }

  // A name that already says PDF saves a round trip.
  if (PDF.test(url) || PDF.test(title)) return await readPdf(url);

  if (typeIdentifier === 'Link') {
    if (!isFollowable(url)) {
      return { value: [], error: "Syllabus links to a site outside Waterloo" };
    }

    const external = await fetchExternalText(url);
    if (!external.ok) {
      return {
        value: [],
        error: external.error.kind === 'auth-redirect'
          ? "Sign in to outline.uwaterloo.ca once, then refresh"
          : external.error.kind === "http"
            ? `Linked outline returned ${external.error.status}`
            : `Could not open the linked outline: ${external.error.message}`,
      };
    }

    if (external.value.slice(0, 1024).includes("%PDF")) return await readPdf(url);

    const linked = toLines(external.value);
    if (linked.length === 0) return { value: [], error: "Linked outline had no readable text" };
    return { value: linked, error: null };
  }

  const text = await fetchText(fetcher, url);
  if (text === null) return { value: [], error: "Could not open the syllabus" };

  // A PDF fetched as text still begins with its signature.
  if (text.slice(0, 1024).includes("%PDF")) return await readPdf(url);

  const parsed = toLines(text);
  if (parsed.length === 0) return { value: [], error: "Syllabus had no readable text" };
  return { value: parsed, error: null };
};

const readPdf = async (url: string): Promise<{ value: readonly string[]; error: string | null }> => {
  const pdf = await extractPdfLines(url);
  return { value: pdf.lines, error: pdf.error };
};
const fetchText = async (fetcher: Fetcher, url: string): Promise<string | null> => {
  const path = url.startsWith(LEARN_ORIGIN) ? url.slice(LEARN_ORIGIN.length) : url;
  const res = await fetcher.getText(path);
  return res.ok ? res.value : null;
};
/**
 * Splits document text into candidate lines.
 *
 * Script and style blocks are removed whole, not just their tags. Stripping
 * tags alone leaves the code inside them behind, and a page script full of
 * regular expressions and braces then reaches the assessment reader looking
 * like prose. That is noise at best and a false positive at worst.
 *
 * Table rows are collapsed onto one line, which suits the reader: it wants a
 * date and an assessment name in the same string, and a table row is exactly
 * that.
 */
export const toLines = (text: string): readonly string[] =>
  text
    .replace(SCRIPT_BLOCK, " ")
    .replace(STYLE_BLOCK, " ")
    .replace(COMMENT_BLOCK, " ")
    .replace(BLOCK_END, "\n")
    .replace(CELL_EDGE, " | ")
    .replace(ANY_TAG, " ")
    .replace(NBSP, " ")
    .replace(AMP, "&")
    .split("\n")
    .map((l) => l.replace(WHITESPACE, " ").trim())
    .filter((l) => l.length > 0);
const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style[\s\S]*?<\/style>/gi;
const COMMENT_BLOCK = /<!--[\s\S]*?-->/g;
const BLOCK_END = /<\s*(br|\/tr|\/p|\/div|\/li|\/h[1-6])\s*>/gi;
const CELL_EDGE = /<\s*\/?\s*t[dh][^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;
const NBSP = /&nbsp;/gi;
const AMP = /&amp;/gi;
const WHITESPACE = /\s+/g;
