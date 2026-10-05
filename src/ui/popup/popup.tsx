/**
 * Toolbar popup: status, and how to finish setting the extension up.
 *
 * The panel on the LEARN page is where the work happens. This is where someone
 * finds out what is connected, what is not, and what to click about it.
 */

import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { resolve } from '@core/status';
import { counts } from '@core/selectors';
import type { SectionCounts } from '@core/selectors';
import type { CourseHealth, SyncState } from '@core/types';
import {
  readAllHealth,
  readAllItems,
  readCourses,
  readOverrides,
  readPanelPrefs,
  readSyncState,
  writePanelPrefs,
  type PanelPrefs,
} from '@storage/store';
import { LEARN_ORIGIN } from '@shared/constants';
import { formatSyncedAt } from '../../content/panel/format';
import {
  OUTLINE_ORIGINS,
  hasOrigins,
  hostStatuses,
  requestAllOptional,
  requestOrigins,
  type HostStatus,
} from '@platform/permissions';

const OUTLINE = 'https://outline.uwaterloo.ca/';

const App = () => {
  const [tally, setTally] = useState<SectionCounts | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [health, setHealth] = useState<readonly CourseHealth[]>([]);
  const [busy, setBusy] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [allowedOutline, setAllowedOutline] = useState(true);
  const [hosts, setHosts] = useState<readonly HostStatus[]>([]);
  const [denied, setDenied] = useState(false);

  const load = useCallback(async () => {
    const [items, courses, overrides, s, p, h] = await Promise.all([
      readAllItems(),
      readCourses(),
      readOverrides(),
      readSyncState(),
      readPanelPrefs(),
      readAllHealth(),
    ]);

    const byId = new Map(courses.map((c) => [c.id, c]));
    const now = Date.now();
    const withWork = new Set(items.map((i) => i.courseId));

    const resolved = items
      .filter((i) => byId.get(i.courseId)?.looksAcademic || withWork.has(i.courseId))
      .map((i) => resolve(i, overrides[i.id] ?? null, byId.get(i.courseId) ?? null, now));

    setTally(counts(resolved, now));
    setState(s);
    setPrefs(p);
    setHealth(h);

    // A withheld host fails silently in two ways at once, so it is checked
    // rather than assumed.
    setAllowedOutline(await hasOrigins(OUTLINE_ORIGINS));
    setHosts(await hostStatuses());
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [load]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'sync-now' });
    } catch {
      // Worker evicted mid-message; the storage listener still updates us.
    } finally {
      setBusy(false);
      void load();
    }
  }, [load]);

  const open = useCallback((url: string) => {
    void chrome.tabs.create({ url });
  }, []);

  // One prompt for everything missing. Chrome allows one request per
  // gesture, so asking per host would need a separate click each.
  const grantAll = useCallback(() => {
    // Not async, and nothing is awaited before the request. The gesture window
    // closes at the first await, and Chrome then declines to prompt at all,
    // silently, which is what made this button appear to do nothing.
    requestAllOptional()
      .then(async (ok) => {
        setDenied(!ok);
        setHosts(await hostStatuses());
        setAllowedOutline(await hasOrigins(OUTLINE_ORIGINS));
      })
      .catch(() => setDenied(true));
  }, []);

  const connectOutline = useCallback(() => {
    requestOrigins(OUTLINE_ORIGINS)
      .then((granted) => {
        if (!granted) {
          setDenied(true);
          return;
        }
        setAllowedOutline(true);
        void chrome.tabs.create({ url: OUTLINE });
      })
      .catch(() => setDenied(true));
  }, []);

  const showPanel = useCallback(async () => {
    setPrefs(await writePanelPrefs({ hidden: false, minimized: false }));
  }, []);

  const needsSignIn = state?.authState === 'needs-signin';
  const outlineTrouble = health.some((h) => (h.syllabusNote ?? '').includes('linked outline'));

  return (
    <>
      <header>
        <h1>LEARN Tracker</h1>
        <span class="phase">{formatSyncedAt(state?.lastSuccessAt ?? null, Date.now())}</span>
      </header>

      <main>
        {hosts.some((h) => !h.granted) && (
          <Access hosts={hosts} denied={denied} onGrant={grantAll} />
        )}

        {tally !== null && (
          <div class="tally">
            <Stat n={tally.overdue} label="Overdue" tone="bad" />
            <Stat n={tally.dueSoon} label="This week" tone="warn" />
            <Stat n={tally.upcoming} label="Later" tone="" />
            <Stat n={tally.completed} label="Done" tone="ok" />
          </div>
        )}

        <Step
          done={!outlineTrouble && allowedOutline}
          title={outlineTrouble ? 'Sign in to course outlines' : 'Course outlines readable'}
          detail={
            outlineTrouble
              ? 'Some courses keep their outline outside LEARN and the sign-in has lapsed.'
              : 'Outlines are being read wherever courses publish them.'
          }
          action={
            !allowedOutline ? 'Allow course outlines' : outlineTrouble ? 'Open outlines' : null
          }
          onAction={() => void (allowedOutline ? open(OUTLINE) : connectOutline())}
          help={openHelp === 'outline'}
          onHelp={() => setOpenHelp(openHelp === 'outline' ? null : 'outline')}
          helpText={[
            'Outlines are read for midterm and exam dates only, and only when a date is written beside them.',
            'Some courses publish their outline on outline.uwaterloo.ca, not in LEARN.',
            'Sign in there once so it can be read on your behalf.',
            'Nothing is sent anywhere. It reads the same pages you can already see.',
          ]}
        />

        {needsSignIn && (
          <div class="banner">
            Your LEARN session expired.{' '}
            <a href={`${LEARN_ORIGIN}/d2l/home`} target="_blank" rel="noreferrer">
              Sign in
            </a>{' '}
            and it will pick up again.
          </div>
        )}

        <div class="actions">
          <button type="button" onClick={refresh} disabled={busy}>
            {busy ? 'Refreshing...' : 'Refresh now'}
          </button>
          <button type="button" class="ghost" onClick={() => open(`${LEARN_ORIGIN}/d2l/home`)}>
            Open LEARN
          </button>
        </div>

        {prefs !== null && (prefs.hidden || prefs.minimized) && (
          <button type="button" class="ghost wide" onClick={showPanel}>
            Show the panel again
          </button>
        )}
      </main>

      <footer>
        <span>Nothing leaves your device</span>
        <span>Not affiliated with UW</span>
      </footer>
    </>
  );
};

