/**
 * The in-page panel.
 *
 * Lives on top of LEARN rather than in a browser popup, because a popup closes
 * the moment you click anything else, which makes it useless for working
 * through a list. This can be dragged, minimized to a pill, and hidden.
 *
 * Four tabs rather than one long scroll: Assigned is the daily view, Overdue
 * and Done are separate so neither buries the other, and Calendar answers the
 * question a list cannot, which is how the month is shaped.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { group, attentionCount, counts, search as filterTasks, type Section } from '@core/selectors';
import { resolve } from '@core/status';
import {
  addMonths,
  buildMonth,
  byDay,
  dayKeyOf,
  initialMonth,
  toneForDay,
  WEEKDAY_LABELS,
  type DayCell,
} from '@core/calendar';
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

type Tab = 'assigned' | 'overdue' | 'done' | 'calendar';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'assigned', label: 'Assigned' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Done' },
  { id: 'calendar', label: 'Calendar' },
];

/** Assigned is split into these, in this order. */
const ASSIGNED_SECTIONS: readonly Section[] = ['due-soon', 'upcoming', 'undated'];

const SECTION_LABEL: Readonly<Record<Section, string>> = {
  overdue: 'Overdue',
  'due-soon': 'Due this week',
  upcoming: 'Later',
  undated: 'No due date',
  completed: 'Done',
};

