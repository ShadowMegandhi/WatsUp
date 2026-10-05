/**
 * The in-page panel.
 *
 * Lives on top of LEARN rather than in a browser popup, because a popup closes
 * the moment you click anything else, which makes it useless for working
 * through a list. It drags, minimizes to a pill, and hides.
 *
 * Tabs rather than one long scroll: Assigned is the daily view, Overdue and
 * Done are separate so neither buries the other, Calendar answers the question
 * a list cannot (how the month is shaped), and Marks and News hold what came
 * back from instructors.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { group, attentionCount, counts, search as filterTasks, type Section } from '@core/selectors';
import { resolve } from '@core/status';
import { shortCourseLabel } from '@core/courseColor';
import {
  addMonths,
  buildMonth,
  byDay,
  dayKeyOf,
  initialMonth,
  WEEKDAY_LABELS,
  type DayCell,
} from '@core/calendar';
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
import { formatDue, formatSyncedAt, urgency, KIND_LABEL } from './format';
import { buildDiagnostics } from './diagnostics';
import { colorVars } from './courseStyle';
import { Marks } from './Marks';
import { News } from './News';
import { grantedOrigins } from '@platform/permissions';

type Tab = 'assigned' | 'overdue' | 'done' | 'calendar' | 'marks' | 'news' | 'courses';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'assigned', label: 'Assigned' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Done' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'marks', label: 'Marks' },
  { id: 'news', label: 'News' },
  { id: 'courses', label: 'Courses' },
];

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
  const [health, setHealth] = useState<readonly CourseHealth[]>([]);
  const [news, setNews] = useState<readonly Announcement[]>([]);
  const [seenNews, setSeenNews] = useState<ReadonlySet<string>>(new Set());
  const [marks, setMarks] = useState<ReadonlyMap<string, StoredMarks>>(new Map());
  const [seenGrades, setSeenGrades] = useState<ReadonlySet<string>>(new Set());
  const [hosts, setHosts] = useState<readonly string[]>([]);

  const [tab, setTab] = useState<Tab>('assigned');
  const [query, setQuery] = useState('');
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
  const withItems = useMemo(
    () => new Set(items.map((i) => i.courseId)),
    [items],
  );

  const resolved = useMemo<readonly ResolvedTask[]>(() => {
    const showOther = prefs?.showOtherEnrolments ?? false;
    return items
      .filter((i) => showOther || isWorthShowing(courseById.get(i.courseId), withItems))
      .map((i) => resolve(i, overrides[i.id] ?? null, courseById.get(i.courseId) ?? null, now));
  }, [items, overrides, courseById, now, prefs?.showOtherEnrolments]);

  const visible = useMemo(() => filterTasks(resolved, query), [resolved, query]);
  const sections = useMemo(() => group(visible, now), [visible, now]);
  const tally = useMemo(() => counts(resolved, now), [resolved, now]);
  const attention = useMemo(() => attentionCount(resolved, now), [resolved, now]);

  const visibleNews = useMemo(
    () =>
      news.filter(
        (n) => prefs?.showOtherEnrolments || (courseById.get(n.courseId)?.looksAcademic ?? true),
      ),
    [news, courseById, prefs?.showOtherEnrolments],
  );
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
    assigned: tally.dueSoon + tally.upcoming + tally.undated,
    overdue: tally.overdue,
    done: tally.completed,
    calendar: 0,
    marks: unseenMarks,
    news: unreadNews,
    courses: 0,
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
            onClick={() => {
              if (tab === 'marks' && t.id !== 'marks') void markGradesSeen();
              setTab(t.id);
              if (t.id === 'news') void markNewsRead();
            }}
          >
            <span>{t.label}</span>
            {tabCount[t.id] > 0 && (
              <span class={t.id === 'overdue' ? 'tabn late' : 'tabn'}>{tabCount[t.id]}</span>
            )}
          </button>
        ))}
      </nav>

      {(tab === 'assigned' || tab === 'overdue' || tab === 'done' || tab === 'news') && (
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
            data={sections}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            empty={
              query.trim() === ''
                ? { line: 'Nothing assigned right now.', sub: 'New work appears here automatically.' }
                : { line: 'Nothing matches that search.', sub: null }
            }
          />
        )}

        {tab === 'overdue' && (
          <Flat
            tasks={sections.overdue}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            empty={{ line: 'Nothing overdue.', sub: 'You are caught up.' }}
          />
        )}

        {tab === 'done' && (
          <Flat
            tasks={sections.completed}
            newIds={newIds}
            now={now}
            onToggle={onToggle}
            empty={{ line: 'Nothing finished yet.', sub: 'Tick something off and it moves here.' }}
          />
        )}

        {tab === 'marks' && <Marks marks={marks} courses={courses} seen={seenGrades} now={now} />}

        {tab === 'news' && <News posts={visibleNews} seen={seenNews} courses={courseById} now={now} />}

        {tab === 'courses' && (
          <Courses
            courses={courses}
            health={health}
            items={items}
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
  attention: number;
  busy: boolean;
  onSync: () => void;
  onMinimize: () => void;
  onHide: () => void;
};

function Header({ attention, busy, onSync, onMinimize, onHide }: HeaderProps) {
  return (
    <div class="head" data-drag-handle>
      <span class="mark">L</span>
      <span class="title">LEARN Tracker</span>
      {attention > 0 && <span class="count urgent">{attention} due soon</span>}
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
}

// --- list views ------------------------------------------------------------

type EmptyCopy = { line: string; sub: string | null };

type GroupedProps = {
  sections: readonly Section[];
  data: Readonly<Record<Section, readonly ResolvedTask[]>>;
  newIds: ReadonlySet<string>;
  now: number;
  onToggle: (t: ResolvedTask) => void;
  empty: EmptyCopy;
};

function Grouped({ sections, data, newIds, now, onToggle, empty }: GroupedProps) {
  if (sections.length === 0) return <Empty copy={empty} />;

  return (
    <>
      {sections.map((s) => (
        <div class="section" key={s}>
          <div class={s === 'overdue' ? 'sechead late' : 'sechead'}>
            <span>{SECTION_LABEL[s]}</span>
            <span class="n">{data[s].length}</span>
          </div>
          {data[s].map((t) => (
            <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
          ))}
        </div>
      ))}
    </>
  );
}

type FlatProps = {
  tasks: readonly ResolvedTask[];
  newIds: ReadonlySet<string>;
  now: number;
  onToggle: (t: ResolvedTask) => void;
  empty: EmptyCopy;
};

function Flat({ tasks, newIds, now, onToggle, empty }: FlatProps) {
  if (tasks.length === 0) return <Empty copy={empty} />;
  return (
    <div class="section" style="padding-top:8px">
      {tasks.map((t) => (
        <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
      ))}
    </div>
  );
}

type RowProps = {
  task: ResolvedTask;
  isNew: boolean;
  now: number;
  onToggle: (t: ResolvedTask) => void;
};

function Row({ task, isNew, now, onToggle }: RowProps) {
  const done = task.status === 'completed';
  // The exact outline line is kept so a reading can be checked, not trusted.
  const syllabusSource = task.item.sources.find((s) => s.system === 'syllabus');
  const syllabusLine = syllabusSource === undefined ? null : (syllabusSource.detail?.rawLine ?? '');
  const isExam = task.item.kind === 'exam' || task.item.kind === 'test';
  const course = task.course;

  return (
    <div class={done ? 'row done' : 'row'} style={colorVars(course?.id ?? null)}>
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
          {course !== null && (
            <span class="course">{shortCourseLabel(course.code, course.name)}</span>
          )}
          {isExam ? (
            <span class="flag exam">{KIND_LABEL[task.item.kind] ?? 'Exam'}</span>
          ) : (
            <span class="kind">{KIND_LABEL[task.item.kind] ?? 'Item'}</span>
          )}
          {syllabusLine !== null && (
            <span class="flag syllabus" title={`Read from your outline: "${syllabusLine}"`}>
              from syllabus · check
            </span>
          )}
          {isNew && <span class="flag new">new</span>}
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
}

function Empty({ copy }: { copy: EmptyCopy }) {
  return (
    <div class="empty">
      <div class="big">&#10003;</div>
      <div>{copy.line}</div>
      {copy.sub !== null && <div class="sub">{copy.sub}</div>}
    </div>
  );
}

// --- calendar --------------------------------------------------------------

/** How many chips fit in a cell before the rest become a count. */
const CHIPS_PER_DAY = 2;