type StepProps = {
  done: boolean;
  title: string;
  detail: string;
  action: string | null;
  onAction: () => void;
  help: boolean;
  onHelp: () => void;
  helpText: readonly string[];
};

/**
 * One setup step: what it is, whether it is done, and how to do it.
 *
 * The chevron opens instructions in place rather than sending someone
 * elsewhere to read them, since the thing being explained is right here.
 */
function Step({ done, title, detail, action, onAction, help, onHelp, helpText }: StepProps) {
  return (
    <div class={done ? 'step done' : 'step'}>
      <div class="steprow">
        <span class="tick">{done ? '\u2713' : '+'}</span>
        <div class="stepmain">
          <div class="steptitle">{title}</div>
          <div class="stepdetail">{detail}</div>
        </div>
        <button
          type="button"
          class="chev"
          aria-expanded={help}
          aria-label="How to do this"
          onClick={onHelp}
        >
          {help ? '\u2227' : '\u2228'}
        </button>
      </div>

      {action !== null && (
        <button type="button" class="stepbtn" onClick={onAction}>
          <span class="plus">+</span>
          {action}
        </button>
      )}

      {help && (
        <ol class="help">
          {helpText.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

const Stat = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
  <div class="stat">
    <div class={`n ${tone}`}>{n}</div>
    <div class="l">{label}</div>
  </div>
);

const root = document.getElementById('root');
if (root !== null) render(<App />, root);

type AccessProps = {
  hosts: readonly HostStatus[];
  denied: boolean;
  onGrant: () => void;
};

/**
 * Which sites the extension may read, and a way to fix it.
 *
 * Shown whenever anything is missing, rather than behind a check that could
 * itself be wrong. A withheld host is the one failure that looks identical to
 * every other failure from the outside, so it gets stated plainly and given a
 * button, with the manual route named for when Chrome declines to prompt.
 */
function Access({ hosts, denied, onGrant }: AccessProps) {
  const missing = hosts.filter((h) => !h.granted);

  return (
    <div class="access">
      <div class="accesstitle">Site access needed</div>
      <div class="accessdetail">
        Chrome holds these back until you allow them. Nothing works on a site that is not allowed.
      </div>

      <ul class="hostlist">
        {hosts.map((h) => (
          <li key={h.origin} class={h.granted ? 'on' : 'off'}>
            <span class="hostmark">{h.granted ? '\u2713' : '\u00d7'}</span>
            <span>{h.label}</span>
            {h.required && !h.granted && <span class="req">required</span>}
          </li>
        ))}
      </ul>

      <button type="button" class="stepbtn" onClick={onGrant}>
        <span class="plus">+</span>
        Allow {missing.length} {missing.length === 1 ? 'site' : 'sites'}
      </button>

      {denied && (
        <div class="fallback">
          Chrome did not grant it. Open <code>chrome://extensions</code>, click Details under LEARN
          Tracker, and set Site access to On all sites.
        </div>
      )}
    </div>
  );
}
