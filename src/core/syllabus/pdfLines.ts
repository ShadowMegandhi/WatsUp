/**
 * Rebuilding lines from PDF text runs.
 *
 * pdf.js reports fragments with coordinates, not lines. Fragments sharing a
 * baseline belong together, and in a schedule table that is exactly one row:
 * the date cell and the assessment cell arrive as separate runs at the same
 * height. Grouping by baseline turns them back into one string the extractor
 * can read.
 *
 * A wide horizontal gap between runs is a column break, and is written as
 * " | ", the same cell mark an HTML or Word table gets. That lets the reader
 * tell the cell naming a quiz from a notes column beside it.
 *
 * Kept out of the offscreen document so it can be tested without pdf.js.
 */

export interface PdfTextItem {
  readonly str?: unknown;
  readonly transform?: unknown;
  readonly width?: unknown;
}

/** Runs closer than this many points are one phrase; wider is a new column. */
const COLUMN_GAP_PT = 12;

/** Baselines within this many points are one row. */
const BASELINE_BUCKET_PT = 3;

interface Run {
  readonly x: number;
  readonly end: number | null;
  readonly text: string;
}

const toRun = (raw: unknown): { y: number; run: Run } | null => {
  const item = raw as PdfTextItem;
  const text = typeof item.str === 'string' ? item.str : '';
  if (text.trim() === '') return null;

  const t = item.transform;
  if (!Array.isArray(t) || t.length < 6) return null;

  const x = Number(t[4]);
  const y = Number(t[5]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const width = Number(item.width);
  return { y, run: { x, end: Number.isFinite(width) && width > 0 ? x + width : null, text } };
};

const joinRow = (runs: readonly Run[]): string => {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  let out = '';
  let prevEnd: number | null = null;

  for (const run of sorted) {
    if (out !== '') {
      const isColumnBreak = prevEnd !== null && run.x - prevEnd > COLUMN_GAP_PT;
      out += isColumnBreak ? ' | ' : ' ';
    }
    out += run.text;
    prevEnd = run.end;
  }

  return out.replace(/\s+/g, ' ').trim();
};

export const linesFromItems = (items: readonly unknown[]): readonly string[] => {
  const rows = new Map<number, Run[]>();

  for (const raw of items) {
    const found = toRun(raw);
    if (found === null) continue;
    // Round the baseline so runs a fraction of a point apart still group.
    const key = Math.round(found.y / BASELINE_BUCKET_PT);
    rows.set(key, [...(rows.get(key) ?? []), found.run]);
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, runs]) => joinRow(runs))
    .filter((l) => l.length > 0);
};
