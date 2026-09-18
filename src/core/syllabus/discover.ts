/**
 * Finding the syllabus inside a course content tree.
 *
 * Scored rather than matched on one keyword, because courses name the document
 * a dozen different ways and an outline from last term sitting in an archive
 * folder is worse than finding nothing.
 */

export interface TocTopic {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly typeIdentifier: string;
  readonly moduleTitle: string;
}

export interface ScoredTopic extends TocTopic {
  readonly score: number;
}

/** Below this a topic is not treated as a syllabus at all. */
export const SYLLABUS_THRESHOLD = 3;

/** How many documents to read per course, best first. */
export const MAX_DOCS_PER_COURSE = 3;

export const scoreTopic = (topic: TocTopic, now: number): number => {
  const t = topic.title.toLowerCase();
  const m = topic.moduleTitle.toLowerCase();
  let score = 0;

  if (/\b(course\s+)?(syllabus|outline)\b/.test(t)) score += 5;
  if (/course\s+(information|info|details)/.test(t)) score += 3;
  // Schedules often carry the assessment table even when the outline does not.
  if (/course\s+(schedule|calendar)/.test(t)) score += 3;
  if (/\b(outline|syllabus)\b/.test(m)) score += 2;
  if (/(start here|course info|overview|administration|assessment|evaluation)/.test(m)) score += 2;

  // Names seen in the wild that the first pass missed entirely.
  if (/\b(handbook|overview|expectations|important dates|key dates)\b/.test(t)) score += 3;
  if (/\b(assessment|evaluation|grading|deadlines|timetable)\b/.test(t)) score += 3;
  if (/\b(read me|start here|begin here)\b/.test(t)) score += 2;
  if (/\bwelcome\b/.test(t) && /\b(course|start)\b/.test(t)) score += 2;

  // A document sitting in an obviously introductory module is very often the
  // outline, whatever it happens to be called.
  if (/(welcome|admin|general|getting started)/.test(m)) score += 2;

  if (/\.(pdf|docx?)$/.test(t) || topic.typeIdentifier === 'Html') score += 2;
  if (/\b(revised|updated|v2)\b/.test(t)) score += 1;

  // A year that is not this academic year is a strong signal of an archive.
  const year = /\b(20\d\d)\b/.exec(t);
  if (year !== null) {
    const y = Number(year[1]);
    const current = new Date(now).getFullYear();
    score += y === current || y === current - 1 ? 1 : -4;
  }

  if (/\b(draft|old|previous|archive|archived|last year|sample|template)\b/.test(t)) score -= 4;
  if (topic.typeIdentifier === 'Link') score -= 1;
  if (/\.pptx?$/.test(t)) score -= 2;

  return score;
};

export const pickSyllabusTopics = (
  topics: readonly TocTopic[],
  now: number,
): readonly ScoredTopic[] => {
  const scored = topics
    .map((topic) => ({ ...topic, score: scoreTopic(topic, now) }))
    .filter((t) => t.score >= SYLLABUS_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // A course often lists the same outline in more than one module, and
  // fetching it twice costs a PDF download and a parse to learn nothing.
  const seen = new Set<string>();
  const unique: ScoredTopic[] = [];

  for (const topic of scored) {
    const key = `${topic.url}|${topic.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(topic);
    if (unique.length >= MAX_DOCS_PER_COURSE) break;
  }

  return unique;
};

/**
 * Flattens the nested content tree that LEARN returns.
 *
 * Written defensively: the shape varies between versions, and a course whose
 * tree is shaped unexpectedly should yield nothing rather than throw and take
 * the whole sync down with it.
 */
export const flattenToc = (json: unknown, learnOrigin: string, courseId: string): readonly TocTopic[] => {
  const out: TocTopic[] = [];

  const walk = (node: unknown, moduleTitle: string): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    const title = typeof n['Title'] === 'string' ? n['Title'] : moduleTitle;

    for (const topic of asList(n['Topics'])) {
      const t = topic as Record<string, unknown>;
      const id = t['TopicId'] ?? t['Identifier'] ?? t['Id'];
      if (id === undefined || id === null) continue;

      out.push({
        id: String(id),
        title: typeof t['Title'] === 'string' ? t['Title'] : '',
        url: topicUrl(t, learnOrigin, courseId, String(id)),
        typeIdentifier: typeof t['TypeIdentifier'] === 'string' ? t['TypeIdentifier'] : '',
        moduleTitle: title,
      });
    }

    for (const child of asList(n['Modules'])) walk(child, title);
  };

  walk(json, '');
  for (const child of asList((json as Record<string, unknown>)?.['Modules'])) walk(child, '');

  return out;
};

const asList = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

const topicUrl = (
  topic: Record<string, unknown>,
  learnOrigin: string,
  courseId: string,
  topicId: string,
): string => {
  const raw = topic['Url'];
  if (typeof raw === 'string' && raw !== '') {
    return raw.startsWith('http') ? raw : `${learnOrigin}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }
  return `${learnOrigin}/d2l/le/content/${courseId}/viewContent/${topicId}/View`;
};
