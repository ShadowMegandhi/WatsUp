/**
 * Service worker entry point. Wiring only.
 *
 * Every listener is registered synchronously at the top level, because Chrome
 * dispatches events to a freshly revived worker and a listener registered
 * inside an async callback would not exist yet when that happens.
 */

import type { Command, CommandReply } from '@shared/messages';
import { registerRelayPort, hasRelay, relayFetcher } from '@platform/relayHost';
import { workerFetcher } from '@sync/fetchProxy';
import { runProbe } from '@sync/probe';
import { runSync } from '@sync/orchestrator';
import { resolve } from '@core/status';
import { attentionCount } from '@core/selectors';
import {
  ALARM_NAME,
  LEARN_ORIGIN,
  SYNC_DEFAULT_INTERVAL_MS,
  SYNC_MIN_INTERVAL_MS,
} from '@shared/constants';
import {
  readAllItems,
  readCourses,
  readOverrides,
  readSyncState,
  clearDerived,
  writeProbeReportCompat,
} from '@storage/storeCompat';

chrome.runtime.onConnect.addListener((port) => {
  registerRelayPort(port);
});

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  void handleCommand(raw as Command)
    .then(sendResponse)
    .catch((cause: unknown) => {
      sendResponse({
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies CommandReply);
    });

  return true; // keeps the channel open for the async reply
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void sync(false);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#b42318' });
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_DEFAULT_INTERVAL_MS / 60_000 });
});

chrome.runtime.onStartup.addListener(() => {
  void refreshBadge();
});

/** Guards against several LEARN tabs all asking for a sync at once. */
let inFlight: Promise<void> | null = null;

const sync = async (force: boolean): Promise<void> => {
  if (inFlight !== null) return inFlight;

  inFlight = (async () => {
    try {
      const state = await readSyncState();
      const since = state.lastSuccessAt === null ? Infinity : Date.now() - state.lastSuccessAt;
      if (!force && since < SYNC_MIN_INTERVAL_MS) return;

      // The relay is the reliable path. The direct worker fetch is a fallback
      // for when no LEARN tab is open, and is expected to be less dependable.
      const fetcher = hasRelay() ? relayFetcher() : workerFetcher();
      await runSync(fetcher, Date.now());
      await refreshBadge();
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
};

const refreshBadge = async (): Promise<void> => {
  const [items, courses, overrides] = await Promise.all([
    readAllItems(),
    readCourses(),
    readOverrides(),
  ]);

  const byId = new Map(courses.map((c) => [c.id, c]));
  const now = Date.now();
  const resolved = items
    .filter((i) => byId.get(i.courseId)?.looksAcademic ?? true)
    .map((i) => resolve(i, overrides[i.id] ?? null, byId.get(i.courseId) ?? null, now));

  const n = attentionCount(resolved, now);
  await chrome.action.setBadgeText({ text: n === 0 ? '' : String(n) });
};

const handleCommand = async (command: Command): Promise<CommandReply> => {
  switch (command.type) {
    case 'reset-and-sync':
      await clearDerived();
      await sync(true);
      return { type: 'status', status: await status() };

    case 'sync-now':
      await sync(true);
      return { type: 'status', status: await status() };

    case 'sync-if-stale':
      void sync(false);
      return { type: 'status', status: await status() };

    case 'get-status':
      return { type: 'status', status: await status() };

    case 'probe': {
      const fetcher = hasRelay() ? relayFetcher() : workerFetcher();
      const report = await runProbe(fetcher, Date.now());
      await writeProbeReportCompat(report);
      return { type: 'probe-result', report };
    }

    case 'get-probe-result':
      return { type: 'probe-result', report: null };
  }
};

const status = async () => {
  const [state, tabs] = await Promise.all([
    readSyncState(),
    chrome.tabs.query({ url: `${LEARN_ORIGIN}/*` }),
  ]);
  return {
    learnTabOpen: tabs.length > 0,
    relayConnected: hasRelay(),
    lastProbeAt: state.lastSuccessAt,
  };
};
