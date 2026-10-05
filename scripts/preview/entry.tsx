/**
 * Dev-only preview of the in-page panel, with made-up courses and deadlines.
 *
 * Not part of the extension: scripts/preview.mjs bundles this into a page
 * that can be opened in any browser and screenshotted, so the panel's look
 * can be checked without loading the extension into LEARN.
 *
 * `?state=dock` shows the minimized disc instead of the open panel.
 */

import { h, render } from 'preact';
import { Panel } from '../../src/content/panel/Panel';
import PANEL_CSS from '../../src/content/panel/panel.css';
import {
  writeCourses,
  writeHealth,
  writeItemsFor,
  writeMarksFor,
  writeNewsFor,
  writePanelPrefs,
  writeSeenIds,
  writeSyncState,
} from '../../src/storage/store';
import type { Course, TaskItem, TaskKind } from '../../src/core/types';

// --- an in-memory chrome, just enough for the panel ------------------------

const bag = new Map<string, unknown>();
const listeners = new Set<() => void>();

const local = {
  get: async (keys: string | string[] | null) => {
    if (keys === null) return Object.fromEntries(bag);
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((k) => bag.has(k)).map((k) => [k, bag.get(k)]));
  },
  set: async (entries: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(entries)) bag.set(k, v);
    listeners.forEach((l) => l());
  },
  remove: async (keys: string | string[]) => {
    for (const k of Array.isArray(keys) ? keys : [keys]) bag.delete(k);
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local,
    onChanged: {
      addListener: (l: () => void) => listeners.add(l),
      removeListener: (l: () => void) => listeners.delete(l),
    },
  },
  runtime: {
    sendMessage: async (msg: { type: string }) =>
      msg.type === 'get-hosts' ? { type: 'hosts', origins: [] } : { type: 'status', status: {} },
  },
};

// --- fixtures --------------------------------------------------------------

const now = Date.now();
const day = 86_400_000;
const at = (days: number, hour = 23, minute = 59): number => {
  const d = new Date(now + days * day);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
};

const course = (id: string, code: string, name: string): Course => ({
  id,
  code,
  name,
  looksAcademic: true,
  url: `https://learn.uwaterloo.ca/d2l/home/${id}`,
});

const COURSES: readonly Course[] = [
  course('100012', 'ENGR101_instr_1269', 'Engineering Design'),
  course('100013', 'ENGR151_instr_1269', 'ENGR151_instr_1269'),
  course('100008', 'MATH101_instr_1269', 'Linear Algebra'),
  course('100007', 'MATH102_instr_1269', 'Calculus 1'),
  course('100009', 'COMM101_instr_1269', 'Technical Communication'),
  course('100010', 'CS121_instr_1269', 'Intro to Programming'),
  course('100011', 'GEN100_instr_1269', 'Problem Solving Seminar'),
];

const item = (
  courseId: string,
  title: string,
  dueAt: number | null,
  kind: TaskKind = 'assignment',
  extra: Record<string, unknown> = {},
): TaskItem =>
  ({
    id: `${courseId}:${title}`,
    courseId,
    title,
    kind,
    dueAt,
    availableFrom: null,
    endsAt: null,
    isAllDay: false,
    weightPct: null,
    url: 'https://learn.uwaterloo.ca/',
    sources: [{ system: 'dropbox', sourceId: title, url: '', observedAt: now }],
    learnCompleted: false,
    learnCompletionEvidence: 'none',
    confidence: 1,
    contentHash: title,
    firstSeenAt: now,
    lastSyncedAt: now,
    ...extra,
  }) as unknown as TaskItem;

const fromOutline = (courseId: string, title: string, dueAt: number, kind: TaskKind, line: string): TaskItem =>
  item(courseId, title, dueAt, kind, {
    isAllDay: true,
    sources: [{ system: 'syllabus', sourceId: title, url: '', observedAt: now, detail: { rawLine: line } }],
  });

