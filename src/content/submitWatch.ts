/**
 * Noticing that the student just handed something in.
 *
 * Two signals, because LEARN uses both kinds of page:
 *   - Loading any assignment or quiz page in a course. That includes the
 *     confirmation LEARN shows after a classic submission.
 *   - Pressing a Submit button on one of those pages. The newer assignment
 *     page uploads in place without loading a new page, so the first signal
 *     never fires there; the click is the only trace.
 *
 * Either one asks the worker to re-check that course's open work. The worker
 * throttles per course, so browsing assignment pages costs very little.
 */

const WORK_PAGE = /\/d2l\/lms\/(dropbox|quizzing)\//i;

/** Delays after a Submit click: one for a quick upload, one for a slow one. */
const AFTER_SUBMIT_MS = [8_000, 40_000] as const;

/** The course a LEARN assignment or quiz page belongs to, or null. */
export const courseOfWorkPage = (href: string): string | null => {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!WORK_PAGE.test(url.pathname)) return null;
  const ou = url.searchParams.get('ou');
  return ou !== null && /^[0-9]+$/.test(ou) ? ou : null;
};

/** True when a click landed on something labelled as a submit button. */
export const isSubmitClick = (path: readonly EventTarget[]): boolean =>
  path.some((t) => {
    const el = t as Partial<HTMLElement> & { value?: unknown };
    const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
    const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
    if (tag !== 'button' && tag !== 'input' && tag !== 'd2l-button' && role !== 'button') return false;

    const aria = typeof el.getAttribute === 'function' ? (el.getAttribute('aria-label') ?? '') : '';
    const value = typeof el.value === 'string' ? el.value : '';
    const label = `${el.textContent ?? ''} ${value} ${aria}`.toLowerCase();
    return /\bsubmit\b/.test(label);
  });

export const watchSubmissions = (send: (courseId: string) => void): void => {
  const courseId = courseOfWorkPage(location.href);
  if (courseId === null) return;

  send(courseId);

  document.addEventListener(
    'click',
    (e) => {
      if (!isSubmitClick(e.composedPath())) return;
      for (const ms of AFTER_SUBMIT_MS) setTimeout(() => send(courseId), ms);
    },
    { capture: true },
  );
};
