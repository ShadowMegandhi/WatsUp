/**
 * The in-page panel.
 *
 * Lives on top of LEARN rather than in a browser popup, because a popup closes
 * the moment you click anything else, which makes it useless for working
 * through a list. This can be dragged, minimized to a pill, and hidden.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { group, attentionCount, search as filterTasks, type Section } from '@core/selectors';
import { resolve } from '@core/status';
import type { Course, ResolvedTask, SyncState, TaskItem } from '@core/types';
import {
  type OverrideMap,
  type PanelPrefs,
  readCourses,
  readAllItems,
  readOverrides,
  readPanelPrefs,
  readSyncState,
  readSeenIds,
  toggleCompletion,
  writePanelPrefs,
} from '@storage/store';
import { LEARN_ORIGIN } from '@shared/constants';
import { formatDue, formatSyncedAt, urgency, KIND_LABEL } from './format';

const SECTION_LABEL: Readonly<Record<Section, string>> = {
  overdue: 'Overdue',
  'due-soon': 'Due this week',
  upcoming: 'Later',
  undated: 'No due date',
  completed: 'Done',
};

const ORDER: readonly Section[] = ['overdue', 'due-soon', 'upcoming', 'undated', 'completed'];

export const Panel = () => {
  const [items, setItems] = useState<readonly TaskItem[]>([]);
  const [courses, setCourses] = useState<readonly Course[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<Section>>(new Set(['completed']));
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [i, c, o, s, p, seen] = await Promise.all([
      readAllItems(),
      readCourses(),
      readOverrides(),
      readSyncState(),
      readPanelPrefs(),
      readSeenIds(),
    ]);
    setItems(i);
    setCourses(c);
    setOverrides(o);
    setSyncState(s);
    setPrefs(p);
    // Anything absent from the last-seen baseline appeared since you last looked.
    const seenSet = new Set(seen);
    setNewIds(new Set(i.map((x) => x.id).filter((id) => !seenSet.has(id))));
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);

    // Keeps relative phrasing such as "due tomorrow" honest across midnight.
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      clearInterval(tick);
    };
  }, [load]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  const resolved = useMemo<readonly ResolvedTask[]>(() => {
    const showOther = prefs?.showOtherEnrolments ?? false;
    return items
      .filter((i) => showOther || (courseById.get(i.courseId)?.looksAcademic ?? true))
      .map((i) => resolve(i, overrides[i.id] ?? null, courseById.get(i.courseId) ?? null, now));
  }, [items, overrides, courseById, now, prefs?.showOtherEnrolments]);

  const visible = useMemo(() => filterTasks(resolved, query), [resolved, query]);
  const sections = useMemo(() => group(visible, now), [visible, now]);
  const attention = useMemo(() => attentionCount(resolved, now), [resolved, now]);

  const sync = useCallback(async () => {
    setBusy(true);
    try {
      await chrome.runtime.sendMessage({ type: 'sync-now' });
    } catch {
      // The worker may have been evicted mid-message. The storage listener
      // picks up the result either way.
    } finally {
      setBusy(false);
      void load();
    }
  }, [load]);

  const onToggle = useCallback(
    async (task: ResolvedTask) => {
      await toggleCompletion(task.item.id, task.status === 'completed', Date.now());
      void load();
    },
    [load],
  );

  const setPref = useCallback(async (patch: Partial<PanelPrefs>) => {
    setPrefs(await writePanelPrefs(patch));
  }, []);

  const toggleSection = useCallback((s: Section) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  if (prefs === null) return null;
  if (prefs.hidden) return null;

  if (prefs.minimized) {
    return (
      <button type="button" class="pill" onClick={() => void setPref({ minimized: false })}>
        <span class="mark">L</span>
        <span>{attention > 0 ? `${attention} due` : 'LEARN Tracker'}</span>
      </button>
    );
  }

  const needsSignIn = syncState?.authState === 'needs-signin';
  const nonEmpty = ORDER.filter((s) => sections[s].length > 0);

  return (
    <div class="panel">
      <Header
        attention={attention}
        busy={busy || (syncState?.running ?? false)}
        onSync={sync}
        onMinimize={() => void setPref({ minimized: true })}
        onHide={() => void setPref({ hidden: true })}
      />

      {needsSignIn && (
        <div class="banner">
          Your LEARN session expired.{' '}
          <a href={`${LEARN_ORIGIN}/d2l/home`} target="_top">
            Sign in again
          </a>
          , then refresh.
        </div>
      )}

      <div class="toolbar">
        <input
          class="search"
          type="search"
          placeholder="Search assignments"
          value={query}
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        />
        <button
          type="button"
          class="toggle"
          aria-pressed={prefs.showOtherEnrolments}
          title="Include clubs, residence and other non-course enrolments"
          onClick={() => void setPref({ showOtherEnrolments: !prefs.showOtherEnrolments })}
        >
          All
        </button>
      </div>

      <div class="body">
        {nonEmpty.length === 0 ? (
          <Empty synced={syncState?.lastSuccessAt ?? null} query={query} />
        ) : (
          nonEmpty.map((s) => (
            <SectionBlock
              key={s}
              section={s}
              tasks={sections[s]}
              collapsed={collapsed.has(s)}
              onToggleSection={() => toggleSection(s)}
              onToggleTask={onToggle}
              newIds={newIds}
              now={now}
            />
          ))
        )}
      </div>

      <div class="foot">
        <span>{formatSyncedAt(syncState?.lastSuccessAt ?? null, now)}</span>
        <button type="button" class="linkbtn" onClick={sync}>
          Refresh now
        </button>
      </div>
    </div>
  );
};

const Header = ({
  attention,
  busy,
  onSync,
  onMinimize,
  onHide,
}: {
  attention: number;
  busy: boolean;
  onSync: () => void;
  onMinimize: () => void;
  onHide: () => void;
}) => (
  <div class="head" data-drag-handle>
    <span class="mark">L</span>
    <span class="title">LEARN Tracker</span>
    <span class={attention === 0 ? 'count zero' : 'count'}>{attention}</span>
    <button
      type="button"
      class={busy ? 'iconbtn spin' : 'iconbtn'}
      title="Refresh"
      aria-label="Refresh"
      onClick={onSync}
    >
      &#8635;
    </button>
    <button type="button" class="iconbtn" title="Minimize" aria-label="Minimize" onClick={onMinimize}>
      &#8211;
    </button>
    <button
      type="button"
      class="iconbtn"
      title="Hide until the next page load"
      aria-label="Hide"
      onClick={onHide}
    >
      &#215;
    </button>
  </div>
);

const SectionBlock = ({
  section,
  tasks,
  collapsed,
  onToggleSection,
  onToggleTask,
  newIds,
  now,
}: {
  section: Section;
  tasks: readonly ResolvedTask[];
  collapsed: boolean;
  onToggleSection: () => void;
  onToggleTask: (t: ResolvedTask) => void;
  newIds: ReadonlySet<string>;
  now: number;
}) => (
  <div class="section">
    <button
      type="button"
      class={section === 'overdue' ? 'sechead overdue' : 'sechead'}
      aria-expanded={!collapsed}
      onClick={onToggleSection}
    >
      <span>{SECTION_LABEL[section]}</span>
      <span class="n">{tasks.length}</span>
      <span class="chev">{collapsed ? '▶' : '▼'}</span>
    </button>

    {!collapsed &&
      tasks.map((t) => (
        <Row
          key={t.item.id}
          task={t}
          isNew={newIds.has(t.item.id)}
          now={now}
          onToggle={onToggleTask}
        />
      ))}
  </div>
);

const Row = ({
  task,
  isNew,
  now,
  onToggle,
}: {
  task: ResolvedTask;
  isNew: boolean;
  now: number;
  onToggle: (t: ResolvedTask) => void;
}) => {
  const done = task.status === 'completed';
  const fromSyllabus = task.item.sources.some((s) => s.system === 'syllabus');

  return (
    <div class={done ? 'row done' : 'row'}>
      <button
        type="button"
        class="check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={() => onToggle(task)}
      >
        &#10003;
      </button>

      <div class="main">
        <a class="name" href={task.item.url} target="_top" rel="noreferrer">
          {task.effectiveTitle}
        </a>

        <div class="meta">
          {task.course !== null && <span class="tag">{task.course.code || task.course.name}</span>}
          <span class="tag kind">{KIND_LABEL[task.item.kind] ?? 'Item'}</span>
          {fromSyllabus && <span class="tag syllabus">from syllabus</span>}
          {isNew && <span class="tag new">new</span>}
          {!done && (
            <span class={`due ${urgency(task.effectiveDueAt, now)}`}>
              {formatDue(task.effectiveDueAt, now)}
            </span>
          )}
        </div>

        {task.completionConflict && (
          <div class="conflict">LEARN shows a submission, but you marked this not done.</div>
        )}
      </div>
    </div>
  );
};

const Empty = ({ synced, query }: { synced: number | null; query: string }) => {
  if (query.trim() !== '') {
    return (
      <div class="empty">
        <div class="big">&#128269;</div>
        <div>Nothing matches that search.</div>
      </div>
    );
  }
  return (
    <div class="empty">
      <div class="big">{synced === null ? '↻' : '✓'}</div>
      <div>
        {synced === null
          ? 'Loading your courses. The first sync takes a few seconds.'
          : 'Nothing outstanding right now.'}
      </div>
    </div>
  );
};
