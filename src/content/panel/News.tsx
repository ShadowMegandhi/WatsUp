/**
 * The News tab: what instructors have posted, newest first.
 */

import { shortCourseLabel } from '@core/courseColor';
import type { Course } from '@core/types';
import type { Announcement } from '@core/normalize/news';
import { colorVars } from './courseStyle';


type NewsProps = {
  posts: readonly Announcement[];
  seen: ReadonlySet<string>;
  courses: ReadonlyMap<string, Course>;
  now: number;
};

/**
 * What instructors have posted, newest first.
 *
 * No checkbox and no due date: an announcement is something to read, and
 * giving it the shape of a task would put it in competition with real
 * deadlines for the same attention.
 */
export function News({ posts, seen, courses, now }: NewsProps) {
  if (posts.length === 0) {
    return (
      <div class="empty">
        <div class="big">&#10003;</div>
        <div>No announcements yet.</div>
        <div class="sub">New posts from your courses land here.</div>
      </div>
    );
  }

  return (
    <div class="section" style="padding-top:8px">
      {posts.map((post) => {
        const course = courses.get(post.courseId) ?? null;
        const isNew = !seen.has(post.id);

        return (
          <a
            class={isNew ? 'post new' : 'post'}
            key={post.id}
            href={post.url}
            target="_top"
            rel="noreferrer"
            style={colorVars(post.courseId)}
          >
            <div class="posthead">
              {course !== null && (
                <span class="course">{shortCourseLabel(course.code, course.name)}</span>
              )}
              {isNew && <span class="flag new">new</span>}
              <span class="postwhen">{formatPosted(post.postedAt, now)}</span>
            </div>
            <div class="posttitle">{post.title}</div>
            {post.summary !== '' && <div class="postbody">{post.summary}</div>}
            <span class="postgo">Open in LEARN</span>
          </a>
        );
      })}
    </div>
  );
}

const formatPosted = (at: number | null, now: number): string => {
  if (at === null) return '';
  const days = Math.round((now - at) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
