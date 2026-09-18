/**
 * Content script for Portal and Quest.
 *
 * Runs on every page of both sites rather than on one known schedule URL,
 * because a student should not have to find the right page for this to work.
 * Whatever page happens to show a timetable is the page it reads.
 *
 * Both apps render client side, so the schedule is not present when the
 * script first runs. It watches for the page to settle and re-reads on
 * change, keeping the best result it has seen. Navigating within either app
 * counts as a change.
 */

import { captureFromDocument } from './capture';
import { readPortalCapture, writePortalCapture } from '@storage/store';

const SETTLE_MS = 900;
const GIVE_UP_MS = 45_000;

let bestThisPage = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

const attempt = async (): Promise<void> => {
  const capture = captureFromDocument(document, Date.now());
  const found = capture.schedule.meetings.length;
  if (found <= bestThisPage && found === 0) return;

  const previous = await readPortalCapture();
  const previousCount = previous?.schedule.meetings.length ?? 0;

  // Only replace a capture with one that saw more. A half-rendered page, or
  // an unrelated page on the same site, must not wipe out a good read from
  // the schedule view.
  if (found > previousCount || (previousCount === 0 && capture.sawText)) {
    bestThisPage = found;
    await writePortalCapture(capture);
  }
};

const schedule = (): void => {
  if (timer !== null) clearTimeout(timer);
  if (Date.now() - startedAt > GIVE_UP_MS) return;
  timer = setTimeout(() => void attempt(), SETTLE_MS);
};

schedule();

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Stop watching once the page has been stable for a while. A permanent
// observer on someone elses app costs battery for nothing.
setTimeout(() => observer.disconnect(), GIVE_UP_MS);
