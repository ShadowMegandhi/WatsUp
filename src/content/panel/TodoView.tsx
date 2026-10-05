/**
 * The To do tab: what is next, then everything open grouped by day.
 *
 * Overdue sits at the top in red rather than on a tab of its own, so it can
 * never be out of sight. Finished work folds away at the bottom.
 */

import { shortCourseLabel } from '@core/courseColor';
import type { ResolvedTask } from '@core/types';
import { colorVars } from './courseStyle';
import { countdown, formatDueShort, KIND_LABEL } from './format';
import { groupByDay, nextUp } from './groups';
import { Empty, Row, type EmptyCopy } from './Row';

type TodoProps = {
  tasks: readonly ResolvedTask[];
  newIds: ReadonlySet<string>;
  now: number;
  searching: boolean;
  showCompleted: boolean;
  onShowCompleted: (show: boolean) => void;
  onToggle: (t: ResolvedTask) => void;
};

export function TodoView({
  tasks,
  newIds,
  now,
  searching,
  showCompleted,
  onShowCompleted,
  onToggle,
}: TodoProps) {
  const groups = groupByDay(tasks, now);
  const next = searching ? null : nextUp(tasks, now);
  const completed = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => (b.effectiveDueAt ?? 0) - (a.effectiveDueAt ?? 0));

  const empty: EmptyCopy = searching
    ? { line: 'Nothing matches that search.', sub: null }
    : { line: "You're all caught up.", sub: 'New work from LEARN and your outlines shows up here.' };

  const row = (t: ResolvedTask) => (
    <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
  );

  return (
    <div class="todo">
      {next !== null && <NextUp task={next} now={now} />}

      {groups.length === 0 && <Empty copy={empty} />}

      {groups.map((g) => (
        <section class="group" key={g.id}>
          <h3 class={`ghead ${g.tone}`}>
            <span class="glabel">{g.label}</span>
            {g.detail !== '' && <span class="gdetail">{g.detail}</span>}
            <span class="gcount">{g.tasks.length}</span>
          </h3>
          {g.tasks.map(row)}
        </section>
      ))}

      {completed.length > 0 && (
        <section class="group">
          <button
            type="button"
            class="donebtn"
            aria-expanded={showCompleted}
            onClick={() => onShowCompleted(!showCompleted)}
          >
            <span class="ochev" aria-hidden="true">
              {showCompleted ? '▾' : '▸'}
            </span>
            {showCompleted ? 'Hide completed' : 'Show completed'}
            <span class="gcount">{completed.length}</span>
          </button>
          {showCompleted && completed.map(row)}
        </section>
      )}
    </div>
  );
}

function NextUp({ task, now }: { task: ResolvedTask; now: number }) {
  const course = task.course;
  const due = task.effectiveDueAt ?? now;

  return (
    <a
      class="nextup"
      href={task.item.url}
      target="_top"
      rel="noreferrer"
      style={colorVars(course?.id ?? null)}
    >
      <span class="nlabel">Next up</span>
      <span class="ntitle">{task.effectiveTitle}</span>
      <span class="nmeta">
        {course !== null && <span class="course">{shortCourseLabel(course.code, course.name)}</span>}
        <span class="kind">{KIND_LABEL[task.item.kind] ?? 'Item'}</span>
      </span>
      <span class="nwhen">
        <span class="nday">{formatDueShort(due, now, task.item.isAllDay)}</span>
        {!task.item.isAllDay && <span class="ncount">{countdown(due, now)}</span>}
      </span>
    </a>
  );
}
