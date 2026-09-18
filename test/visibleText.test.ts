import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { visibleText, captureFromDocument } from '../src/portal/capture';

const docFrom = (html: string): Document =>
  new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;

/** Shaped like the Quest schedule table, which is where this went wrong. */
const QUEST_HTML = `
  <h2>MATH 101 - Linear Algebra (Eng)</h2>
  <table>
    <tr><th>Class Nbr</th><th>Section</th><th>Component</th><th>Days &amp; Times</th>
        <th>Room</th><th>Instructor</th><th>Start/End Date</th></tr>
    <tr><td>8162</td><td>011</td><td>LEC</td><td>MWF 10:30AM - 11:20AM</td>
        <td>RCH 100</td><td>Jordan Instructor</td><td>09/09/2026 - 10/20/2026</td></tr>
    <tr><td></td><td></td><td></td><td>W 2:30PM - 3:20PM</td>
        <td>RCH 300</td><td>Jordan Instructor</td><td>09/16/2026 - 09/16/2026</td></tr>
    <tr><td>6665</td><td>201</td><td>TST</td><td>M 8:00PM - 9:50PM</td>
        <td>TBA</td><td>To be Announced</td><td>10/26/2026 - 10/26/2026</td></tr>
  </table>
`;

describe('visibleText', () => {
  it('keeps a table row on one line', () => {
    // The bug: every cell became its own line, so no line held both a day
    // pattern and a date range, and a page full of schedule read as empty.
    const line = visibleText(docFrom(QUEST_HTML))
      .split('\n')
      .find((l) => l.includes('8162'));

    expect(line).toContain('MWF');
    expect(line).toContain('09/09/2026');
    expect(line).toContain('RCH 100');
  });

  it('separates cells so they do not run together', () => {
    const line = visibleText(docFrom(QUEST_HTML))
      .split('\n')
      .find((l) => l.includes('8162'));
    expect(line).toContain('|');
  });

  it('starts a new line for each row', () => {
    const lines = visibleText(docFrom(QUEST_HTML)).split('\n');
    expect(lines.filter((l) => l.includes('09/16/2026'))).toHaveLength(1);
    expect(lines.filter((l) => l.includes('10/26/2026'))).toHaveLength(1);
  });

  it('leaves script contents out', () => {
    const text = visibleText(docFrom('<p>Real</p><script>var hidden = 1;</script>'));
    expect(text).not.toContain('hidden');
    expect(text).toContain('Real');
  });

  it('keeps a heading on its own line', () => {
    const lines = visibleText(docFrom(QUEST_HTML)).split('\n');
    expect(lines[0]).toContain('MATH 101');
  });
});

describe('captureFromDocument on a Quest page', () => {
  const capture = captureFromDocument(docFrom(QUEST_HTML), Date.now());

  it('finds real sessions where it previously found none', () => {
    expect(capture.events.length).toBeGreaterThan(0);
  });

  it('places the one-off test on its stated day', () => {
    const test = capture.events.find((e) => e.kind === 'TST');
    expect(new Date(test?.startsAt ?? 0).getDate()).toBe(26);
    expect(new Date(test?.startsAt ?? 0).getMonth()).toBe(9);
  });

  it('attaches sessions to the course above them', () => {
    expect(capture.events.every((e) => e.courseCode === 'MATH 101')).toBe(true);
  });

  it('keeps the extra Wednesday alongside that day of the weekly block', () => {
    // 16 September carries two real meetings: the 10:30 MWF lecture, since
    // that Wednesday falls inside the weekly range, and the separate 2:30
    // session Quest lists on its own row. Both are true.
    const sept16 = capture.events
      .filter((e) => {
        const d = new Date(e.startsAt);
        return d.getMonth() === 8 && d.getDate() === 16;
      })
      .map((e) => new Date(e.startsAt).getHours())
      .sort((a, b) => a - b);

    expect(sept16).toEqual([10, 14]);
  });

  it('reports that it saw text', () => {
    expect(capture.sawText).toBe(true);
  });
});
