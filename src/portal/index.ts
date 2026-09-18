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
import { showToast } from './toast';

const SETTLE_MS = 900;
const GIVE_UP_MS = 45_000;

let bestThisPage = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const startedAt = Date.now();

const attempt = async (): Promise<void> => {
  const capture = captureFromDocument(document, Date.now());
  // Dated sessions are worth more than a weekly pattern, so they dominate
  // the comparison that decides whether this read replaces the stored one.
  const found = capture.events.length * 10 + capture.schedule.meetings.length;
  // Never skip the first read of a page. A page where the script ran and
  // found nothing is the case most worth reporting, and returning early
  // here made it indistinguishable from the script never running.
  if (announced && found <= bestThisPage && found === 0) return;

  const previous = await readPortalCapture();
  const previousCount =
    (previous?.events?.length ?? 0) * 10 + (previous?.schedule.meetings.length ?? 0);

  // Only replace a capture with one that saw more. A half-rendered page, or
  // an unrelated page on the same site, must not wipe out a good read from
  // the schedule view.
  if (found > previousCount || (previousCount === 0 && capture.sawText)) {
    bestThisPage = found;
    const saved = await writePortalCapture(capture);
    announce(capture.events.length, saved);
    return;
  }

  // Read fine, but an earlier page knew more. Still worth saying so, otherwise
  // this page looks identical to one where nothing ran.
  announce(capture.events.length, true);
};

let announced = false;

/**
 * Says what happened, once per page.
 *
 * Distinguishing "found nothing" from "never ran" is the whole point: those
 * look identical from a later diagnostic and need completely different fixes.
 */
const announce = (sessions: number, saved: boolean): void => {
  if (announced) return;
  announced = true;

  if (!saved) {
    showToast('LEARN Tracker could not save the schedule it just read.', 'warn');
    return;
  }

  if (sessions > 0) {
    showToast(`LEARN Tracker read ${sessions} class sessions from this page.`, 'ok');
    return;
  }

  showToast(
    'LEARN Tracker is running here but found no class schedule on this page. Open your class schedule view.',
    'warn',
  );
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