const ITEMS: Record<string, TaskItem[]> = {
  '100012': [
    item('100012', 'Design Journal Entry 4', at(-2), 'assignment'),
    fromOutline('100012', 'Quiz 2', at(0), 'quiz', 'Week 7 | Mon Oct 19 | Quiz 2'),
    item('100012', 'Studio Project Milestone 2: concept sketches and user research summary', at(5), 'project'),
  ],
  '100013': [
    fromOutline('100013', 'Unit 2 Tutorial Activity', at(4), 'assignment', 'Unit 2 - Tutorial activity | October 23rd'),
    fromOutline('100013', 'Unit 2 Quiz', at(11), 'quiz', 'Unit 2- Quiz | October 30th'),
  ],
  '100008': [item('100008', 'Assignment 4', at(0, 17, 0)), item('100008', 'Midterm', at(9, 19, 0), 'exam')],
  '100007': [
    item('100007', 'Problem Set 5', at(1, 11, 59)),
    item('100007', 'Problem Set 4', at(-6), 'assignment', {
      learnCompleted: true,
      learnCompletionEvidence: 'submission',
    }),
  ],
  '100009': [item('100009', 'Reflection Memo', at(3))],
  '100010': [item('100010', 'Lab 5: Arrays and loops', at(2, 14, 30), 'lab'), item('100010', 'Term Test 1', at(16, 18, 30), 'test')],
  '100011': [item('100011', 'Seminar worksheet', null, 'other')],
};

const seed = async () => {
  await writeCourses(COURSES);
  for (const c of COURSES) await writeItemsFor(c.id, ITEMS[c.id] ?? []);
  await writeSeenIds(Object.values(ITEMS).flat().map((i) => i.id).filter((id) => !id.includes('Quiz 2')));
  await writeSyncState({
    lastRunAt: now - 4 * 60_000,
    lastSuccessAt: now - 4 * 60_000,
    authState: 'ok',
    running: false,
    partial: false,
  });

  const healthy = (courseId: string, note: string | null, syllabusItems = 0) =>
    writeHealth({ courseId, lastOkAt: now, lastError: null, consecutiveFailures: 0, syllabusNote: note, syllabusItems });
  await healthy('100012', null, 5);
  await healthy('100013', null, 8);
  await healthy('100008', null, 4);
  await healthy('100007', null, 1);
  await healthy('100009', null, 4);
  await healthy('100010', null, 1);
  await healthy('100011', 'No syllabus found in this course.');

  await writeMarksFor('100008', {
    grades: [
      { id: 'g1', courseId: '100008', gradeItemId: '1', name: 'Assignment 2', points: 18, outOf: 20, pct: 90, displayed: '18 / 20', returnedAt: now - day, url: '' },
      { id: 'g2', courseId: '100008', gradeItemId: '2', name: 'Assignment 1', points: 17, outOf: 20, pct: 85, displayed: '17 / 20', returnedAt: now - 9 * day, url: '' },
    ],
    courseGrade: { courseId: '100008', pct: 87.5, displayed: '87.5 %', updatedAt: now },
  });
  await writeNewsFor('100012', [
    {
      id: 'n1',
      courseId: '100012',
      title: 'Quiz 2 room change',
      summary: 'Quiz 2 on Monday will be held in E7 4000 instead of the usual lecture hall. Bring a pencil.',
      postedAt: now - 3 * 3_600_000,
      url: '',
    },
  ]);

  const params = new URLSearchParams(location.search);
  await writePanelPrefs({ minimized: params.get('state') === 'dock', hidden: false });
};

const mount = async () => {
  await seed();
  const host = document.getElementById('host') as HTMLElement;
  const shadow = host.attachShadow({ mode: 'open' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(PANEL_CSS);
  shadow.adoptedStyleSheets = [sheet];
  const root = document.createElement('div');
  root.className = 'root';
  root.style.cssText = 'position: static;';
  shadow.appendChild(root);
  render(h(Panel, {}), root);
};

void mount();
