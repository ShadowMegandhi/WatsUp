/**
 * Persistence.
 *
 * Keys are flat and sharded per course rather than one big blob, so a course
 * can be committed on its own and a sync never has to read-modify-write
 * everything it knows.
 *
 * The important separation: sync writes items, the user writes overrides, and
 * they live under different keys. That is what lets a re-sync rebuild every
 * item from scratch without losing a single ticked checkbox.
 */

import { STORAGE_SCHEMA_VERSION } from '@shared/constants';
import { emptySyncState } from '@core/types';
import type { Course, CourseHealth, SyncState, TaskItem, TaskOverride } from '@core/types';
import type { Announcement } from '@core/normalize/news';

const K = {
  schemaVersion: 'schemaVersion',
  courses: 'courses',
  items: (courseId: string) => `items:${courseId}`,
  health: (courseId: string) => `health:${courseId}`,
  overrides: 'overrides',
  syncState: 'syncState',
  apiVersions: 'apiVersions',
  panel: 'panelPrefs',
  seen: 'seenItemIds',
} as const;

const area = (): chrome.storage.LocalStorageArea => chrome.storage.local;

const get = async <T>(key: string, fallback: T): Promise<T> => {
  try {
    const bag = await area().get(key);
    const value = bag[key];
    return value === undefined ? fallback : (value as T);
  } catch {
    // A storage read can fail in a torn-down context. Falling back beats
    // throwing into a UI render or a sync loop.
    return fallback;
  }
};

const set = async (entries: Record<string, unknown>): Promise<boolean> => {
  try {
    await area().set(entries);
    return true;
  } catch {
    return false;
  }
};

// --- courses ---------------------------------------------------------------

export const readCourses = (): Promise<readonly Course[]> => get<readonly Course[]>(K.courses, []);

export const writeCourses = (courses: readonly Course[]): Promise<boolean> =>
  set({ [K.courses]: courses, [K.schemaVersion]: STORAGE_SCHEMA_VERSION });

// --- items -----------------------------------------------------------------

export const readItemsFor = (courseId: string): Promise<readonly TaskItem[]> =>
  get<readonly TaskItem[]>(K.items(courseId), []);

export const writeItemsFor = (courseId: string, items: readonly TaskItem[]): Promise<boolean> =>
  set({ [K.items(courseId)]: items });

export const readAllItems = async (): Promise<readonly TaskItem[]> => {
  const courses = await readCourses();
  const perCourse = await Promise.all(courses.map((c) => readItemsFor(c.id)));
  return perCourse.flat();
};

// --- overrides: user-owned, never written by sync --------------------------

export type OverrideMap = Readonly<Record<string, TaskOverride>>;

export const readOverrides = (): Promise<OverrideMap> => get<OverrideMap>(K.overrides, {});

export const setOverride = async (
  taskId: string,
  patch: Omit<TaskOverride, 'updatedAt'>,
  now: number,
): Promise<boolean> => {
  const current = await readOverrides();
  const existing = current[taskId];
  const next: TaskOverride = { ...existing, ...patch, updatedAt: now };
  return set({ [K.overrides]: { ...current, [taskId]: next } });
};

export const clearOverride = async (taskId: string): Promise<boolean> => {
  const current = await readOverrides();
  if (current[taskId] === undefined) return true;
  const next = { ...current };
  delete next[taskId];
  return set({ [K.overrides]: next });
};

/** Flips completion, treating an absent override as "follow LEARN". */
export const toggleCompletion = async (
  taskId: string,
  currentlyComplete: boolean,
  now: number,
): Promise<boolean> => setOverride(taskId, { completion: currentlyComplete ? 'not-done' : 'done' }, now);

// --- sync state and health -------------------------------------------------

export const readSyncState = (): Promise<SyncState> => get<SyncState>(K.syncState, emptySyncState);

export const writeSyncState = (state: SyncState): Promise<boolean> => set({ [K.syncState]: state });

export const patchSyncState = async (patch: Partial<SyncState>): Promise<SyncState> => {
  const next = { ...(await readSyncState()), ...patch };
  await writeSyncState(next);
  return next;
};

export const readHealth = (courseId: string): Promise<CourseHealth | null> =>
  get<CourseHealth | null>(K.health(courseId), null);

export const writeHealth = (health: CourseHealth): Promise<boolean> =>
  set({ [K.health(health.courseId)]: health });

export const readAllHealth = async (): Promise<readonly CourseHealth[]> => {
  const courses = await readCourses();
  const all = await Promise.all(courses.map((c) => readHealth(c.id)));
  return all.filter((h): h is CourseHealth => h !== null);
};

// --- api versions ----------------------------------------------------------

export interface StoredVersions {
  readonly lp: string;
  readonly le: string;
  readonly fetchedAt: number;
}

export const readApiVersions = (): Promise<StoredVersions | null> =>
  get<StoredVersions | null>(K.apiVersions, null);

export const writeApiVersions = (v: StoredVersions): Promise<boolean> => set({ [K.apiVersions]: v });

// --- panel preferences -----------------------------------------------------

