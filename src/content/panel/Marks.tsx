/**
 * The Marks tab: what has been graded and handed back.
 *
 * Newly returned marks lead, because "did anything come back?" is the reason
 * someone opens this tab. Below that, each course shows its marks with the
 * running course grade on top, but only when the instructor has made that
 * grade visible in LEARN. Nothing is calculated here that LEARN did not say.
 */

import { shortCourseLabel } from '@core/courseColor';
import type { Course, GradeEntry } from '@core/types';
import type { StoredMarks } from '@storage/store';
import { colorVars } from './courseStyle';

type MarksProps = {
  marks: ReadonlyMap<string, StoredMarks>;
  courses: readonly Course[];
  seen: ReadonlySet<string>;
  now: number;
};

export function Marks({ marks, courses, seen, now }: MarksProps) {
  const withMarks = courses.filter((c) => {
    const m = marks.get(c.id);
    return m !== undefined && (m.grades.length > 0 || m.courseGrade !== null);
  });

  if (withMarks.length === 0) {
    return (
      <div class="empty">
        <div class="big">&#10003;</div>
        <div>No marks returned yet.</div>
        <div class="sub">Grades appear here once an instructor releases them in LEARN.</div>
      </div>
    );
  }

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const fresh = withMarks
    .flatMap((c) => marks.get(c.id)?.grades ?? [])
    .filter((g) => !seen.has(g.id))
    .sort((a, b) => (b.returnedAt ?? 0) - (a.returnedAt ?? 0));

  return (
    <>
      {fresh.length > 0 && (
        <div class="section">
          <div class="sechead">
            <span>Just returned</span>
            <span class="n">{fresh.length}</span>
          </div>
          {fresh.map((g) => (
            <MarkRow key={g.id} grade={g} course={courseById.get(g.courseId) ?? null} isNew now={now} />
          ))}
        </div>
      )}

      {withMarks.map((course) => {
        const m = marks.get(course.id);
        if (m === undefined) return null;
        return (
          <div class="section" key={course.id} style={colorVars(course.id)}>
            <div class="sechead markcourse">
              <span>{shortCourseLabel(course.code, course.name)}</span>
              {m.courseGrade !== null ? (
                <span class="coursegrade" title="Course grade as shown in LEARN">
                  {m.courseGrade.pct !== null ? `${m.courseGrade.pct}%` : m.courseGrade.displayed}
                </span>
              ) : (
                <span class="n">course grade hidden</span>
              )}
            </div>
            {m.grades.map((g) => (
              <MarkRow key={g.id} grade={g} course={null} isNew={!seen.has(g.id)} now={now} />
            ))}
          </div>
        );
      })}
    </>
  );
}

type MarkRowProps = {
  grade: GradeEntry;
  /** Shown only where rows from several courses are mixed together. */
  course: Course | null;
  isNew: boolean;
  now: number;
};

function MarkRow({ grade, course, isNew, now }: MarkRowProps) {
  return (
    <a
      class="markrow"
      href={grade.url}
      target="_top"
      rel="noreferrer"
      style={colorVars(grade.courseId)}
    >
      <div class="main">
        <span class="name">{grade.name}</span>
        <div class="meta">
          {course !== null && (
            <span class="course">{shortCourseLabel(course.code, course.name)}</span>
          )}
          {isNew && <span class="flag new">new</span>}
          {grade.returnedAt !== null && (
            <span class="kind">returned {formatReturned(grade.returnedAt, now)}</span>
          )}
        </div>
      </div>
      <div class="markscore">
        <span class="markshown">{grade.displayed}</span>
        {grade.pct !== null && !grade.displayed.includes('%') && (
          <span class="markpct">{grade.pct}%</span>
        )}
      </div>
    </a>
  );
}

const formatReturned = (at: number, now: number): string => {
  const days = Math.round((now - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
