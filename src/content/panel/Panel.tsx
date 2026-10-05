/**
 * The in-page panel.
 *
 * Lives on top of LEARN rather than in a browser popup, because a popup closes
 * the moment you click anything else, which makes it useless for working
 * through a list. It drags, minimizes to a disc, and hides to an edge tab.
 *
 * Five tabs, all visible at once: To do is the daily view (overdue first,
 * then by day), Calendar shows the shape of the month, Marks and News hold
 * what came back from instructors, and Courses is where outlines connect.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { attentionCount, counts, search as filterTasks } from '@core/selectors';
import { resolve } from '@core/status';
import { assignCourseColors, shortCourseLabel } from '@core/courseColor';
import { addMonths, dayKeyOf, initialMonth } from '@core/calendar';
import type { Course, CourseHealth, ResolvedTask, SyncState, TaskItem } from '@core/types';
import type { Announcement } from '@core/normalize/news';
import {
  type OverrideMap,
  type PanelPrefs,
  readCourses,
  readAllItems,
  readOverrides,
  readPanelPrefs,
  readSyncState,
  readSeenIds,
  readAllHealth,
  readAllNews,
  readSeenNewsIds,
  writeSeenNewsIds,
  readAllMarks,
  readSeenGradeIds,
  writeSeenGradeIds,
  type StoredMarks,
  toggleCompletion,
  writePanelPrefs,
} from '@storage/store';
import { LEARN_ORIGIN } from '@shared/constants';
import type { CommandReply } from '@shared/messages';
import { formatSyncedAt, summaryLine } from './format';
import { groupIdOf } from './groups';
import { buildDiagnostics } from './diagnostics';
import { CourseFilter } from './Row';
import { TodoView } from './TodoView';
import { CalendarView } from './CalendarView';
import { CoursesView } from './CoursesView';
import { Marks } from './Marks';
import { News } from './News';

/**
 * Host access as the service worker sees it. chrome.permissions does not
 * exist in a content script, so asking here directly always reported every
 * host as withheld, which sent diagnosis the wrong way.
 */
const grantedOrigins = async (): Promise<readonly string[]> => {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: 'get-hosts' })) as CommandReply | undefined;
    return reply?.type === 'hosts' ? reply.origins : [];
  } catch {
    return [];
  }
};

type Tab = 'todo' | 'calendar' | 'marks' | 'news' | 'courses';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'marks', label: 'Marks' },
  { id: 'news', label: 'News' },
  { id: 'courses', label: 'Courses' },
];