export interface PanelPrefs {
  readonly minimized: boolean;
  readonly hidden: boolean;
  readonly x: number | null;
  readonly y: number | null;
  readonly showCompleted: boolean;
  readonly showOtherEnrolments: boolean;
}

export const defaultPanelPrefs: PanelPrefs = {
  minimized: false,
  hidden: false,
  x: null,
  y: null,
  showCompleted: false,
  showOtherEnrolments: false,
};

export const readPanelPrefs = (): Promise<PanelPrefs> => get<PanelPrefs>(K.panel, defaultPanelPrefs);

export const writePanelPrefs = async (patch: Partial<PanelPrefs>): Promise<PanelPrefs> => {
  const next = { ...(await readPanelPrefs()), ...patch };
  await set({ [K.panel]: next });
  return next;
};

// --- new-item tracking -----------------------------------------------------

/**
 * Ids seen on a previous successful sync. Anything outside this set is new,
 * which is what drives the "new since you last looked" marker. Kept separate
 * from items so a failed sync cannot corrupt the baseline.
 */
export const readSeenIds = (): Promise<readonly string[]> => get<readonly string[]>(K.seen, []);

export const writeSeenIds = (ids: readonly string[]): Promise<boolean> => set({ [K.seen]: ids });

export const STORAGE_KEYS = K;

// --- syllabus cache --------------------------------------------------------

/**
 * What the syllabus pass last produced for a course.
 *
 * Reading a syllabus means downloading a PDF and running pdf.js over it. Doing
 * that every half hour for a document that changes about twice a term is waste
 * that a student pays for in battery and that LEARN pays for in requests.
 *
 * `parserVersion` is what makes a shipped heuristics fix actually take effect
 * on an install that already has a cached result. Forgetting it is why such a
 * fix can appear to do nothing.
 */
export interface SyllabusCache {
  readonly courseId: string;
  readonly parsedAt: number;
  readonly parserVersion: number;
  readonly items: readonly TaskItem[];
  readonly note: string | null;
  readonly docsFound: number;
  readonly docsRead: number;
}

export const readSyllabusCache = (courseId: string): Promise<SyllabusCache | null> =>
  get<SyllabusCache | null>(`syllabus:${courseId}`, null);

export const writeSyllabusCache = (cache: SyllabusCache): Promise<boolean> =>
  set({ [`syllabus:${cache.courseId}`]: cache });

/** A syllabus is re-read once a day, or whenever the rules for reading it change. */
export const syllabusCacheIsFresh = (
  cache: SyllabusCache | null,
  now: number,
  parserVersion: number,
  ttlMs: number,
): boolean =>
  cache !== null && cache.parserVersion === parserVersion && now - cache.parsedAt < ttlMs;

// --- portal schedule -------------------------------------------------------

/**
 * The last schedule read from Portal.
 *
 * Stored whole, including the text sample, because when the parse finds
 * nothing the sample is the difference between fixing the parser and guessing.
 */
export interface StoredPortalCapture {
  readonly schedule: {
    readonly capturedAt: number;
    readonly termLabel: string | null;
    readonly termStartsOn: number | null;
    readonly meetings: readonly unknown[];
  };
  readonly events?: readonly unknown[];
  readonly sawText: boolean;
  readonly sample: string;
  readonly url: string;
}

export const writePortalCapture = (capture: StoredPortalCapture): Promise<boolean> =>
  set({ portalCapture: capture });

export const readPortalCapture = (): Promise<StoredPortalCapture | null> =>
  get<StoredPortalCapture | null>('portalCapture', null);

// --- reset ----------------------------------------------------------------

/**
 * Clears everything derived, keeping everything the user owns.
 *
 * Items, health and caches can all be rebuilt from LEARN, so throwing them
 * away costs a sync. Overrides and panel preferences cannot be rebuilt from
 * anywhere, so they survive: a reset must never silently discard which things
 * someone has ticked off.
 */
export const clearDerived = async (): Promise<void> => {
  const all = await area().get(null);
  const keep = new Set<string>([K.overrides, K.panel, K.schemaVersion]);

  const doomed = Object.keys(all).filter((key) => !keep.has(key));
  if (doomed.length > 0) await area().remove(doomed);
};

// --- announcements ---------------------------------------------------------

/**
 * Announcements are stored per course, like items, so one course failing to
 * load leaves the rest intact.
 */
export const readNewsFor = (courseId: string): Promise<readonly Announcement[]> =>
  get<readonly Announcement[]>(`news:${courseId}`, []);

export const writeNewsFor = (
  courseId: string,
  news: readonly Announcement[],
): Promise<boolean> => set({ [`news:${courseId}`]: news });

export const readAllNews = async (): Promise<readonly Announcement[]> => {
  const courses = await readCourses();
  const perCourse = await Promise.all(courses.map((c) => readNewsFor(c.id)));
  return perCourse.flat().sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
};

/** Ids already seen, so genuinely new posts can be marked. */
export const readSeenNewsIds = (): Promise<readonly string[]> =>
  get<readonly string[]>('seenNewsIds', []);

export const writeSeenNewsIds = (ids: readonly string[]): Promise<boolean> =>
  set({ seenNewsIds: ids });