export const Panel = () => {
  const [items, setItems] = useState<readonly TaskItem[]>([]);
  const [courses, setCourses] = useState<readonly Course[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());

  const [tab, setTab] = useState<Tab>('assigned');
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const [cursor, setCursor] = useState(() => initialMonth(Date.now()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

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
  const tally = useMemo(() => counts(resolved, now), [resolved, now]);
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

  if (prefs === null || prefs.hidden) return null;

  if (prefs.minimized) {
    return (
      <button type="button" class="pill" onClick={() => void setPref({ minimized: false })}>
        <span class="mark">L</span>
        <span>{attention > 0 ? `${attention} due` : 'LEARN Tracker'}</span>
      </button>
    );
  }

  const tabCount: Readonly<Record<Tab, number>> = {
    assigned: tally.dueSoon + tally.upcoming + tally.undated,
    overdue: tally.overdue,
    done: tally.completed,
    calendar: 0,
  };

  return (
    <div class="panel">
      <Header
        attention={attention}
        busy={busy || (syncState?.running ?? false)}
        onSync={sync}
        onMinimize={() => void setPref({ minimized: true })}
        onHide={() => void setPref({ hidden: true })}
      />

      {syncState?.authState === 'needs-signin' && (
        <div class="banner">
          Your LEARN session expired.{' '}
          <a href={`${LEARN_ORIGIN}/d2l/home`} target="_top">
            Sign in again
          </a>
          , then refresh.
        </div>
      )}

      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            class={tab === t.id ? 'tab on' : 'tab'}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            <span>{t.label}</span>
            {tabCount[t.id] > 0 && <span class="tabn">{tabCount[t.id]}</span>}
          </button>
        ))}
      </nav>

      {tab !== 'calendar' && (
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
      )}

      <div class="body">
        {tab === 'assigned' && (
          <Grouped
            sections={ASSIGNED_SECTIONS.filter((s) => sections[s].length > 0)}
            sectionsData={sections}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            emptyText={query.trim() === '' ? 'Nothing assigned right now.' : 'Nothing matches that search.'}
          />
        )}

        {tab === 'overdue' && (
          <Flat
            tasks={sections.overdue}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            emptyText="Nothing overdue. Good."
          />
        )}

        {tab === 'done' && (
          <Flat
            tasks={sections.completed}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            emptyText="Nothing marked done yet."
          />
        )}

        {tab === 'calendar' && (
          <CalendarView
            tasks={resolved}
            cursor={cursor}
            selectedDay={selectedDay}
            now={now}
            newIds={newIds}
            onMove={(delta) => {
              setCursor(addMonths(cursor.year, cursor.month, delta));
              setSelectedDay(null);
            }}
            onToday={() => {
              setCursor(initialMonth(Date.now()));
              setSelectedDay(dayKeyOf(Date.now()));
            }}
            onSelectDay={(key) => setSelectedDay(key === selectedDay ? null : key)}
            onToggle={onToggle}
          />
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

// --- header ----------------------------------------------------------------

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
      title="Hide. Reopen from the toolbar icon."
      aria-label="Hide"
      onClick={onHide}
    >
      &#215;
    </button>
  </div>
);

// --- list views ------------------------------------------------------------

const Grouped = ({
  sections,
  sectionsData,
  newIds,
  now,
  onToggle,
  emptyText,
}: {
  sections: readonly Section[];
  sectionsData: Readonly<Record<Section, readonly ResolvedTask[]>>;
  newIds: ReadonlySet<string>;
  now: number;
  onToggle: (t: ResolvedTask) => void;
  emptyText: string;
}) => {
  if (sections.length === 0) return <Empty text={emptyText} />;

  return (
    <>
      {sections.map((s) => (
        <div class="section" key={s}>
          <div class="sechead">
            <span>{SECTION_LABEL[s]}</span>
            <span class="n">{sectionsData[s].length}</span>
          </div>
          {sectionsData[s].map((t) => (
            <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
          ))}
        </div>
      ))}
    </>
  );
};

const Flat = ({
  tasks,
  newIds,
  now,
  onToggle,
  emptyText,
}: {
  tasks: readonly ResolvedTask[];
  newIds: ReadonlySet<string>;
  now: number;
  onToggle: (t: ResolvedTask) => void;
  emptyText: string;
}) => {
  if (tasks.length === 0) return <Empty text={emptyText} />;
  return (
    <div class="section">
      {tasks.map((t) => (
        <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
      ))}
    </div>
  );
};

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

// --- calendar --------------------------------------------------------------

const CalendarView = ({
  tasks,
  cursor,
  selectedDay,
  now,
  newIds,
  onMove,
  onToday,
  onSelectDay,
  onToggle,
}: {
  tasks: readonly ResolvedTask[];
  cursor: { year: number; month: number };
  selectedDay: string | null;
  now: number;
  newIds: ReadonlySet<string>;
  onMove: (delta: number) => void;
  onToday: () => void;
  onSelectDay: (key: string) => void;
  onToggle: (t: ResolvedTask) => void;
}) => {
  const view = useMemo(() => buildMonth(cursor.year, cursor.month, now), [cursor, now]);
  const map = useMemo(() => byDay(tasks), [tasks]);

  const dayTasks = selectedDay === null ? [] : (map.get(selectedDay) ?? []);

  return (
    <div class="cal">
      <div class="calhead">
        <button type="button" class="iconbtn dark" aria-label="Previous month" onClick={() => onMove(-1)}>
          &#8249;
        </button>
        <span class="calmonth">{view.label}</span>
        <button type="button" class="iconbtn dark" aria-label="Next month" onClick={() => onMove(1)}>
          &#8250;
        </button>
        <button type="button" class="todaybtn" onClick={onToday}>
          Today
        </button>
      </div>

      <div class="calgrid">
        {WEEKDAY_LABELS.map((d, i) => (
          <div class="dow" key={`${d}-${i}`}>
            {d}
          </div>
        ))}

        {view.weeks.flat().map((cell) => (
          <Day
            key={cell.key}
            cell={cell}
            tasks={map.get(cell.key)}
            selected={cell.key === selectedDay}
            onSelect={() => onSelectDay(cell.key)}
          />
        ))}
      </div>

      <div class="daylist">
        {selectedDay === null ? (
          <p class="hint">Pick a day to see what is due.</p>
        ) : dayTasks.length === 0 ? (
          <p class="hint">Nothing due on this day.</p>
        ) : (
          dayTasks.map((t) => (
            <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
          ))
        )}
      </div>
    </div>
  );
};

const Day = ({
  cell,
  tasks,
  selected,
  onSelect,
}: {
  cell: DayCell;
  tasks: readonly ResolvedTask[] | undefined;
  selected: boolean;
  onSelect: () => void;
}) => {
  const tone = toneForDay(tasks);
  const n = tasks?.length ?? 0;

  const classes = [
    'day',
    cell.inMonth ? '' : 'out',
    cell.isToday ? 'today' : '',
    selected ? 'sel' : '',
    n > 0 ? 'has' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  return (
    <button
      type="button"
      class={classes}
      onClick={onSelect}
      aria-label={n === 0 ? `${cell.dayOfMonth}, nothing due` : `${cell.dayOfMonth}, ${n} due`}
    >
      <span class="dnum">{cell.dayOfMonth}</span>
      {n > 0 && (
        <span class="dots">
          {/* Three dots is the cap: past that the count carries the meaning. */}
          {Array.from({ length: Math.min(n, 3) }).map((_, i) => (
            <span class={`dot ${tone}`} key={i} />
          ))}
          {n > 3 && <span class="more">{n}</span>}
        </span>
      )}
    </button>
  );
};

const Empty = ({ text }: { text: string }) => (
  <div class="empty">
    <div class="big">&#10003;</div>
    <div>{text}</div>
  </div>
);
