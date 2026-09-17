/**
 * Toolbar popup.
 *
 * The panel on the LEARN page is the main surface. This is the control for it:
 * a summary you can see from any tab, and the way to bring the panel back
 * after hiding it.
 */

import { render } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { resolve } from '@core/status';
import { counts } from '@core/selectors';
import type { SectionCounts } from '@core/selectors';
import type { SyncState } from '@core/types';
import {
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

const App = () => {
  const [tally, setTally] = useState<SectionCounts | null>(null);
  const [state, setState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [items, courses, overrides, s, p] = await Promise.all([
      readAllItems(),
      readCourses(),
      readOverrides(),
      readSyncState(),
      readPanelPrefs(),
    ]);
    const byId = new Map(courses.map((c) => [c.id, c]));
    const now = Date.now();
    const resolved = items
      .filter((i) => byId.get(i.courseId)?.looksAcademic ?? true)
      .map((i) => resolve(i, overrides[i.id] ?? null, byId.get(i.courseId) ?? null, now));

    setTally(counts(resolved, now));
    setState(s);
    setPrefs(p);
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

  const showPanel = useCallback(async () => {
    setPrefs(await writePanelPrefs({ hidden: false, minimized: false }));
  }, []);

  const openLearn = useCallback(() => {
    void chrome.tabs.create({ url: `${LEARN_ORIGIN}/d2l/home` });
  }, []);

  const needsSignIn = state?.authState === 'needs-signin';
  const nothingYet = state?.lastSuccessAt === null;

  return (
    <>
      <header>
        <h1>LEARN Tracker</h1>
        <span class="phase">{formatSyncedAt(state?.lastSuccessAt ?? null, Date.now())}</span>
      </header>

      <main>
        {needsSignIn && (
          <div class="banner">
            Your LEARN session expired.{' '}
            <a href={`${LEARN_ORIGIN}/d2l/home`} target="_blank" rel="noreferrer">
              Sign in
            </a>{' '}
            and it will pick up again.
          </div>
        )}

        {tally !== null && (
          <div class="tally">
            <Stat n={tally.overdue} label="Overdue" tone="bad" />
            <Stat n={tally.dueSoon} label="This week" tone="warn" />
            <Stat n={tally.upcoming} label="Later" tone="" />
            <Stat n={tally.completed} label="Done" tone="ok" />
          </div>
        )}

        {nothingYet && !needsSignIn && (
          <p class="intro">
            Open LEARN to get started. The panel appears on the page and fills in after the first
            sync.
          </p>
        )}

        <div class="actions">
          <button type="button" onClick={refresh} disabled={busy}>
            {busy ? 'Refreshing...' : 'Refresh now'}
          </button>
          <button type="button" class="ghost" onClick={openLearn}>
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

const Stat = ({ n, label, tone }: { n: number; label: string; tone: string }) => (
  <div class="stat">
    <div class={`n ${tone}`}>{n}</div>
    <div class="l">{label}</div>
  </div>
);

const root = document.getElementById('root');
if (root !== null) render(<App />, root);
