/**
 * Reads a class schedule off a Portal page.
 *
 * Portal renders client side, so its markup is unknown until someone signed in
 * looks at it. Rather than guess at a DOM shape that may not exist, this reads
 * the visible text of the page and looks for the thing that stays stable
 * whatever the layout does: a course code, a component label, and a day and
 * time near each other.
 *
 * It also keeps a short sample of what it saw. When the parse finds nothing,
 * that sample is the difference between fixing the parser and guessing at it.
 */

import { parseScheduleText } from './parse';
import { parseDatedEvents, type DatedEvent } from './events';
import { emptySchedule, type TermSchedule } from '@core/schedule/types';

const SAMPLE_CHARS = 4000;

export interface PortalCapture {
  readonly schedule: TermSchedule;
  /**
   * Real dated sessions, which beat any weekly pattern.
   *
   * Labs are routinely biweekly, skip reading week, or start in the second
   * week, so counting "the third Wednesday" drifts from reality and does so
   * silently. A calendar that states the dates is simply correct.
   */
  readonly events: readonly DatedEvent[];
  readonly sawText: boolean;
  /** Visible text, kept only so a failed parse can be diagnosed. */
  readonly sample: string;
  readonly url: string;
}

export const captureFromDocument = (doc: Document, now: number): PortalCapture => {
  const text = visibleText(doc);
  const meetings = parseScheduleText(text);
  const events = parseDatedEvents(text);

  return {
    schedule: {
      ...emptySchedule,
      capturedAt: now,
      termLabel: findTermLabel(text),
      termStartsOn: null,
      meetings,
    },
    events,
    sawText: text.trim().length > 0,
    sample: text.slice(0, SAMPLE_CHARS),
    url: doc.location?.href ?? '',
  };
};

/**
 * Text as a person sees it, with block boundaries preserved.
 *
 * innerText alone collapses a table into one run, which destroys the row
 * structure the parser depends on, so block-level elements are separated
 * explicitly.
 */
export const visibleText = (doc: Document): string => {
  const root = doc.body;
  if (root === null) return '';

  const parts: string[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode();
  while (node !== null) {
    const parent = node.parentElement;
    if (parent !== null && !isHidden(parent)) {
      const value = (node.nodeValue ?? '').replace(/\s+/g, ' ').trim();
      if (value !== '') parts.push({ value, block: isBlock(parent) }.value + (isBlock(parent) ? '\n' : ' '));
    }
    node = walker.nextNode();
  }

  return parts
    .join('')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '')
    .join('\n');
};

const HIDDEN_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);

const isHidden = (el: Element): boolean => {
  if (HIDDEN_TAGS.has(el.tagName)) return true;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style === undefined) return false;
  return style.display === 'none' || style.visibility === 'hidden';
};

const BLOCK_TAGS = new Set([
  'DIV', 'P', 'LI', 'TR', 'TD', 'TH', 'SECTION', 'ARTICLE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TABLE', 'UL', 'OL',
]);

const isBlock = (el: Element): boolean => BLOCK_TAGS.has(el.tagName);

const findTermLabel = (text: string): string | null => {
  const m = /\b(Fall|Winter|Spring)\s+(20\d\d)\b/i.exec(text);
  return m === null ? null : `${m[1]} ${m[2]}`;
};
