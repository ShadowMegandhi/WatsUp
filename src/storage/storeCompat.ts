/**
 * Re-exports the storage functions the service worker needs, plus the probe
 * report writer that outlived Phase 1.
 *
 * Keeping the probe writer out of store.ts draws a clear line: store.ts is the
 * product data model, and the probe is a diagnostic that will be removed once
 * the endpoint surface stops surprising us.
 */

export {
  readAllItems,
  readCourses,
  readOverrides,
  readSyncState,
} from './store';

export { writeProbeReport as writeProbeReportCompat } from './probeRepo';
