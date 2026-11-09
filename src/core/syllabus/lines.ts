/**
 * Document text to the lines the outline reader works on.
 *
 * Shared by every way an outline arrives: a LEARN page, a linked outline,
 * pasted text, and Word files, whose tables are turned into the same markup
 * first so they are read the same way.
 */

import { normalizeTables } from './tables';

/**
 * Splits document text into candidate lines.
 *
 * Script and style blocks are removed whole, not just their tags. Stripping
 * tags alone leaves the code inside them behind, and a page script full of
 * regular expressions and braces then reaches the assessment reader looking
 * like prose. That is noise at best and a false positive at worst.
 *
 * Plain text copied from a table (a pasted outline) separates cells with
 * tabs; those become the same " | " cell marks an HTML table gets.
 *
 * Table rows are collapsed onto one line, which suits the reader: it wants a
 * date and an assessment name in the same string, and a table row is exactly
 * that.
 */
export const toLines = (text: string): readonly string[] =>
  (LOOKS_LIKE_HTML.test(text) ? markupOf(text) : text.replace(TAB_CELLS, " | "))
    // A row stays one line even when its cells hold paragraphs or breaks.
    // The outline site wraps every cell in <p>, which used to put the date
    // and the quiz it belongs to on separate lines.
    .replace(TABLE_ROW, (row) => row.replace(BLOCK_INSIDE_ROW, " "))
    .replace(BLOCK_END, "\n")
    .replace(CELL_EDGE, " | ")
    .replace(ANY_TAG, " ")
    .replace(NBSP, " ")
    .replace(AMP, "&")
    .split("\n")
    .map((l) => l.replace(WHITESPACE, " ").trim())
    .filter((l) => l.length > 0);
/**
 * Markup with scripts, styles and comments gone and tables rewritten so
 * their structure (spanned cells, labelled columns, where each table ends)
 * survives being flattened into lines.
 */
const markupOf = (html: string): string =>
  normalizeTables(
    html.replace(SCRIPT_BLOCK, " ").replace(STYLE_BLOCK, " ").replace(COMMENT_BLOCK, " "),
  ).replace(WHITESPACE, " ");

/**
 * In markup, source line breaks mean nothing; the outline site indents every
 * cell across several lines. Plain text keeps its line breaks.
 */
const LOOKS_LIKE_HTML = /<\s*(?:html|body|div|p|table|tr|td|br|span|h[1-6])\b/i;
const TABLE_ROW = /<tr[\s>][\s\S]*?<\/tr\s*>/gi;
const BLOCK_INSIDE_ROW = /<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi;
const SCRIPT_BLOCK = /<script[\s\S]*?<\/script>/gi;
const STYLE_BLOCK = /<style[\s\S]*?<\/style>/gi;
const COMMENT_BLOCK = /<!--[\s\S]*?-->/g;
const BLOCK_END = /<\s*(br|\/tr|\/p|\/div|\/li|\/h[1-6])\s*>/gi;
const CELL_EDGE = /<\s*\/?\s*t[dh][^>]*>/gi;
const ANY_TAG = /<[^>]+>/g;
const NBSP = /&nbsp;/gi;
const AMP = /&amp;/gi;
const WHITESPACE = /\s+/g;
const TAB_CELLS = /[ ]*\t+[ ]*/g;
