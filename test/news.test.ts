import { describe, it, expect } from 'vitest';
import { normalizeNews, toPlainText } from '@core/normalize/news';

const ORIGIN = 'https://learn.uwaterloo.ca';

describe('toPlainText', () => {
  it('strips markup a course wrote', () => {
    // Rendering course-authored HTML would hand a course control over the
    // extension interface.
    expect(toPlainText('<p>Midterm <b>moved</b> to Friday</p>')).toBe('Midterm moved to Friday');
  });

  it('removes script contents entirely', () => {
    expect(toPlainText('<script>alert(1)</script>Real text')).toBe('Real text');
  });

  it('decodes the common entities', () => {
    expect(toPlainText('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  it('reads the Html wrapper D2L sometimes uses', () => {
    expect(toPlainText({ Html: '<p>Posted</p>' })).toBe('Posted');
  });

  it('truncates a long body', () => {
    const long = toPlainText('x'.repeat(400));
    expect(long.length).toBeLessThan(240);
    expect(long.endsWith('\u2026')).toBe(true);
  });

  it('returns empty for nothing usable', () => {
    expect(toPlainText(null)).toBe('');
  });
});

describe('normalizeNews', () => {
  const raw = [
    { Id: 12, Title: 'Midterm room change', Body: '<p>We move to RCH 100</p>', StartDate: '2026-09-15T14:00:00.000Z' },
    { Id: 13, Title: 'Welcome', Body: 'Hello', StartDate: '2026-09-01T14:00:00.000Z' },
  ];

  it('reads announcements', () => {
    expect(normalizeNews(raw, '100007', ORIGIN)).toHaveLength(2);
  });

  it('puts the newest first', () => {
    const news = normalizeNews(raw, '100007', ORIGIN);
    expect(news[0]?.title).toBe('Midterm room change');
  });

  it('links somewhere that exists, rather than a guessed news path', () => {
    // The first attempt invented a news-tool URL and produced an error page.
    // Course home is the one pattern already proven in this codebase.
    expect(normalizeNews(raw, '100007', ORIGIN)[0]?.url).toBe(
      'https://learn.uwaterloo.ca/d2l/home/100007',
    );
  });

  it('skips hidden posts', () => {
    const hidden = [{ Id: 9, Title: 'Draft', IsHidden: true }];
    expect(normalizeNews(hidden, '1', ORIGIN)).toHaveLength(0);
  });

  it('skips rows with no id rather than inventing one', () => {
    expect(normalizeNews([{ Title: 'orphan' }], '1', ORIGIN)).toHaveLength(0);
  });

  it('gives an untitled post a name instead of a blank row', () => {
    expect(normalizeNews([{ Id: 5, Title: '  ' }], '1', ORIGIN)[0]?.title).toBe('Announcement');
  });

  it('gives ids that stay stable across syncs', () => {
    const a = normalizeNews(raw, '100007', ORIGIN);
    const b = normalizeNews(raw, '100007', ORIGIN);
    expect(a.map((n) => n.id)).toEqual(b.map((n) => n.id));
  });

  it('returns nothing for a payload that is not a list', () => {
    expect(normalizeNews({ error: 'nope' }, '1', ORIGIN)).toHaveLength(0);
  });
});
