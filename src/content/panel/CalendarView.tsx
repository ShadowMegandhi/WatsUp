/**
 * The Calendar tab: the shape of the month, then the chosen day's list.
 *
 * Each day shows one dot per item in its course's colour, rather than
 * truncated titles that no one can read at this size. A red dot means late;
 * today has a gold ring. The list below the grid says what the dots are.
 */

import { useMemo } from 'preact/hooks';
import { buildMonth, byDay, WEEKDAY_LABELS, type DayCell } from '@core/calendar';
import type { ResolvedTask } from '@core/types';
import { colorVars } from './courseStyle';
import { Row } from './Row';

/** How many dots fit in a cell before the rest become "+n". */
const DOTS_PER_DAY = 4;

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

export function CalendarView({
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
    <div class="cal">
      <div class="calhead">
        <button type="button" class="calnav" aria-label="Previous month" onClick={() => onMove(-1)}>
          &#8249;
        </button>
        <span class="calmonth">{view.label}</span>
        <button type="button" class="calnav" aria-label="Next month" onClick={() => onMove(1)}>
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
          <p class="hint">Tap a day to see what&rsquo;s due.</p>
        ) : (
          <>
            <h3 class="ghead">
              <span class="glabel">{heading}</span>
              <span class="gcount">{dayTasks.length}</span>
            </h3>
            {dayTasks.length === 0 ? (
              <p class="hint">Nothing due this day.</p>
            ) : (
              dayTasks.map((t) => (
                <Row key={t.item.id} task={t} isNew={newIds.has(t.item.id)} now={now} onToggle={onToggle} />
              ))
            )}
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
  const shown = list.slice(0, DOTS_PER_DAY);
  const hidden = list.length - shown.length;

  const classes = [
    'day',
    cell.inMonth ? '' : 'out',
    cell.isToday ? 'today' : '',
    selected ? 'sel' : '',
    list.some((t) => t.status === 'overdue') ? 'late' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');

  const label =
    list.length === 0
      ? `${cell.dayOfMonth}, nothing due`
      : `${cell.dayOfMonth}, ${list.length} due: ${list.map((t) => t.effectiveTitle).join(', ')}`;

  return (
    <button type="button" class={classes} onClick={onSelect} aria-label={label} aria-pressed={selected}>
      <span class="dnum">{cell.dayOfMonth}</span>
      {list.length > 0 && (
        <span class="dots">
          {shown.map((t) => (
            <span
              key={t.item.id}
              class={
                t.status === 'completed' ? 'dot done' : t.status === 'overdue' ? 'dot late' : 'dot'
              }
              style={colorVars(t.course?.id ?? null)}
              title={t.effectiveTitle}
            />
          ))}
          {hidden > 0 && <span class="dotmore">+{hidden}</span>}
        </span>
      )}
    </button>
  );
}
