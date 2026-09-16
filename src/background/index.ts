/**
 * Service worker entry point. Wiring only, no logic.
 *
 * Every listener is registered synchronously at the top level. Chrome dispatches
 * events to a freshly-revived worker, and a listener registered inside an async
 * callback would not exist yet when that happens.
 */

import type { Command, CommandReply } from '@shared/messages';
import { registerRelayPort, hasRelay, relayFetcher } from '@platform/relayHost';
import { workerFetcher } from '@sync/fetchProxy';
import { runProbe } from '@sync/probe';
import { LEARN_ORIGIN } from '@shared/constants';
import { readProbeReport, writeProbeReport } from '@storage/probeRepo';

chrome.runtime.onConnect.addListener((port) => {
  registerRelayPort(port);
});

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const command = raw as Command;

  void handleCommand(command)
    .then(sendResponse)
    .catch((cause: unknown) => {
      sendResponse({
        type: 'error',
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies CommandReply);
    });

  // Keeps the message channel open for the async reply above.
  return true;
});

const handleCommand = async (command: Command): Promise<CommandReply> => {
  switch (command.type) {
    case 'probe': {
      // Prefer the relay: it runs in a real first-party context and is immune
      // to third-party-cookie blocking. Fall back to the worker so the probe
      // can also tell us whether Tier B works at all.
      const fetcher = hasRelay() ? relayFetcher() : workerFetcher();
      const report = await runProbe(fetcher, Date.now());
      await writeProbeReport(report);
      return { type: 'probe-result', report };
    }

    case 'get-probe-result':
      return { type: 'probe-result', report: await readProbeReport() };

    case 'get-status':
      return {
        type: 'status',
        status: {
          learnTabOpen: await anyLearnTabOpen(),
          relayConnected: hasRelay(),
          lastProbeAt: (await readProbeReport())?.finishedAt ?? null,
        },
      };

    case 'sync-now':
      // Phase 3 replaces this. Until then the probe is the only thing to run.
      return { type: 'error', message: 'Sync is not implemented yet (Phase 3).' };
  }
};

const anyLearnTabOpen = async (): Promise<boolean> => {
  const tabs = await chrome.tabs.query({ url: `${LEARN_ORIGIN}/*` });
  return tabs.length > 0;
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#6b7280' });
});
