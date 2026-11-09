/**
 * Reading HTML tables as tables, before they are flattened into lines.
 *
 * Three things a table says through its structure, not its text, that a
 * line-by-line reader would otherwise lose:
 *
 *   1. A cell spanning rows ("rowspan") belongs to every row it covers. A
 *      schedule that writes "Week 7, Oct 19 - 23" once beside three rows
 *      means each of those rows is in week 7.
 *   2. A column header names what is under it. "2" under a "Quiz" header is
 *      Quiz 2; a tick under it means a quiz that row.
 *   3. Where a table ends. A week label inside one table says nothing about
 *      the rows of the next.
 *
 * Each is read from the table itself; nothing is inferred beyond it.
 */

import { findMentions, findPluralMention, variantsOf } from './mentions';

/** Lines marking where a table starts and ends, for the whole-document reader. */
export const TABLE_START = '⟦table⟧';
export const TABLE_END = '⟦/table⟧';

/** A table holding no table inside it. Outer tables are handled on a later pass. */
const INNERMOST_TABLE = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table\s*>/gi;
const ROW = /<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi;
const CELL = /<(t[dh])\b([^>]*)>([\s\S]*?)<\/t[dh]\s*>/gi;

/** Nested tables are rare in outlines; this many passes unwraps them. */
const MAX_NESTING = 4;
/** A span past this is a layout table, not a schedule. */
const MAX_SPAN = 20;
/** A column header naming an assessment is a short label, not a sentence. */
const MAX_HEADER = 30;

interface Cell {
  readonly html: string;
  readonly isHeader: boolean;
}

const span = (attrs: string, name: 'rowspan' | 'colspan'): number => {
  const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs);
  const n = m === null ? 1 : Number(m[1]);
  return n >= 1 && n <= MAX_SPAN ? n : 1;
};

export const cellText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** Rows with every spanned cell copied into each row it covers. */
const expandRows = (tableHtml: string): readonly (readonly Cell[])[] => {
  const pending: ({ cell: Cell; left: number } | undefined)[] = [];
  const rows: Cell[][] = [];

  for (const row of tableHtml.matchAll(ROW)) {
    const out: Cell[] = [];
    let col = 0;
    const fillSpanned = (): void => {
      for (let p = pending[col]; p !== undefined && p.left > 0; p = pending[col]) {
        out.push(p.cell);
        p.left -= 1;
        col += 1;
      }
    };

    for (const c of (row[1] ?? '').matchAll(CELL)) {
      fillSpanned();
      const cell: Cell = { html: c[3] ?? '', isHeader: (c[1] ?? '').toLowerCase() === 'th' };
      const down = span(c[2] ?? '', 'rowspan');
      const across = span(c[2] ?? '', 'colspan');
      for (let k = 0; k < across; k += 1) {
        // The text sits in the first column only; the rest keep columns lined up.
        const placed = k === 0 ? cell : { html: '', isHeader: cell.isHeader };
        out.push(placed);
        pending[col] = down > 1 ? { cell: placed, left: down - 1 } : undefined;
        col += 1;
      }
    }
    fillSpanned();
    rows.push(out);
  }

  return rows;
};

/** A tick, a cross or a yes in a column: "this row has one". */
const MARK = /^(?:✓|✔|☑|x|yes|y|\*|•)$/i;
/** An empty-looking cell: a dash, "n/a", "none". */
const NOTHING = /^(?:[-–—]+|n\/?a|none|no)$/i;

const capitalised = (term: string): string =>
  term.replace(/(^|[ -])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());

/** The one assessment a header cell names ("Quiz", "Quizzes"), or null. */
const headerTerm = (text: string): string | null => {
  if (text === '' || text.length > MAX_HEADER) return null;
  const lower = text.toLowerCase();
  const mentions = findMentions(lower);
  if (mentions.length === 1) return mentions[0]?.term ?? null;
  if (mentions.length > 1) return null;
  return findPluralMention(lower)?.term ?? null;
};

/**
 * The column a header row labels with an assessment, if exactly one does.
 * A header row is the first row, when it has header cells or no digits at
 * all ("Week | Date | Topic | Quiz").
 */
const labelledColumn = (rows: readonly (readonly Cell[])[]): { col: number; term: string } | null => {
  const head = rows[0];
  if (head === undefined) return null;
  const texts = head.map((c) => cellText(c.html));
  const looksLikeHeader = head.some((c) => c.isHeader) || texts.every((t) => !/\d/.test(t));
  if (!looksLikeHeader) return null;

  const found = texts.map((t, col) => ({ col, term: headerTerm(t) })).filter((h) => h.term !== null);
  if (found.length !== 1) return null;
  const only = found[0];
  return only === undefined || only.term === null ? null : { col: only.col, term: only.term };
};

/** A body cell read under its column's assessment header. */
const labelCell = (html: string, term: string): string => {
  const text = cellText(html);
  if (text === '' || NOTHING.test(text)) return html;

  const lower = text.toLowerCase();
  // It already names an assessment of its own: leave it as written.
  if (findMentions(lower).length > 0 || variantsOf(term).some((v) => lower.includes(v))) return html;

  const name = capitalised(term);
  const number = /^#?\s*(\d{1,2})$/.exec(text);
  if (number !== null) return `${name} ${number[1]}`;
  if (MARK.test(text)) return name;
  return `${name}: ${html}`;
};

const rebuild = (rows: readonly (readonly Cell[])[], label: { col: number; term: string } | null): string => {
  const body = rows
    .map((row, r) => {
      const cells = row.map((cell, col) => {
        const html = label !== null && r > 0 && col === label.col ? labelCell(cell.html, label.term) : cell.html;
        return `<td>${html}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');
  return `<p>${TABLE_START}</p>${body}<p>${TABLE_END}</p>`;
};

/** Every table in a page, rewritten so its structure survives flattening. */
export const normalizeTables = (html: string): string => {
  let out = html;
  for (let pass = 0; pass < MAX_NESTING; pass += 1) {
    const next = out.replace(INNERMOST_TABLE, (_whole, inner: string) => {
      const rows = expandRows(inner);
      return rows.length === 0 ? ' ' : rebuild(rows, labelledColumn(rows));
    });
    if (next === out) break;
    out = next;
  }
  return out;
};
