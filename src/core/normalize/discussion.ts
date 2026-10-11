/**
 * Discussion topics to TaskItems.
 *
 * A graded discussion is work with a deadline, but it lives in a tool the
 * Assignments and Quizzes routes never mention, which is how a post due on
 * the 13th went missing from a list that claimed to show everything.
 *
 * Only topics with a deadline become items. A topic with no due date and no
 * end date is a place to talk, not a task, and listing every Q&A forum as
 * "undated work" would bury the ones that count.
 *
 * Two dates matter, and as with quizzes they are not interchangeable. DueDate
 * is the deadline the instructor set; EndDate is when the topic locks. When
 * only EndDate exists it is the real deadline, because nothing can be posted
 * after it.
 */

import { contentHash, learnId } from '../ids';
import { parseUtcDateTime } from '@shared/time';
import { asArray, asString, kindFromTitle, numericId } from './dropbox';
import type { SourceRef, TaskItem } from '../types';

interface RawTopic {
  readonly TopicId?: unknown;
  readonly ForumId?: unknown;
  readonly Name?: unknown;
  readonly StartDate?: unknown;
  readonly EndDate?: unknown;
  readonly DueDate?: unknown;
  readonly IsHidden?: unknown;
}

interface RawPost {
  readonly PostingUserId?: unknown;
}

/** The topic's own page: the thread list with "Start a New Thread". */
export const deepLinkForTopic = (learnOrigin: string, courseId: string, topicId: string): string =>
  `${learnOrigin}/d2l/le/${courseId}/discussions/topics/${topicId}/View`;

/**
 * A topic is addressed by forum and topic together on every LEARN route, so
 * both are kept in the source id. Neither ever changes for a topic.
 */
export const discussionSourceId = (forumId: string, topicId: string): string => `${forumId}/${topicId}`;

export const splitDiscussionSourceId = (
  sourceId: string,
): { readonly forumId: string; readonly topicId: string } | null => {
  const [forumId, topicId] = sourceId.split('/');
  if (forumId === undefined || topicId === undefined || forumId === '' || topicId === '') return null;
  return { forumId, topicId };
};

export const normalizeDiscussionTopics = (
  json: unknown,
  forumId: string,
  courseId: string,
  learnOrigin: string,
  now: number,
): readonly TaskItem[] => {
  const out: TaskItem[] = [];

  for (const row of asArray(json)) {
    if (row === null || typeof row !== 'object') continue;
    const topic = row as RawTopic;
    const topicId = numericId(topic.TopicId);
    if (topicId === null) continue;
    if (topic.IsHidden === true) continue;

    const dueAt = parseUtcDateTime(asString(topic.DueDate));
    const endsAt = parseUtcDateTime(asString(topic.EndDate));
    if (dueAt === null && endsAt === null) continue;

    const title =
      typeof topic.Name === 'string' && topic.Name.trim() !== '' ? topic.Name.trim() : `Discussion ${topicId}`;
    const forum = numericId(topic.ForumId) ?? forumId;
    const sourceId = discussionSourceId(forum, topicId);
    const url = deepLinkForTopic(learnOrigin, courseId, topicId);
    const source: SourceRef = { system: 'discussion', sourceId, url, observedAt: now };

    out.push({
      id: learnId(courseId, 'discussion', sourceId),
      courseId,
      title,
      kind: kindFromTitle(title, 'discussion'),
      dueAt,
      availableFrom: parseUtcDateTime(asString(topic.StartDate)),
      endsAt,
      isAllDay: false,
      weightPct: null,
      url,
      sources: [source],
      learnCompleted: false,
      learnCompletionEvidence: 'none',
      confidence: 1,
      contentHash: contentHash([title, dueAt, endsAt, 'discussion']),
      firstSeenAt: now,
      lastSyncedAt: now,
    });
  }

  return out;
};

/**
 * Whether the student has posted in a topic, read from its post list.
 *
 * A discussion is done when the student has said something in it. A post
 * carries its author's user id, so the list is checked against the student's
 * own id from whoami. No id means no claim either way.
 */
export const hasMyPost = (json: unknown, userId: string | null): boolean => {
  if (userId === null) return false;
  return asArray(json).some(
    (row) => row !== null && typeof row === 'object' && numericId((row as RawPost).PostingUserId) === userId,
  );
};
