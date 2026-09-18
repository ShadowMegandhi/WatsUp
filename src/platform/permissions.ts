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
