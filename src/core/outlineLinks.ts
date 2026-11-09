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

/** Copied page markup above this, once slimmed, is not one outline. */
const MAX_PASTED_HTML = 400_000;

/** Markup worth keeping: something with rows or paragraphs in it. */
const HAS_STRUCTURE = /<\s*(?:table|tr|td|th|p|li|br|div|h[1-6])\b/i;

/**
 * Copied page markup with everything but its structure removed: no scripts,
 * styles or comments, and no attributes on any tag. What is left is small
 * and is exactly what keeps a table row on one line when it is read.
 */
export const slimPastedHtml = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(meta|link|img|svg|input|button)[^>]*>/gi, ' ')
    .replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi, '<$1$2>')
    .replace(/[ \t]+/g, ' ')
    .trim();

/**
 * What a paste into the outline box is saved as.
 *
 * Copying from a web page puts two things on the clipboard: plain text and
 * the page's markup. Plain text splits a table cell holding two paragraphs
 * across lines, which pulls a quiz away from its date. The markup keeps
 * every row whole, so it is preferred whenever the copy carried any.
 */
export const preparePaste = (text: string, html: string): TextCheck => {
  if (html !== '' && HAS_STRUCTURE.test(html)) {
    const slim = slimPastedHtml(html);
    if (slim.length >= MIN_PASTED_CHARS && slim.length <= MAX_PASTED_HTML) return { ok: true, text: slim };
  }
  return parseOutlineText(text);
};

/** The outline site's search, already filled in with this course's code. */
export const outlineSearchUrl = (code: string, name: string): string =>
  `${OUTLINE_SITE}/viewer/?q=${encodeURIComponent(shortCourseLabel(code, name))}`;
