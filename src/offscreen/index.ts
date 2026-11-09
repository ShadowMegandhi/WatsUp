/**
 * Offscreen document.
 *
 * Exists for one reason: pdf.js cannot run in an MV3 service worker. A worker
 * has no DOM and no canvas, and Chrome blocks the dynamic import pdf.js uses
 * to load its own worker. An offscreen document is a real page, so it can.
 *
 * It fetches the PDF itself rather than being handed bytes. Passing a 20MB
 * ArrayBuffer through sendMessage means structured-cloning it twice, and this
 * document already carries the extension host permissions and the session
 * cookie, so it can just ask LEARN directly.
 */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { docxToLines, looksLikeZip } from '@core/syllabus/docx';
import { linesFromItems } from '@core/syllabus/pdfLines';

// Must be a file inside the extension. A CDN URL is blocked by the extension
// CSP and is a hard Chrome Web Store rejection.
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(workerUrl);

const MAX_PAGES = 40;
const MAX_BYTES = 15 * 1024 * 1024;

interface ExtractRequest {
  readonly type: 'offscreen-extract-pdf';
  readonly url: string;
}

interface ExtractReply {
  readonly ok: boolean;
  readonly lines: readonly string[];
  readonly error: string | null;
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as ExtractRequest;
  if (msg.type !== 'offscreen-extract-pdf') return undefined;

  void extract(msg.url)
    .then(sendResponse)
    .catch((cause: unknown) => {
      sendResponse({
        ok: false,
        lines: [],
        error: cause instanceof Error ? cause.message : String(cause),
      } satisfies ExtractReply);
    });

  return true;
});

const extract = async (url: string): Promise<ExtractReply> => {
  const response = await fetch(url, { credentials: 'include', redirect: 'follow' });
  if (!response.ok) return { ok: false, lines: [], error: `HTTP ${response.status}` };

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return { ok: false, lines: [], error: 'Document too large to read' };
  }

  // Word outlines arrive through the same door. A .docx is a zip, and
  // its leading bytes say so whatever the URL looks like.
  const head = new Uint8Array(bytes);
  if (looksLikeZip(head)) {
    const docx = await docxToLines(head);
    return { ok: docx.error === null, lines: docx.lines, error: docx.error };
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
  }).promise;

  try {
    const lines: string[] = [];
    const pageCount = Math.min(doc.numPages, MAX_PAGES);

    for (let n = 1; n <= pageCount; n += 1) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      lines.push(...linesFromItems(content.items));
      page.cleanup();
    }

    // A PDF with no text layer is a scan. Saying so beats returning nothing
    // and letting it look like the outline simply had no assessments.
    if (lines.join('').trim().length < 50) {
      return { ok: false, lines: [], error: 'No text in this PDF, it looks like a scan' };
    }

    return { ok: true, lines, error: null };
  } finally {
    await doc.destroy();
  }
};
