/**
 * Reading HTML tables as tables, before they are flattened into lines.
 *
 * Three things a table says through its structure, not its text, that a
 * line-by-line reader would otherwise lose:
 *
 *   1. A label cell spanning rows ("rowspan") belongs to every row it
 *      covers. A schedule that writes "Week 7, Oct 19 - 23" once beside
 *      three rows means each of those rows is in week 7.
 *   2. A column header names what is under it. "2" under a "Quiz" header is
 *      Quiz 2; a tick under it means a quiz that row.
 *   3. Where a table ends. A week label inside one table says nothing about
 *      the rows of the next.
 *
 * An assessment cell spanning several rows is the opposite case: "Quiz 2"
 * beside Monday, Wednesday and Friday says the quiz is somewhere in those
 * days, not on each of them. It is never copied into a dated row. It is
 * kept on a row of its own with only the cells spanning the same rows (a
 * week label), so a stated weekly rule can still give it a day, and it is
 * otherwise left out.
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

interface RawCell {
  readonly html: string;
  readonly isHeader: boolean;
  readonly down: number;
  readonly across: number;
}

interface Row {
  readonly cells: readonly string[];
  /** A row built from held-back assessment cells, already labelled. */
  readonly held: boolean;
}

interface Label {
  readonly col: number;
  readonly term: string;
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

const parseRows = (tableHtml: string): readonly (readonly RawCell[])[] =>
  [...tableHtml.matchAll(ROW)].map((row) =>
    [...(row[1] ?? '').matchAll(CELL)].map((c) => ({
      html: c[3] ?? '',
      isHeader: (c[1] ?? '').toLowerCase() === 'th',
      down: span(c[2] ?? '', 'rowspan'),
      across: span(c[2] ?? '', 'colspan'),
    })),
  );

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
const labelledColumn = (head: readonly RawCell[] | undefined): Label | null => {
  if (head === undefined) return null;
  const columns: { text: string; isHeader: boolean }[] = [];
  for (const cell of head) {
    columns.push({ text: cellText(cell.html), isHeader: cell.isHeader });
    for (let k = 1; k < cell.across; k += 1) columns.push({ text: '', isHeader: cell.isHeader });
  }
  const looksLikeHeader = columns.some((c) => c.isHeader) || columns.every((c) => !/\d/.test(c.text));
  if (!looksLikeHeader) return null;

  const found = columns.map((c, col) => ({ col, term: headerTerm(c.text) })).filter((h) => h.term !== null);
  const only = found.length === 1 ? found[0] : undefined;
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

/** The cell as read, with its column's label applied to body rows. */
const asRead = (html: string, col: number, isBody: boolean, label: Label | null): string =>
  label !== null && isBody && col === label.col ? labelCell(html, label.term) : html;

const namesWork = (html: string): boolean => {
  const lower = cellText(html).toLowerCase();
  return findMentions(lower).length > 0 || findPluralMention(lower) !== null;
};

interface Pending {
  readonly html: string;
  left: number;
}

interface Held {
  readonly html: string;
  readonly companions: readonly string[];
  left: number;
}

/**
 * Rows with spanned label cells copied into each row they cover, and
 * spanned assessment cells held back onto a row of their own.
 */
const expandRows = (raw: readonly (readonly RawCell[])[], label: Label | null): readonly Row[] => {
  const pending: (Pending | undefined)[] = [];
  const held: Held[] = [];
  const rows: Row[] = [];

  raw.forEach((rawRow, r) => {
    const out: string[] = [];
    const startedHere: { html: string; down: number; work: boolean }[] = [];
    let col = 0;

    const fillSpanned = (): void => {
      for (let p = pending[col]; p !== undefined && p.left > 0; p = pending[col]) {
        out.push(p.html);
        p.left -= 1;
        col += 1;
      }
    };

    for (const cell of rawRow) {
      fillSpanned();
      const html = asRead(cell.html, col, r > 0, label);
      const work = cell.down > 1 && cellText(html) !== '' && namesWork(html);
      for (let k = 0; k < cell.across; k += 1) {
        // A held assessment leaves its covered rows blank; a label fills them.
        const placed = k === 0 && !work ? html : '';
        out.push(placed);
        pending[col] = cell.down > 1 ? { html: placed, left: cell.down - 1 } : undefined;
        col += 1;
      }
      startedHere.push({ html, down: cell.down, work });
    }
    fillSpanned();
    rows.push({ cells: out, held: false });

    for (const s of startedHere.filter((x) => x.work)) {
      const companions = startedHere.filter((x) => !x.work && x.down >= s.down).map((x) => x.html);
      held.push({ html: s.html, companions, left: s.down - 1 });
    }

    // A held assessment gets its own row once the rows it spans are done.
    for (const h of held) {
      if (h.left === 0) rows.push({ cells: [...h.companions, h.html], held: true });
    }
    for (let i = held.length - 1; i >= 0; i -= 1) {
      const h = held[i] as Held;
      if (h.left === 0) held.splice(i, 1);
      else h.left -= 1;
    }
  });

  // A span running past the table's last row still ends with the table.
  for (const h of held) rows.push({ cells: [...h.companions, h.html], held: true });
  return rows;
};

const rebuild = (rows: readonly Row[]): string => {
  const body = rows.map((row) => `<tr>${row.cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<p>${TABLE_START}</p>${body}<p>${TABLE_END}</p>`;
};

/** Every table in a page, rewritten so its structure survives flattening. */
export const normalizeTables = (html: string): string => {
  let out = html;
  for (let pass = 0; pass < MAX_NESTING; pass += 1) {
    const next = out.replace(INNERMOST_TABLE, (_whole, inner: string) => {
      const raw = parseRows(inner);
      return raw.length === 0 ? ' ' : rebuild(expandRows(raw, labelledColumn(raw[0])));
    });
    if (next === out) break;
    out = next;
  }
  return out;
};
