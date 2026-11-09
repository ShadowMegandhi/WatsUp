import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseOutlineLink, parseOutlineText, preparePaste, outlineSearchUrl } from '@core/outlineLinks';
import { syncSyllabus } from '@sync/syllabusSync';
import { fakeFetcher } from '@test/doubles/fakeFetcher';
import type { Course } from '@core/types';

describe('parseOutlineLink', () => {
  it('accepts an outline site link', () => {
    const r = parseOutlineLink('https://outline.uwaterloo.ca/viewer/view/12345');
    expect(r).toEqual({ ok: true, url: 'https://outline.uwaterloo.ca/viewer/view/12345' });
  });

  it('adds the scheme when it was not copied', () => {
    const r = parseOutlineLink('  outline.uwaterloo.ca/viewer/view/9 ');
    expect(r.ok && r.url).toBe('https://outline.uwaterloo.ca/viewer/view/9');
  });

  it('accepts a LEARN link and drops the #fragment', () => {
    const r = parseOutlineLink('https://learn.uwaterloo.ca/d2l/le/content/1/viewContent/2/View#top');
    expect(r.ok && r.url).toBe('https://learn.uwaterloo.ca/d2l/le/content/1/viewContent/2/View');
  });

  it('refuses any other site, which the extension has no access to', () => {
    expect(parseOutlineLink('https://example.com/outline.pdf').ok).toBe(false);
  });

  it('refuses a javascript: link', () => {
    expect(parseOutlineLink('javascript:alert(1)').ok).toBe(false);
  });

  it('refuses an empty box', () => {
    expect(parseOutlineLink('   ').ok).toBe(false);
  });
});

describe('outlineSearchUrl', () => {
  it('searches the outline site for the course code', () => {
    expect(outlineSearchUrl('ENGR151_instr_1269', '')).toBe(
      'https://outline.uwaterloo.ca/viewer/?q=ENGR%20151',
    );
  });
});

describe('syncSyllabus with a pasted link', () => {
  const course: Course = {
    id: '100013',
    name: 'ENGR151',
    code: 'ENGR151_instr_1269',
    looksAcademic: true,
    url: 'https://learn.uwaterloo.ca/d2l/home/100013',
  };

  afterEach(() => vi.unstubAllGlobals());

  it('reads the linked outline when LEARN has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<table><tr><td>Mon Oct 19</td><td>Quiz 2</td></tr></table>')),
    );
    const fetcher = fakeFetcher([['/content/toc', { json: { Modules: [] } }]]);

    const r = await syncSyllabus(fetcher, course, '1.80', [], new Date(2026, 8, 10).getTime(), [
      'https://outline.uwaterloo.ca/viewer/view/1',
    ]);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((i) => i.title)).toEqual(['Quiz 2']);
    expect(r.value.items[0]?.kind).toBe('quiz');
  });

  it('still says no syllabus when there is no link either', async () => {
    const fetcher = fakeFetcher([['/content/toc', { json: { Modules: [] } }]]);
    const r = await syncSyllabus(fetcher, course, '1.80', [], Date.now());
    expect(r.ok && r.value.note).toBe('No syllabus found in this course.');
  });
});

describe('parseOutlineText', () => {
  it('keeps line breaks and tabs, which hold the table together', () => {
    const r = parseOutlineText('  Quiz 3\tNov 13\r\nTask 2\tNov 20  ');
    expect(r).toEqual({ ok: true, text: 'Quiz 3\tNov 13\nTask 2\tNov 20' });
  });

  it('refuses an empty paste', () => {
    expect(parseOutlineText('   ').ok).toBe(false);
  });

  it('points a pasted link to the link box', () => {
    const r = parseOutlineText('https://outline.uwaterloo.ca/viewer/view/9');
    expect(!r.ok && r.reason).toContain('link box');
  });

  it('refuses something far too long to be an outline', () => {
    expect(parseOutlineText('x'.repeat(100_001)).ok).toBe(false);
  });
});

describe('syncSyllabus with pasted outline text', () => {
  const course: Course = {
    id: '100014',
    name: 'SYDE161',
    code: 'SYDE161_instr_1269',
    looksAcademic: true,
    url: 'https://learn.uwaterloo.ca/d2l/home/100014',
  };

  it('reads every dated item from text copied out of an outline table', async () => {
    const fetcher = fakeFetcher([['/content/toc', { json: { Modules: [] } }]]);
    const pasted = [
      'Assessment\tDate\tWeight',
      'Quiz 3\tNov 13\t5%',
      'Activity 4\tNov 6\t2%',
      'Task 2\tFriday, November 13\t10%',
    ].join('\n');

    const r = await syncSyllabus(fetcher, course, '1.80', [], new Date(2026, 8, 10).getTime(), [], pasted);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((i) => i.title)).toEqual(['Activity 4', 'Quiz 3', 'Task 2']);
    expect(r.value.docsRead).toBe(1);
    expect(r.value.items[0]?.sources[0]?.detail?.fileName).toBe('Your pasted outline');
  });
});

describe('preparePaste', () => {
  // What Chrome puts on the clipboard when a student copies an outline-site
  // table: real rows, cells holding several paragraphs, styling noise.
  const html =
    '<meta charset="utf-8"><style>td{color:red}</style>' +
    '<table class="multitable" style="width:100%"><tbody>' +
    '<tr><td><p>Week 7</p><p>Oct 19 - 23</p></td><td><p>Trusses</p></td><td><p>Quiz 2</p></td></tr>' +
    '<tr><td><p>Quiz 3</p></td><td><p>Friday,</p><p>November 13</p></td></tr>' +
    '</tbody></table><p>Quizzes are written on Mondays at 5:30</p><script>x()</script>';
  // The same copy as plain text: every paragraph on its own line.
  const text = 'Week 7\nOct 19 - 23\tTrusses\tQuiz 2\nQuiz 3\tFriday,\nNovember 13\nQuizzes are written on Mondays at 5:30';

  it('keeps the copied page markup, which holds each table row together', () => {
    const r = preparePaste(text, html);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain('<tr>');
    expect(r.text).not.toContain('style=');
    expect(r.text).not.toContain('x()');
  });

  it('falls back to plain text when the copy carries no markup', () => {
    expect(preparePaste('Quiz 3\tNov 13', '')).toEqual({ ok: true, text: 'Quiz 3\tNov 13' });
  });

  it('reads every quiz from the pasted markup, using the weekly rule', async () => {
    const course: Course = {
      id: '100015',
      name: 'SYDE151',
      code: 'SYDE151_instr_1269',
      looksAcademic: true,
      url: 'https://learn.uwaterloo.ca/d2l/home/100015',
    };
    const fetcher = fakeFetcher([['/content/toc', { json: { Modules: [] } }]]);
    const r = preparePaste(text, html);
    if (!r.ok) throw new Error(r.reason);

    const out = await syncSyllabus(fetcher, course, '1.80', [], new Date(2026, 8, 10).getTime(), [], r.text);
    if (!out.ok) throw new Error('sync failed');
    const seen = out.value.items.map((i) => {
      const d = new Date(i.dueAt ?? 0);
      return `${i.title} ${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    });
    expect(seen).toEqual(['Quiz 2 10/19 17:30', 'Quiz 3 11/13 23:59']);
  });
});
