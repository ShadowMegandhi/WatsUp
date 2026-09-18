/**
 * Checking and asking for host access at runtime.
 *
 * A host permission added to an already-installed extension is not granted by
 * reloading it. Chrome withholds it until someone approves, and a withheld
 * host fails in two silent ways at once: a service-worker fetch throws
 * "Failed to fetch", and a declared content script never injects. Both look
 * exactly like the site being broken.
 *
 * Asking from a button click is the only reliable way to get them, because
 * Chrome requires a user gesture, and it also puts the prompt next to the
 * explanation of why it is needed.
 */

export const SCHEDULE_ORIGINS = [
  'https://quest.pecs.uwaterloo.ca/*',
  'https://portal.uwaterloo.ca/*',
] as const;

export const OUTLINE_ORIGINS = ['https://outline.uwaterloo.ca/*'] as const;

export const hasOrigins = async (origins: readonly string[]): Promise<boolean> => {
  try {
    return await chrome.permissions.contains({ origins: [...origins] });
  } catch {
    return false;
  }
};

export const requestOrigins = async (origins: readonly string[]): Promise<boolean> => {
  try {
    return await chrome.permissions.request({ origins: [...origins] });
  } catch {
    return false;
  }
};

/** Everything currently granted, for diagnostics. */
export const grantedOrigins = async (): Promise<readonly string[]> => {
  try {
    const all = await chrome.permissions.getAll();
    return all.origins ?? [];
  } catch {
    return [];
  }
};

const SCHEDULE_SCRIPT_ID = 'uwlt-schedule';

/**
 * Registers the schedule reader once its hosts are granted.
 *
 * A content script declared in the manifest for a withheld host does not
 * start working when that host is later granted, so it has to be registered
 * dynamically at the moment permission arrives.
 */
export const registerScheduleScript = async (): Promise<boolean> => {
  if (!(await hasOrigins(SCHEDULE_ORIGINS))) return false;

  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [SCHEDULE_SCRIPT_ID],
    });
    if (existing.length > 0) return true;

    await chrome.scripting.registerContentScripts([
      {
        id: SCHEDULE_SCRIPT_ID,
        js: ['portal.js'],
        matches: [...SCHEDULE_ORIGINS],
        runAt: 'document_idle',
        allFrames: true,
        persistAcrossSessions: true,
      },
    ]);
    return true;
  } catch {
    // Already registered by a previous run, or the API refused. Either way the
    // declared script may still cover it, so this is not worth failing over.
    return true;
  }
};

export interface HostStatus {
  readonly origin: string;
  readonly label: string;
  readonly granted: boolean;
  readonly required: boolean;
}

const CATALOGUE: readonly { origin: string; label: string; required: boolean }[] = [
  { origin: 'https://learn.uwaterloo.ca/*', label: 'LEARN', required: true },
  { origin: 'https://quest.pecs.uwaterloo.ca/*', label: 'Quest', required: false },
  { origin: 'https://portal.uwaterloo.ca/*', label: 'Portal', required: false },
  { origin: 'https://outline.uwaterloo.ca/*', label: 'Course outlines', required: false },
];

/**
 * The status of every host, checked one at a time.
 *
 * Asking about several at once answers only whether all of them are held,
 * which cannot say which one is missing, and a single missing host is exactly
 * the situation worth reporting.
 */
export const hostStatuses = async (): Promise<readonly HostStatus[]> =>
  Promise.all(
    CATALOGUE.map(async (h) => ({
      origin: h.origin,
      label: h.label,
      required: h.required,
      granted: await hasOrigins([h.origin]),
    })),
  );

export const OPTIONAL_ORIGINS = CATALOGUE.filter((h) => !h.required).map((h) => h.origin);

/**
 * Asks for everything still missing, in one prompt.
 *
 * Chrome allows one request per gesture, so asking per host would need a
 * separate click each and most people would stop after the first.
 */
export const requestMissing = async (): Promise<boolean> => {
  const statuses = await hostStatuses();
  const missing = statuses.filter((h) => !h.granted && !h.required).map((h) => h.origin);
  if (missing.length === 0) return true;

  const granted = await requestOrigins(missing);
  if (granted) await registerScheduleScript();
  return granted;
};
