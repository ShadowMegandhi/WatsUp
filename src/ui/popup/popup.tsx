/**
 * Toolbar popup: status, and how to finish setting the extension up.
 *
 * The panel on the LEARN page is where the work happens. This is where someone
 * finds out what is connected, what is not, and what to click about it. Three
 * rounds of a schedule never being captured came down to the one required
 * action living inside a tab nobody opened, so it leads here.
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
  readPortalCapture,
  readSyncState,
  writePanelPrefs,
  type PanelPrefs,
  type StoredPortalCapture,
} from '@storage/store';
import { LEARN_ORIGIN } from '@shared/constants';
import { formatSyncedAt } from '../../content/panel/format';
import {
  OUTLINE_ORIGINS,
  SCHEDULE_ORIGINS,
  hasOrigins,
  registerScheduleScript,
  requestOrigins,
} from '@platform/permissions';

const QUEST = 'https://quest.pecs.uwaterloo.ca/';
const OUTLINE = 'https://outline.uwaterloo.ca/';

const App = () => {
  const [tally, setTally] = useState<SectionCounts | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [portal, setPortal] = useState<StoredPortalCapture | null>(null);
  const [health, setHealth] = useState<readonly CourseHealth[]>([]);
  const [busy, setBusy] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  const [allowedSchedule, setAllowedSchedule] = useState(true);
  const [allowedOutline, setAllowedOutline] = useState(true);

  const load = useCallback(async () => {
    const [items, courses, overrides, s, p, cap, h] = await Promise.all([
      readAllItems(),
      readCourses(),
      readOverrides(),
      readSyncState(),
      readPanelPrefs(),
      readPortalCapture(),
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
    setPortal(cap);
    setHealth(h);

    // A withheld host fails silently in two ways at once, so it is checked
    // rather than assumed.
    setAllowedSchedule(await hasOrigins(SCHEDULE_ORIGINS));
    setAllowedOutline(await hasOrigins(OUTLINE_ORIGINS));
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

  const connectSchedule = useCallback(async () => {
    const granted = await requestOrigins(SCHEDULE_ORIGINS);
    if (!granted) return;
    await registerScheduleScript();
    setAllowedSchedule(true);
    void chrome.tabs.create({ url: QUEST });
  }, []);

  const connectOutline = useCallback(async () => {
    const granted = await requestOrigins(OUTLINE_ORIGINS);
    if (!granted) return;
    setAllowedOutline(true);
    void chrome.tabs.create({ url: OUTLINE });
  }, []);

  const showPanel = useCallback(async () => {
    setPrefs(await writePanelPrefs({ hidden: false, minimized: false }));
  }, []);

  const sessions = portal?.events?.length ?? 0;
  const waiting = health.reduce((total, h) => {
    const m = /(\d{1,2}) of them, but no/.exec(h.syllabusNote ?? '');
    return total + (m === null ? 0 : Number(m[1]));
  }, 0);

  const needsSignIn = state?.authState === 'needs-signin';
  const outlineTrouble = health.some((h) => (h.syllabusNote ?? '').includes('linked outline'));

  return (
    <>
      <header>
        <h1>LEARN Tracker</h1>
        <span class="phase">{formatSyncedAt(state?.lastSuccessAt ?? null, Date.now())}</span>
      </header>

      <main>
        {tally !== null && (
          <div class="tally">
            <Stat n={tally.overdue} label="Overdue" tone="bad" />
            <Stat n={tally.dueSoon} label="This week" tone="warn" />
            <Stat n={tally.upcoming} label="Later" tone="" />
            <Stat n={tally.completed} label="Done" tone="ok" />
          </div>
        )}

        <Step
          done={sessions > 0 && allowedSchedule}
          title={
            !allowedSchedule
              ? 'Allow access to Quest'
              : sessions > 0
                ? `Quest connected, ${sessions} sessions`
                : 'Connect Quest'
          }
          detail={
            !allowedSchedule
              ? 'Chrome is holding this back. One click grants it.'
              : sessions > 0
                ? 'Lab and tutorial dates are known.'
                : waiting > 0
                  ? `${waiting} assignments are waiting on your timetable.`
                  : 'Needed before labs and tutorials can be dated.'
          }
          action={
            !allowedSchedule ? 'Allow and open Quest' : sessions > 0 ? null : 'Open Quest'
          }
          onAction={() => void (allowedSchedule ? open(QUEST) : connectSchedule())}
          help={openHelp === 'quest'}
          onHelp={() => setOpenHelp(openHelp === 'quest' ? null : 'quest')}
          helpText={[
            'Sign in to Quest.',
            'Open your class schedule: the page listing each course with LEC, LAB and TUT rows.',
            'A message appears at the bottom right saying what was read.',
            'Come back to LEARN and press Refresh now.',
          ]}
        />

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