type CalendarProps = {
  tasks: readonly ResolvedTask[];
  cursor: { year: number; month: number };
  selectedDay: string | null;
  now: number;
  newIds: ReadonlySet<string>;
  onMove: (delta: number) => void;
  onToday: () => void;
  onSelectDay: (key: string) => void;
  onToggle: (t: ResolvedTask) => void;
};

function CalendarView({
  tasks,
  cursor,
  selectedDay,
  now,
  newIds,
  onMove,
  onToday,
  onSelectDay,
  onToggle,
}: CalendarProps) {
  const view = useMemo(() => buildMonth(cursor.year, cursor.month, now), [cursor, now]);
  const map = useMemo(() => byDay(tasks), [tasks]);
  const dayTasks = selectedDay === null ? [] : (map.get(selectedDay) ?? []);

  const heading =
    selectedDay === null
      ? null
      : new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });

  return (
    <div>
      <div class="calhead">
        <span class="calmonth">{view.label}</span>
        <button type="button" class="iconbtn" aria-label="Previous month" onClick={() => onMove(-1)}>
          &#8249;
        </button>
        <button type="button" class="iconbtn" aria-label="Next month" onClick={() => onMove(1)}>
          &#8250;
        </button>
        <button type="button" class="todaybtn" onClick={onToday}>
          Today
        </button>
      </div>

      <div class="calgrid">
        {WEEKDAY_LABELS.map((d, i) => (
          <div class="dow" key={`dow-${i}`}>
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
          <>
            <div class="dayhead">{heading}</div>
            <p class="hint">Nothing due.</p>
          </>
        ) : (
          <>
            <div class="dayhead">{heading}</div>
            {dayTasks.map((t) => (
              <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

type DayProps = {
  cell: DayCell;
  tasks: readonly ResolvedTask[] | undefined;
  selected: boolean;
  onSelect: () => void;
};

function Day({ cell, tasks, selected, onSelect }: DayProps) {
  const list = tasks ?? [];
  const shown = list.slice(0, CHIPS_PER_DAY);
  const hidden = list.length - shown.length;

  const anyLate = list.some((t) => t.status === "overdue");
  const anyOpen = list.some((t) => t.status !== "completed");

  const classes = [
    'day',
    cell.inMonth ? '' : 'out',
    cell.isToday ? 'today' : '',
    selected ? 'sel' : '',
    anyLate ? 'late' : anyOpen ? 'has' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const label =
    list.length === 0
      ? `${cell.dayOfMonth}, nothing due`
      : `${cell.dayOfMonth}, ${list.length} due: ${list.map((t) => t.effectiveTitle).join(', ')}`;

  return (
    <button
      type="button"
      class={classes}
      onClick={onSelect}
      aria-label={label}
      style={colorVars(list[0]?.course?.id ?? null)}
    >
      <span class="dnum">{cell.dayOfMonth}</span>

      {shown.map((t) => (
        <span
          key={t.item.id}
          class={
            t.status === 'completed' ? 'chip done' : t.status === 'overdue' ? 'chip late' : 'chip'
          }
          style={colorVars(t.course?.id ?? null)}
          title={t.effectiveTitle}
        >
          {t.effectiveTitle}
        </span>
      ))}

      {hidden > 0 && <span class="chipmore">{hidden} more</span>}
    </button>
  );
}

// --- courses ---------------------------------------------------------------

type CoursesProps = {
  courses: readonly Course[];
  health: readonly CourseHealth[];
  items: readonly TaskItem[];
  diagnostics: () => string;
};

/**
 * What the extension knows about each course, and what it managed to read.
 *
 * This exists because an empty syllabus result and a syllabus that was never
 * found look identical from the outside. A student who cannot tell which one
 * happened has no way to know whether to trust the list.
 */
function Courses({ courses, health, items, diagnostics }: CoursesProps) {
  const healthById = new Map(health.map((h) => [h.courseId, h]));
  const withWork = new Set(items.map((i) => i.courseId));
  const shown = courses.filter((c) => c.looksAcademic || withWork.has(c.id));
  const list = shown.length > 0 ? shown : courses;

  if (list.length === 0) {
    return <Empty copy={{ line: 'No courses loaded yet.', sub: 'Refresh to fetch them.' }} />;
  }

  return (
    <div class="section" style="padding-top:8px">
      <Troubleshoot diagnostics={diagnostics} />
      {list.map((course) => {
        const h = healthById.get(course.id);
        const count = items.filter((i) => i.courseId === course.id).length;
        const fromSyllabus = h?.syllabusItems ?? 0;

        return (
          <div class="crow" key={course.id} style={colorVars(course.id)}>
            <span class="cdot" />
            <div class="main">
              <a class="name" href={course.url} target="_top" rel="noreferrer">
                {course.name}
              </a>
              <div class="meta">
                <span class="course">{shortCourseLabel(course.code, course.name)}</span>
                <span class="kind">
                  {count} {count === 1 ? 'item' : 'items'}
                </span>
                {fromSyllabus > 0 && (
                  <span class="flag syllabus">
                    {fromSyllabus} exam {fromSyllabus === 1 ? 'date' : 'dates'} from syllabus
                  </span>
                )}
              </div>
              {h?.syllabusNote != null && h.syllabusNote !== '' && (
                <div class="note">{h.syllabusNote}</div>
              )}
              {h?.lastError != null && h.lastError !== '' && (
                <div class="conflict">{h.lastError}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The two things worth doing when something looks wrong.
 *
 * A reset exists because a cache can hold an empty result and there is
 * otherwise no way to ask for another attempt. It keeps ticked-off state,
 * which cannot be rebuilt from anywhere.
 */
function Troubleshoot({ diagnostics }: { diagnostics: () => string }) {
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be refused by the page. The reset button still works.
    }
  }, [diagnostics]);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      await chrome.runtime.sendMessage({ type: 'reset-and-sync' });
    } catch {
      // The worker may have been evicted; storage updates arrive either way.
    } finally {
      setTimeout(() => setResetting(false), 4000);
    }
  }, []);

  return (
    <div class="crow tools">
      <span class="cdot" />
      <div class="main">
        <span class="name">Something look wrong?</span>
        <div class="note">
          Start fresh reads everything again from LEARN. Anything ticked off stays ticked.
        </div>
        <div class="toolrow">
          <button type="button" class="toolbtn" onClick={reset} disabled={resetting}>
            {resetting ? 'Starting fresh...' : 'Start fresh'}
          </button>
          <button type="button" class="toolbtn ghost" onClick={copy}>
            {copied ? 'Copied' : 'Copy diagnostics'}
          </button>
        </div>
      </div>
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

