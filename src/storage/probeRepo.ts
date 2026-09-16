/**
 * Persistence for the probe report.
 *
 * It lives in storage rather than a worker variable because the popup is
 * usually opened after the worker that produced the report has been evicted.
 */

import type { ProbeReport } from '@shared/messages';

const KEY = 'probeReport';

export const writeProbeReport = async (report: ProbeReport): Promise<void> => {
  await chrome.storage.local.set({ [KEY]: report });
};

export const readProbeReport = async (): Promise<ProbeReport | null> => {
  const bag = await chrome.storage.local.get(KEY);
  const value = bag[KEY];
  return isProbeReport(value) ? value : null;
};

const isProbeReport = (value: unknown): value is ProbeReport =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray((value as ProbeReport).steps);
