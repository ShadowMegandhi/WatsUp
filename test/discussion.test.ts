import { describe, it, expect } from 'vitest';
import { hasMyPost, normalizeDiscussionTopics, splitDiscussionSourceId } from '@core/normalize/discussion';

const ORIGIN = 'https://learn.uwaterloo.ca';
const NOW = Date.UTC(2026, 9, 11);

const topic = (over: Record<string, unknown>) => ({
  ForumId: 12,
  TopicId: 456,
  Name: 'The Stanley Parable and Professionalism',
  StartDate: '2026-10-05T04:00:00.000Z',
  EndDate: '2026-10-14T03:59:00.000Z',
  DueDate: '2026-10-14T03:59:00.000Z',
  IsHidden: false,
  ...over,
});

describe('normalizeDiscussionTopics', () => {
  it('turns a topic with a due date into a discussion item linked to its own page', () => {
    const [item] = normalizeDiscussionTopics([topic({})], '12', '1234', ORIGIN, NOW);
    expect(item?.kind).toBe('discussion');
    expect(item?.title).toBe('The Stanley Parable and Professionalism');
    expect(item?.dueAt).toBe(Date.UTC(2026, 9, 14, 3, 59));
    expect(item?.availableFrom).toBe(Date.UTC(2026, 9, 5, 4, 0));
    expect(item?.id).toBe('learn:1234:discussion:12/456');
    expect(item?.sources[0]?.system).toBe('discussion');
    expect(item?.url).toBe('https://learn.uwaterloo.ca/d2l/le/1234/discussions/topics/456/View');
    expect(item?.learnCompleted).toBe(false);
  });

  it('treats a close date as the deadline when no due date is set', () => {
    const [item] = normalizeDiscussionTopics([topic({ DueDate: null })], '12', '1234', ORIGIN, NOW);
    expect(item?.dueAt).toBeNull();
    expect(item?.endsAt).toBe(Date.UTC(2026, 9, 14, 3, 59));
  });

  it('leaves out topics with no deadline at all, and hidden ones', () => {
    const items = normalizeDiscussionTopics(
      [
        topic({ TopicId: 1, DueDate: null, EndDate: null }),
        topic({ TopicId: 2, IsHidden: true }),
        topic({ TopicId: 'nope' }),
        null,
      ],
      '12',
      '1234',
      ORIGIN,
      NOW,
    );
    expect(items).toEqual([]);
  });

  it('falls back to the forum it was fetched under when a row omits ForumId', () => {
    const [item] = normalizeDiscussionTopics([topic({ ForumId: undefined })], '12', '1234', ORIGIN, NOW);
    expect(item?.sources[0]?.sourceId).toBe('12/456');
    expect(splitDiscussionSourceId('12/456')).toEqual({ forumId: '12', topicId: '456' });
    expect(splitDiscussionSourceId('456')).toBeNull();
  });

  it('reads the paged envelope form too', () => {
    const items = normalizeDiscussionTopics({ Objects: [topic({})], Next: null }, '12', '1234', ORIGIN, NOW);
    expect(items).toHaveLength(1);
  });
});

describe('hasMyPost', () => {
  const posts = [{ PostingUserId: 777, Subject: 'hi' }, { PostingUserId: 888, Subject: 'yo' }];

  it('is true only when a post was written by the student', () => {
    expect(hasMyPost(posts, '888')).toBe(true);
    expect(hasMyPost(posts, '999')).toBe(false);
  });

  it('claims nothing without a user id or without posts', () => {
    expect(hasMyPost(posts, null)).toBe(false);
    expect(hasMyPost([], '888')).toBe(false);
    expect(hasMyPost(null, '888')).toBe(false);
  });
});
