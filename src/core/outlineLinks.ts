/**
 * Outline links a student adds by hand.
 *
 * For a course whose instructor never put the outline in LEARN, the student
 * finds it on the outline site and pastes the link. Only the two hosts the
 * extension already has access to are accepted: anything else would need a
 * new permission, and the privacy promise lists exactly those two.
 */

import { shortCourseLabel } from './courseColor';

export const OUTLINE_SITE = 'https://outline.uwaterloo.ca';

const ALLOWED_HOSTS: readonly string[] = ['outline.uwaterloo.ca', 'learn.uwaterloo.ca'];

/** At most this many links per course; an outline is one or two documents. */
export const MAX_LINKS_PER_COURSE = 3;

export type LinkCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/** Checks a pasted link, tidying the usual copy-paste debris first. */
export const parseOutlineLink = (input: string): LinkCheck => {
  const trimmed = input.trim().replace(/^<|>$/g, '');
  if (trimmed === '') return { ok: false, reason: 'Paste a link first.' };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: "That doesn't look like a link." };
  }

  if (!ALLOWED_HOSTS.includes(url.host)) {
    return {
      ok: false,
      reason: 'Only outline.uwaterloo.ca or learn.uwaterloo.ca links can be read.',
    };
  }

  url.protocol = 'https:';
  url.hash = '';
  return { ok: true, url: url.toString() };
};

/** Pasted outline text above this is not an outline; it would bloat storage. */
export const MAX_PASTED_CHARS = 100_000;

/** Shorter than this cannot hold a dated assessment. */
const MIN_PASTED_CHARS = 10;

export type TextCheck =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Checks outline text a student pasted. Line breaks and tabs are kept: a
 * table copied from a page arrives as one row per line, cells split by tabs,
 * and that is what keeps a date beside the quiz it belongs to.
 */
export const parseOutlineText = (input: string): TextCheck => {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (text.length < MIN_PASTED_CHARS) return { ok: false, reason: 'Paste the outline text first.' };
  if (text.length > MAX_PASTED_CHARS) {
    return { ok: false, reason: 'That is too long. Paste just the schedule and assessment parts.' };
  }
  if (/^https?:\/\/\S+$/i.test(text)) {
    return { ok: false, reason: 'That is a link. Paste it in the link box above.' };
  }
  return { ok: true, text };
};

/** The outline site's search, already filled in with this course's code. */
export const outlineSearchUrl = (code: string, name: string): string =>
  `${OUTLINE_SITE}/viewer/?q=${encodeURIComponent(shortCourseLabel(code, name))}`;
