/**
 * Service-worker side of the PDF reader.
 *
 * Chrome allows exactly one offscreen document per extension, and two
 * concurrent calls to create it will race with the second throwing. The
 * single-flight promise below is the guard for that, and it is the most
 * common way this API is got wrong.
 *
 * Jobs are serialised for the same reason: one document, one reader.
 */

const PATH = 'src/offscreen/offscreen.html';
const JOB_TIMEOUT_MS = 45_000;

let creating: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const ensureDocument = async (): Promise<void> => {
  if (await chrome.offscreen.hasDocument()) return;

  if (creating === null) {
    creating = chrome.offscreen
      .createDocument({
        url: PATH,
        reasons: [chrome.offscreen.Reason.DOM_PARSER],
        justification: 'Read text out of course syllabus PDFs to find assessment dates.',
      })
      .finally(() => {
        creating = null;
      });
  }

  await creating;
};

export interface PdfResult {
  readonly lines: readonly string[];
  readonly error: string | null;
}

/**
 * Reads a PDF into lines. Never throws: a syllabus that cannot be read is a
 * missing feature for that course, not a reason to fail a sync.
 */
export const extractPdfLines = (url: string): Promise<PdfResult> => {
  const run = async (): Promise<PdfResult> => {
    try {
      await ensureDocument();

      const reply = await withTimeout(
        chrome.runtime.sendMessage({ type: 'offscreen-extract-pdf', url }),
        JOB_TIMEOUT_MS,
      );

      const r = reply as { ok?: boolean; lines?: unknown; error?: unknown };
      if (r?.ok === true && Array.isArray(r.lines)) {
        return { lines: r.lines as readonly string[], error: null };
      }
      return { lines: [], error: typeof r?.error === 'string' ? r.error : 'Could not read the PDF' };
    } catch (cause) {
      return { lines: [], error: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  queue = queue.then(run, run);
  return queue as Promise<PdfResult>;
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error('PDF reading timed out')), ms),
    ),
  ]);

/** Frees the single document once nothing needs it. */
export const closeOffscreen = async (): Promise<void> => {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
};
