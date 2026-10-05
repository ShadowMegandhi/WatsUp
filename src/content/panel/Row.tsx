/**
 * The pieces every list in the panel is built from: a task row, the empty
 * state, and the course filter strip.
 *
 * A row reads left to right in the order a student asks the questions:
 * which course, what is it, when is it due. The course leads, in its own
 * colour, and the due date sits in a pill coloured by urgency, so both can
 * be found at a glance without reading.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { shortCourseLabel } from '@core/courseColor';
import type { Course, ResolvedTask } from '@core/types';
import { colorVars } from './courseStyle';
import { formatDueShort, KIND_LABEL, urgency } from './format';

type RowProps = {
  task: ResolvedTask;
  isNew: boolean;
  now: number;
  onToggle: (t: ResolvedTask) => void;
};

export function Row({ task, isNew, now, onToggle }: RowProps) {
  const done = task.status === 'completed';
  // The exact outline line is kept so a reading can be checked, not trusted.
  const syllabusSource = task.item.sources.find((s) => s.system === 'syllabus');
  const outlineLine = syllabusSource === undefined ? null : (syllabusSource.detail?.rawLine ?? '');
  const isExam = task.item.kind === 'exam' || task.item.kind === 'test';
  const course = task.course;
  const tone = task.status === 'overdue' ? 'late' : urgency(task.effectiveDueAt, now);
  const kind = KIND_LABEL[task.item.kind] ?? 'Item';

  return (
    <div class={done ? 'row done' : 'row'} style={colorVars(course?.id ?? null)}>
      <button
        type="button"
        class="check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.effectiveTitle}" not done` : `Mark "${task.effectiveTitle}" done`}
        onClick={() => onToggle(task)}
      >
        &#10003;
      </button>

      <div class="rmain">
        <div class="rtop">
          {course !== null && (
            <span class="course" title={course.name}>
              {shortCourseLabel(course.code, course.name)}
            </span>
          )}
          {isExam ? <span class="badge">{kind}</span> : <span class="kind">{kind}</span>}
          {isNew && <span class="newtag">New</span>}
        </div>

        <a class="name" href={task.item.url} target="_top" rel="noreferrer" title={task.effectiveTitle}>
          {task.effectiveTitle}
        </a>

        {outlineLine !== null && (
          <span class="fromoutline" title={`From your course outline: "${outlineLine}"`}>
            From course outline
          </span>
        )}

        {task.completionConflict && (
          <div class="conflict">LEARN shows a submission, but you marked this not done.</div>
        )}
      </div>

      {!done && (
        <span class={`pill ${tone}`}>
          {formatDueShort(task.effectiveDueAt, now, task.item.isAllDay)}
        </span>
      )}
    </div>
  );
}

export type EmptyCopy = { line: string; sub: string | null };

export function Empty({ copy }: { copy: EmptyCopy }) {
  return (
    <div class="empty">
      <div class="big" aria-hidden="true">
        &#10003;
      </div>
      <div class="emptyline">{copy.line}</div>
      {copy.sub !== null && <div class="sub">{copy.sub}</div>}
    </div>
  );
}

type FilterProps = {
  courses: readonly Course[];
  selected: string | null;
  onSelect: (courseId: string | null) => void;
};

/**
 * One chip per course, in its colour. Tapping one shows only that course;
 * tapping it again, or "All", shows everything.
 *
 * Folded to a single sideways-scrolling row by default, so eight courses do
 * not push the list half a screen down. The + at the end opens them all.
 * A chosen course jumps to the front, so it is never scrolled out of sight.
 */
export function CourseFilter({ courses, selected, onSelect }: FilterProps) {
  const [open, setOpen] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  const rowRef = useRef<HTMLDivElement>(null);

  // Which way the row can still scroll, so the arrows only show when useful.
  const measure = useCallback(() => {
    const row = rowRef.current;
    if (row === null) return;
    const left = row.scrollLeft > 2;
    const right = row.scrollLeft + row.clientWidth < row.scrollWidth - 2;
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    measure();
  }, [measure, courses.length, open, selected]);

  if (courses.length < 2) return null;

  const ordered =
    selected === null
      ? courses
      : [...courses.filter((c) => c.id === selected), ...courses.filter((c) => c.id !== selected)];

  const nudge = (dir: 1 | -1) => {
    rowRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

  return (
    <div class={open ? 'filterbar open' : 'filterbar'}>
      {!open && edges.left && (
        <button type="button" class="farrow" aria-label="Scroll courses left" onClick={() => nudge(-1)}>
          &#8249;
        </button>
      )}
      <div
        ref={rowRef}
        class={`filters${edges.left && !open ? ' fadeleft' : ''}${edges.right && !open ? ' faderight' : ''}`}
        role="toolbar"
        aria-label="Show one course"
        onScroll={measure}
        onWheel={(e) => {
          const row = e.currentTarget;
          if (open || e.deltaY === 0 || row.scrollWidth <= row.clientWidth) return;
          row.scrollLeft += e.deltaY;
          e.preventDefault();
        }}
      >
        <button
          type="button"
          class={selected === null ? 'fchip all on' : 'fchip all'}
          aria-pressed={selected === null}
          onClick={() => onSelect(null)}
        >
          All courses
        </button>
        {ordered.map((c) => (
          <button
            type="button"
            key={c.id}
            class={selected === c.id ? 'fchip on' : 'fchip'}
            aria-pressed={selected === c.id}
            title={c.name}
            style={colorVars(c.id)}
            onClick={() => onSelect(selected === c.id ? null : c.id)}
          >
            <span class="fdot" aria-hidden="true" />
            {shortCourseLabel(c.code, c.name)}
          </button>
        ))}
      </div>
      {!open && edges.right && (
        <button type="button" class="farrow" aria-label="Scroll courses right" onClick={() => nudge(1)}>
          &#8250;
        </button>
      )}
      <button
        type="button"
        class="fmore"
        aria-expanded={open}
        aria-label={open ? 'Show fewer courses' : `Show all ${courses.length} courses`}
        title={open ? 'Show fewer' : 'Show all courses'}
        onClick={() => setOpen(!open)}
      >
        {open ? '−' : '+'}
      </button>
    </div>
  );
}
