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
import { extractCandidates, nearMisses } from '@core/syllabus/extract';
import { parseRecurring } from '@core/syllabus/recurring';
import { placeRecurring } from '@core/syllabus/placeRecurring';
import type { DatedSession } from '@core/syllabus/sessions';
import { termFrom } from '@core/syllabus/dates';
import { candidatesToItems, dropDuplicatesOfLearn } from '@core/syllabus/toItems';
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
  sessions: readonly DatedSession[] = [],
): Promise<Result<SyllabusOutcome, AppError>> => {
  const empty = { items: [], docsFound: 0, docsRead: 0, note: null } as const;

  const toc = await fetcher.getJson(`/d2l/api/le/${le}/${course.id}/content/toc`);
  if (!toc.ok) return ok({ ...empty, note: "Could not read the course content list." });

  const topics = flattenToc(toc.value.json, LEARN_ORIGIN, course.id);
  const picked = pickSyllabusTopics(topics, now);
  if (picked.length === 0) return ok({ ...empty, note: "No syllabus found in this course." });

  const term = termFrom(null, now);
  const collected: TaskItem[] = [];
  const problems: string[] = [];
  let read = 0;

  for (const topic of picked) {
    const lines = await readDocument(fetcher, topic.url, topic.typeIdentifier, topic.title);

    if (lines.error !== null) {
      problems.push(`${topic.title}: ${lines.error}`);
      continue;
    }
    if (lines.value.length === 0) continue;

    read += 1;
    const candidates = extractCandidates(lines.value, term);

    // A syllabus that counts its assessments rather than dating them needs
    // the calendar to say when the component meets. Neither half is enough
    // alone, so nothing is placed until both are present.
    const placed = placeRecurring(
      parseRecurring(lines.value),
      sessions,
      course.id,
      course.code || course.name,
      { topicId: topic.id, title: topic.title, url: topic.url },
      now,
    );
    collected.push(...placed.items);
    for (const note of placed.unplaced) problems.push(`${topic.title}: ${note}`);


    if (candidates.length < NEAR_MISS_UNTIL) {
      const missed = nearMisses(lines.value, term);
      if (missed.length > 0) {
        problems.push(`${topic.title} came close on: ${missed.join(SEP)}`);
      }
    }

    collected.push(
      ...candidatesToItems(
        candidates,
        course.id,
        { topicId: topic.id, title: topic.title, url: topic.url },
        now,
      ),
    );
  }

  const items = dropDuplicatesOfLearn(collected, learnItems);

  return ok({
    items,
    docsFound: picked.length,
    docsRead: read,
    note:
      problems.length > 0
        ? problems.join(SEP)
        : read > 0 && items.length === 0
          ? "Syllabus read, but nothing was clearly labelled with a date."
          : null,
  });
};

const SEP = "; ";

/** Below this many finds, report what was skipped so it can be tuned. */
const NEAR_MISS_UNTIL = 5;

/** Reads one document, choosing the reader by file type. */
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
