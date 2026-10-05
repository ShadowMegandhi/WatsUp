/**
 * Reading a Word (.docx) outline into lines.
 *
 * A .docx is a zip archive whose body text lives in word/document.xml. The
 * archive is read by hand, with the platform's DecompressionStream, rather
 * than through a zip library: one entry is needed, and every dependency
 * added to the extension is code that ships to every student.
 *
 * Table rows come out as one line with cells joined by " | ", the same shape
 * toLines gives an HTML table, so a date cell and an assessment cell stay
 * together for the reader. Old binary .doc files are not zips and are not
 * handled here.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const STORED = 0;
const DEFLATE = 8;
const BODY = 'word/document.xml';
/** The end record sits in the last 22 bytes plus an optional comment. */
const EOCD_SEARCH = 22 + 0xffff;

/** True when the bytes start like a zip archive ("PK\x03\x04"). */
export const looksLikeZip = (bytes: Uint8Array): boolean =>
  bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;

/**
 * Lines of text from a .docx, or an error saying why there are none.
 * Never throws: an unreadable outline is a note, not a failed sync.
 */
export const docxToLines = async (
  bytes: Uint8Array,
): Promise<{ readonly lines: readonly string[]; readonly error: string | null }> => {
  try {
    const xml = await readZipEntry(bytes, BODY);
    if (xml === null) return { lines: [], error: 'Word document had no body text' };
    const lines = documentXmlToLines(new TextDecoder().decode(xml));
    return lines.length === 0
      ? { lines: [], error: 'Word document had no readable text' }
      : { lines, error: null };
  } catch (cause) {
    return { lines: [], error: cause instanceof Error ? cause.message : String(cause) };
  }
};

/** One entry's bytes from a zip archive, or null when it is not there. */
export const readZipEntry = async (bytes: Uint8Array, name: string): Promise<Uint8Array | null> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - EOCD_SEARCH); i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a readable Word document');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(at, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const entryName = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

    if (entryName === name) {
      if (view.getUint32(localOffset, true) !== LOCAL_SIG) throw new Error('Damaged Word document');
      const start =
        localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
      const data = bytes.subarray(start, start + compressedSize);
      if (method === STORED) return data;
      if (method === DEFLATE) return await inflateRaw(data);
      throw new Error('Word document uses an unsupported compression');
    }

    at += 46 + nameLen + extraLen + commentLen;
  }

  return null;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  // Copied into a plain ArrayBuffer, which is what Blob's types accept.
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * WordprocessingML to lines. Each table row becomes one line; every other
 * paragraph is its own line.
 */
export const documentXmlToLines = (xml: string): readonly string[] =>
  xml
    .replace(TABLE_ROW, (row) => rowToLine(row) + '\n')
    .replace(PARA_END, '\n')
    .replace(TAB_OR_BREAK, ' ')
    .replace(ANY_TAG, '')
    .split('\n')
    .map((l) => decodeEntities(l).replace(WHITESPACE, ' ').trim())
    .filter((l) => l.length > 0);

const rowToLine = (row: string): string =>
  row
    .split(CELL_END)
    .map((cell) => cell.replace(PARA_END, ' ').replace(TAB_OR_BREAK, ' ').replace(ANY_TAG, '').trim())
    .filter((cell) => cell !== '')
    .join(' | ');

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');

const TABLE_ROW = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
const CELL_END = /<\/w:tc>/;
const PARA_END = /<\/w:p>/g;
const TAB_OR_BREAK = /<w:(?:tab|br|cr)\b[^>]*\/>/g;
const ANY_TAG = /<[^>]+>/g;
const WHITESPACE = /\s+/g;
