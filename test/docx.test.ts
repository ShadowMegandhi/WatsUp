import { describe, it, expect } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { docxToLines, documentXmlToLines, looksLikeZip, readZipEntry } from '@core/syllabus/docx';
import { extractAssessments } from '@core/syllabus/extract';
import { termFrom } from '@core/syllabus/dates';

const FALL = termFrom(new Date(2026, 8, 8).getTime(), Date.now());

/** A minimal zip with deflated entries, laid out the way Word writes one. */
const zip = (entries: Readonly<Record<string, string>>): Uint8Array => {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, text] of Object.entries(entries)) {
    const nameBuf = Buffer.from(name);
    const raw = Buffer.from(text);
    const data = deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += 30 + nameBuf.length + data.length;
  }

  const dir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(entries).length, 8);
  eocd.writeUInt16LE(Object.keys(entries).length, 10);
  eocd.writeUInt32LE(dir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return new Uint8Array(Buffer.concat([...locals, dir, eocd]));
};

const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const row = (...cells: string[]): string =>
  `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`;

const BODY = `<?xml version="1.0"?><w:document><w:body>${p('ENGR 101 Course Outline')}<w:tbl>${row(
  'Week 7',
  'Oct 19',
  'Quiz 2',
)}${row('Week 8', 'Oct 26', 'Lecture: design &amp; ethics')}</w:tbl></w:body></w:document>`;

/** A row's cells, however the separators between them are written. */
const cells = (lines: readonly string[]): readonly string[] =>
  lines.map((l) => l.split('|').map((c) => c.trim()).filter((c) => c !== '').join(' | '));

describe('documentXmlToLines', () => {
  it('keeps a table row on one line with its cells in order', () => {
    expect(cells(documentXmlToLines(BODY))).toContain('Week 7 | Oct 19 | Quiz 2');
  });

  it('decodes entities', () => {
    expect(cells(documentXmlToLines(BODY))).toContain('Week 8 | Oct 26 | Lecture: design & ethics');
  });

  it('writes a merged week cell into every row it covers', () => {
    const merged = (text: string, restart: boolean): string =>
      `<w:tc><w:tcPr><w:vMerge${restart ? ' w:val="restart"' : ''}/></w:tcPr>${p(restart ? text : '')}</w:tc>`;
    const xml =
      '<w:document><w:body><w:tbl>' +
      `<w:tr>${merged('Oct 19 - 23', true)}<w:tc>${p('Quiz 2')}</w:tc></w:tr>` +
      `<w:tr>${merged('', false)}<w:tc>${p('Lab 3')}</w:tc></w:tr>` +
      '</w:tbl>' +
      p('Quizzes are written on Mondays at 5:30 pm') +
      p('Labs are due on Fridays at 11:59 pm') +
      '</w:body></w:document>';
    expect(cells(documentXmlToLines(xml))).toContain('Oct 19 - 23 | Lab 3');
    const term = termFrom(new Date(2026, 8, 8).getTime(), Date.now());
    const found = extractAssessments(documentXmlToLines(xml), term);
    expect(found.map((c) => `${c.title} ${new Date(c.dueAt).getDate()}`)).toEqual(['Quiz 2 19', 'Lab 3 23']);
  });

  it('puts ordinary paragraphs on their own lines', () => {
    expect(documentXmlToLines(BODY)[0]).toBe('ENGR 101 Course Outline');
  });
});

describe('docxToLines', () => {
  const file = zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': BODY });

  it('recognises a .docx by its leading bytes', () => {
    expect(looksLikeZip(file)).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode('%PDF-1.7'))).toBe(false);
  });

  it('reads the body out of the archive and finds the dated quiz', async () => {
    const { lines, error } = await docxToLines(file);
    expect(error).toBeNull();
    const found = extractAssessments(lines, FALL);
    expect(found.map((c) => c.title)).toEqual(['Quiz 2']);
    expect(found[0]?.date).toEqual({ y: 2026, m: 10, d: 19 });
  });

  it('returns null for an entry that is not there', async () => {
    expect(await readZipEntry(file, 'word/missing.xml')).toBeNull();
  });

  it('reports, rather than throws, on something that is not a zip', async () => {
    const r = await docxToLines(new TextEncoder().encode('not a word file at all'));
    expect(r.lines).toEqual([]);
    expect(r.error).not.toBeNull();
  });
});
