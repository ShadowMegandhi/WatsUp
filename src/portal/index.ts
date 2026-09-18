/**
 * Content script for Portal.
 *
 * Portal is a client-rendered app, so the schedule is not present when the
 * script first runs. Rather than poll blindly, it watches for the page to
 * settle and re-reads whenever the content changes, capturing the best result
 * it has seen. Navigating within the app counts as a change.
 */

import { captureFromDocument } from './capture';
import { writePortalCapture } from '@storage/store';

const SETTLE_MS = 900;
const GIVE_UP_MS = 30_000;

let best = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

const attempt = (): void => {
  const capture = captureFromDocument(document, Date.now());
  const found = capture.schedule.meetings.length;

  // Keep whichever read saw the most, since a partially rendered page can
  // legitimately show fewer rows than the finished one.
  if (found > best || (best === 0 && capture.sawText)) {
    best = found;
    void writePortalCapture(capture);
  }
};

const schedule = (): void => {
  if (timer !== null) clearTimeout(timer);
  if (Date.now() - startedAt > GIVE_UP_MS) return;
  timer = setTimeout(attempt, SETTLE_MS);
};

schedule();

const observer = new MutationObserver(schedule);
observer.observe(document.documentElement, { childList: true, subtree: true });

// Stop watching once the page has been stable for a while. A permanent
// observer on someone elses app is rude and costs battery for nothing.
setTimeout(() => observer.disconnect(), GIVE_UP_MS);