export const Panel = () => {
  const [items, setItems] = useState<readonly TaskItem[]>([]);
  const [courses, setCourses] = useState<readonly Course[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [prefs, setPrefs] = useState<PanelPrefs | null>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [health, setHealth] = useState<readonly CourseHealth[]>([]);
  const [news, setNews] = useState<readonly Announcement[]>([]);
  const [seenNews, setSeenNews] = useState<ReadonlySet<string>>(new Set());
  const [marks, setMarks] = useState<ReadonlyMap<string, StoredMarks>>(new Map());
  const [seenGrades, setSeenGrades] = useState<ReadonlySet<string>>(new Set());
  const [hosts, setHosts] = useState<readonly string[]>([]);

  const [tab, setTab] = useState<Tab>('todo');
  const [query, setQuery] = useState('');
  const [courseFilter, setCourseFilter] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  const [cursor, setCursor] = useState(() => initialMonth(Date.now()));
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [i, c, o, s, p, seen, h] = await Promise.all([
      readAllItems(),
      readCourses(),
      readOverrides(),
      readSyncState(),
      readPanelPrefs(),
      readSeenIds(),
      readAllHealth(),
    ]);
    setHealth(h);

    const [posts, seenPosts] = await Promise.all([readAllNews(), readSeenNewsIds()]);
    setNews(posts);
    setSeenNews(new Set(seenPosts));

    const [allMarks, seenG] = await Promise.all([readAllMarks(c), readSeenGradeIds()]);
    setMarks(allMarks);
    setSeenGrades(new Set(seenG ?? []));

    // Colours are handed out across the courses actually shown, so no two
    // of them can end up looking alike.
    const withWork = new Set(i.map((x) => x.courseId));
    assignCourseColors(c.filter((x) => isWorthShowing(x, withWork)).map((x) => x.id));

    setHosts(await grantedOrigins());
    setItems(i);
    setCourses(c);
    setOverrides(o);
    setSyncState(s);
    setPrefs(p);
    const seenSet = new Set(seen);
    setNewIds(new Set(i.map((x) => x.id).filter((id) => !seenSet.has(id))));
  }, []);

  useEffect(() => {
    void load();
    const onChanged = () => void load();
    chrome.storage.onChanged.addListener(onChanged);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      clearInterval(tick);
    };
  }, [load]);

  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);

  // Any enrolment that produced coursework counts, regardless of naming.
  const withItems = useMemo(() => new Set(items.map((i) => i.courseId)), [items]);

  const resolved = useMemo<readonly ResolvedTask[]>(() => {
    const showOther = prefs?.showOtherEnrolments ?? false;
    return items
      .filter((i) => showOther || isWorthShowing(courseById.get(i.courseId), withItems))
      .map((i) => resolve(i, overrides[i.id] ?? null, courseById.get(i.courseId) ?? null, now));
  }, [items, overrides, courseById, now, prefs?.showOtherEnrolments, withItems]);

  const shownCourses = useMemo(() => {
    const showOther = prefs?.showOtherEnrolments ?? false;
    const list = courses.filter((c) => showOther || isWorthShowing(c, withItems));
    return [...(list.length > 0 ? list : courses)].sort((a, b) =>
      shortCourseLabel(a.code, a.name).localeCompare(shortCourseLabel(b.code, b.name)),
    );
  }, [courses, withItems, prefs?.showOtherEnrolments]);

  const filterCourses = useMemo(() => {
    const open = new Set(resolved.filter((t) => t.status !== 'completed').map((t) => t.item.courseId));
    return shownCourses.filter((c) => open.has(c.id));
  }, [shownCourses, resolved]);

  const byCourse = useMemo(
    () => (courseFilter === null ? resolved : resolved.filter((t) => t.item.courseId === courseFilter)),
    [resolved, courseFilter],
  );
  const visible = useMemo(() => filterTasks(byCourse, query), [byCourse, query]);

  const tally = useMemo(() => counts(resolved, now), [resolved, now]);
  const attention = useMemo(() => attentionCount(resolved, now), [resolved, now]);
  const dueToday = useMemo(
    () => resolved.filter((t) => t.status !== 'completed' && groupIdOf(t, now) === 'today').length,
    [resolved, now],
  );

  const visibleNews = useMemo(
    () =>
      news.filter(
        (n) => prefs?.showOtherEnrolments || (courseById.get(n.courseId)?.looksAcademic ?? true),
      ),
    [news, courseById, prefs?.showOtherEnrolments],
  );
  const shownNews = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === ''
      ? visibleNews
      : visibleNews.filter((n) => `${n.title} ${n.summary}`.toLowerCase().includes(q));
  }, [visibleNews, query]);
  const unreadNews = visibleNews.filter((n) => !seenNews.has(n.id)).length;

  const sync = useCallback(async () => {
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

  const onToggle = useCallback(
    async (task: ResolvedTask) => {
      await toggleCompletion(task.item.id, task.status === 'completed', Date.now());
      void load();
    },
    [load],
  );

  const markNewsRead = useCallback(async () => {
    // Marking on open, not on scroll: the badge answers "is there anything
    // I have not looked at", and opening the tab is looking at it.
    await writeSeenNewsIds(news.map((n) => n.id));
    setSeenNews(new Set(news.map((n) => n.id)));
  }, [news]);

  const allGradeIds = useMemo(
    () => [...marks.values()].flatMap((m) => m.grades.map((g) => g.id)),
    [marks],
  );
  const unseenMarks = allGradeIds.filter((id) => !seenGrades.has(id)).length;

  // Marked seen on leaving the tab rather than opening it, so "Just returned"
  // is still there to read the first time the tab is opened.
  const markGradesSeen = useCallback(async () => {
    if (allGradeIds.every((id) => seenGrades.has(id))) return;
    await writeSeenGradeIds(allGradeIds);
    setSeenGrades(new Set(allGradeIds));
  }, [allGradeIds, seenGrades]);

  const setPref = useCallback(async (patch: Partial<PanelPrefs>) => {
    setPrefs(await writePanelPrefs(patch));
  }, []);

  if (prefs === null) return null;

  if (prefs.hidden) {
    return (
      <button
        type="button"
        class="edge"
        onClick={() => void setPref({ hidden: false })}
        aria-label={
          attention > 0
            ? `Reopen LEARN Tracker, ${attention} due soon`
            : 'Reopen LEARN Tracker'
        }
        title="Reopen LEARN Tracker"
      >
        <span class="edgeplus" aria-hidden="true">
          +
        </span>
        {attention > 0 && <span class="edgecount">{attention}</span>}
      </button>
    );
  }

  if (prefs.minimized) {
    const overdue = tally.overdue;

    return (
      <button
        type="button"
        class={overdue > 0 ? 'dock urgent' : 'dock'}
        onClick={() => void setPref({ minimized: false })}
        aria-label={
          attention > 0
            ? `LEARN Tracker, ${attention} due soon. Open.`
            : 'LEARN Tracker. Open.'
        }
        title="Open LEARN Tracker"
      >
        {/* Collapsed to a disc; the label only unfurls on hover, so the
            resting state stays out of the way of the page underneath. */}
        <span class="dockface">
          <span class="dockmark">L</span>
          <span class="dockplus" aria-hidden="true">
            +
          </span>
        </span>

        <span class="docklabel">
          <span class="docktitle">LEARN Tracker</span>
          <span class="dockcount">
            {attention > 0 ? `${attention} due soon` : 'nothing due'}
          </span>
        </span>

        {attention > 0 && <span class="dockbadge">{attention}</span>}
      </button>
    );
  }

  const tabCount: Readonly<Record<Tab, number>> = {
    todo: attention,
    calendar: 0,
    marks: unseenMarks,
    news: unreadNews,
    courses: 0,
  };

  const switchTab = (next: Tab) => {
    if (tab === 'marks' && next !== 'marks') void markGradesSeen();
    setTab(next);
    if (next === 'news') void markNewsRead();
  };

  const showsSearch = tab === 'todo' || tab === 'news';
  const showsFilter = tab === 'todo' || tab === 'calendar';

  return (
    <div class="panel">
      <Header
        summary={summaryLine(tally.overdue, dueToday, tally.dueSoon)}
        late={tally.overdue > 0}
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
            onClick={() => switchTab(t.id)}
          >
            <span>{t.label}</span>
            {tabCount[t.id] > 0 && (
              <span class={t.id === 'todo' && tally.overdue > 0 ? 'tabn late' : 'tabn'}>
                {tabCount[t.id]}
              </span>
            )}
          </button>
        ))}
      </nav>

      {(showsSearch || showsFilter) && (
        <div class="toolbar">
          {showsFilter && (
            <CourseFilter courses={filterCourses} selected={courseFilter} onSelect={setCourseFilter} />
          )}
          {showsSearch && (
            <input
              class="search"
              type="search"
              placeholder={tab === 'news' ? 'Search announcements' : 'Search your to-do list'}
              aria-label="Search"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          )}
        </div>
      )}

      <div class="body">
        {tab === 'todo' && (
          <TodoView
            tasks={visible}
            newIds={newIds}
            now={now}
            searching={query.trim() !== '' || courseFilter !== null}
            showCompleted={prefs.showCompleted}
            onShowCompleted={(show) => void setPref({ showCompleted: show })}
            onToggle={onToggle}
          />
        )}

        {tab === 'calendar' && (
          <CalendarView
            tasks={byCourse}
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

        {tab === 'marks' && <Marks marks={marks} courses={courses} seen={seenGrades} now={now} />}

        {tab === 'news' && <News posts={shownNews} seen={seenNews} courses={courseById} now={now} />}

        {tab === 'courses' && (
          <CoursesView
            courses={shownCourses}
            health={health}
            tasks={resolved}
            helpOpen={prefs.outlinesOpen ?? null}
            onHelpOpen={(open) => void setPref({ outlinesOpen: open })}
            showOther={prefs.showOtherEnrolments}
            onShowOther={(show) => void setPref({ showOtherEnrolments: show })}
            diagnostics={() =>
              buildDiagnostics({
                items,
                courses,
                health,
                marks,
                syncState,
                grantedHosts: hosts,
                now: Date.now(),
              })
            }
          />
        )}
      </div>

      <div class="foot">
        <span>{formatSyncedAt(syncState?.lastSuccessAt ?? null, now)}</span>
        <span class="build" title="Build date, so a stale load is obvious">
          {__BUILD_ID__}
        </span>
        <button type="button" class="linkbtn" onClick={sync}>
          Refresh now
        </button>
      </div>
    </div>
  );
};

// --- header ----------------------------------------------------------------

type HeaderProps = {
  summary: string;
  late: boolean;
  busy: boolean;
  onSync: () => void;
  onMinimize: () => void;
  onHide: () => void;
};

function Header({ summary, late, busy, onSync, onMinimize, onHide }: HeaderProps) {
  return (
    <div class="head" data-drag-handle>
      <span class="mark">L</span>
      <span class="titles">
        <span class="title">LEARN Tracker</span>
        <span class={late ? 'summary late' : 'summary'}>{summary}</span>
      </span>
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
        title="Hide. Reopen from the tab on the edge of the page."
        aria-label="Hide"
        onClick={onHide}
      >
        &#215;
      </button>
    </div>
  );
}

/**
 * Whether an enrolment belongs in the default view.
 *
 * Name shape alone is not enough: plenty of real courses are titled in prose
 * with no course code anywhere, and hiding one takes its assignments with it.
 * Carrying actual coursework settles the question.
 */
const isWorthShowing = (course: Course | undefined, withItems: ReadonlySet<string>): boolean => {
  if (course === undefined) return true;
  return course.looksAcademic || withItems.has(course.id);
};
