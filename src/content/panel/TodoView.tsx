/**
 * The To do tab: what is next, then everything open grouped by day.
 *
 * Overdue sits at the top in red rather than on a tab of its own, so it can
 * never be out of sight. Finished work folds away at the bottom.
 */

import { shortCourseLabel } from '@core/courseColor';
import type { ResolvedTask } from '@core/types';
import { colorVars } from './courseStyle';
import { countdown, KIND_LABEL, relativeDay, timeOf } from './format';
import { groupByDay, nextUpDay } from './groups';
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
  const next = searching ? [] : nextUpDay(tasks, now);
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
      {next.length > 0 && <NextUp tasks={next} now={now} />}

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

/** Everything due on the next day with anything due, one line each. */
function NextUp({ tasks, now }: { tasks: readonly ResolvedTask[]; now: number }) {
  const first = tasks[0];
  if (first === undefined) return null;
  const due = first.effectiveDueAt ?? now;

  return (
    <section class="nextup" aria-label="Next up">
      <div class="nhead">
        <span class="nlabel">Next up</span>
        <span class="nday">{relativeDay(due, now)}</span>
        {!first.item.isAllDay && <span class="ncount">{countdown(due, now)}</span>}
        {tasks.length > 1 && <span class="nnum">{tasks.length} due</span>}
      </div>
      {tasks.map((t) => (
        <a
          key={t.item.id}
          class="nitem"
          href={t.item.url}
          target="_top"
          rel="noreferrer"
          style={colorVars(t.course?.id ?? null)}
        >
          {t.course !== null && (
            <span class="course">{shortCourseLabel(t.course.code, t.course.name)}</span>
          )}
          <span class="ntitle" title={t.effectiveTitle}>
            {t.effectiveTitle}
            <span class="nkind">{KIND_LABEL[t.item.kind] ?? 'Item'}</span>
          </span>
          <span class="ntime">{timeOf(t.effectiveDueAt ?? now, t.item.isAllDay)}</span>
        </a>
      ))}
    </section>
  );
}
