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

/** The outline site's search, already filled in with this course's code. */
export const outlineSearchUrl = (code: string, name: string): string =>
  `${OUTLINE_SITE}/viewer/?q=${encodeURIComponent(shortCourseLabel(code, name))}`;
