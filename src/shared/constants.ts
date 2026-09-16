/** Tunable constants, gathered so no magic numbers hide in the logic. */

/** LEARN's origin. Overridden at build time for E2E against a fake server. */
export const LEARN_ORIGIN = __LEARN_ORIGIN__;

/** Valence API versions to fall back on when discovery fails. Field-proven. */
export const FALLBACK_LP_VERSION = '1.44';
export const FALLBACK_LE_VERSION = '1.67';

/** How long a discovered API version stays trusted before re-checking. */
export const API_VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Sync cadence. The floor is not user-lowerable — it protects LEARN. */
export const SYNC_MIN_INTERVAL_MS = 15 * 60 * 1000;
export const SYNC_DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
export const ALARM_NAME = 'uwlt-sync';

/** Rate-limit budgeting. */
export const RATE_LIMIT_RESERVE = 5;
/** If we'd have to wait longer than this, end the run rather than sleep a
 *  service worker that Chrome may evict mid-wait. */
export const RATE_LIMIT_MAX_WAIT_MS = 30_000;
export const RATE_LIMIT_MAX_RETRIES = 1;

/** Backoff applied to the next alarm after the budget is exhausted. */
export const BACKOFF_STEPS_MS = [60 * 60 * 1000, 120 * 60 * 1000] as const;

/** Concurrency: courses run strictly in sequence; only calls within one
 *  course overlap. This is the single most important politeness control. */
export const MAX_CONCURRENT_PER_COURSE = 3;

/** How far ahead the calendar aggregate call looks. */
export const CALENDAR_LOOKAHEAD_DAYS = 120;
export const CALENDAR_LOOKBEHIND_DAYS = 30;

/** "This week" window. */
export const WEEK_WINDOW_DAYS = 7;

/** An item already this far overdue on first sight is backfill, not news. */
export const NEW_ITEM_GRACE_DAYS = 2;

/** Request timeout for a single LEARN call. */
export const REQUEST_TIMEOUT_MS = 20_000;

/** Diagnostics ring buffer size. */
export const DIAGNOSTICS_MAX_ENTRIES = 200;

export const STORAGE_SCHEMA_VERSION = 1;
