/**
 * The vocabulary the extractor recognises.
 *
 * Kept as data rather than scattered conditionals, because tuning a table is
 * reviewable and tuning conditionals is not.
 *
 * The governing rule, from the person who asked for this: do not assume. In a
 * weekly schedule table most dated rows are lecture topics, not assessments,
 * so a date alone is never enough.
 *
 * Since v0.4 the syllabus is read for any named assessment with a date
 * written on the same line: exams, tests, quizzes, assignments, labs,
 * projects, and since v0.5 activities, tasks, worksheets, exercises and the
 * like. Anything LEARN also reports is dropped in favour of LEARN's copy.
 */

import type { TaskKind } from '../types';

export interface AssessmentTerm {
  readonly term: string;
  readonly kind: TaskKind;
}

/**
 * Names an assessment. Required for a row to be considered at all.
 *
 * Singular, whole words only: "quizzes are weekly" describes a policy, while
 * "Quiz 3" names one quiz. Multi-word names win over the words inside them.
 */
export const ASSESSMENT_TERMS: readonly AssessmentTerm[] = [
  { term: 'final examination', kind: 'exam' },
  { term: 'final exam', kind: 'exam' },
  { term: 'midterm', kind: 'exam' },
  { term: 'mid-term', kind: 'exam' },
  { term: 'lab exam', kind: 'exam' },
  { term: 'exam', kind: 'exam' },
  { term: 'term test', kind: 'test' },
  { term: 'tutorial test', kind: 'test' },
  { term: 'test', kind: 'test' },
  { term: 'lab quiz', kind: 'quiz' },
  { term: 'tutorial quiz', kind: 'quiz' },
  { term: 'quiz', kind: 'quiz' },
  { term: 'assignment', kind: 'assignment' },
  { term: 'problem set', kind: 'assignment' },
  { term: 'homework', kind: 'assignment' },
  { term: 'essay', kind: 'assignment' },
  { term: 'reflection', kind: 'assignment' },
  { term: 'tutorial activity', kind: 'assignment' },
  { term: 'tutorial assignment', kind: 'assignment' },
  { term: 'lab report', kind: 'lab' },
  { term: 'lab', kind: 'lab' },
  { term: 'project', kind: 'project' },
  { term: 'proposal', kind: 'project' },
  { term: 'presentation', kind: 'project' },
  { term: 'report', kind: 'project' },
  { term: 'deliverable', kind: 'project' },
  { term: 'milestone', kind: 'project' },
  { term: 'checkpoint', kind: 'project' },
  { term: 'poster', kind: 'project' },
  { term: 'portfolio', kind: 'project' },
  { term: 'case study', kind: 'assignment' },
  { term: 'in-class activity', kind: 'assignment' },
  { term: 'lab activity', kind: 'lab' },
  { term: 'activity', kind: 'assignment' },
  { term: 'task', kind: 'assignment' },
  { term: 'worksheet', kind: 'assignment' },
  { term: 'exercise', kind: 'assignment' },
  { term: 'check-in', kind: 'assignment' },
  { term: 'journal', kind: 'assignment' },
  { term: 'peer review', kind: 'assignment' },
  { term: 'critique', kind: 'assignment' },
  { term: 'write-up', kind: 'assignment' },
  { term: 'discussion post', kind: 'discussion' },
];

/** "quiz" to "quizzes", "activity" to "activities", "case study" to "case studies". */
export const pluralOf = (term: string): string => {
  if (term.endsWith('quiz')) return `${term}zes`;
  if (/[^aeiou]y$/.test(term)) return `${term.slice(0, -1)}ies`;
  if (/(?:s|x|ch|sh)$/.test(term)) return `${term}es`;
  return `${term}s`;
};

/**
 * An assessment named as a class topic rather than a deadline: "Midterm
 * review", "Project introduction", "Quizzes: lectures Oct 2 and Oct 16".
 */
export const TOPIC_WORDS =
  /\b(?:review|introduction|intro|overview|kick-?off|briefing|info(?:rmation)? session|recap|feedback|solutions?|debrief|preparation|prep|workshop|lectures?|topics?)\b/i;

/**
 * Rows that name an assessment but do not date one. Each is a real pattern:
 * a window rather than a day, or a date the registrar has not set yet.
 */
export const WINDOW_TERMS: readonly string[] = [
  'exam period',
  'examination period',
  'exam schedule',
  'exam week',
  'midterm week',
  'week of',
  'registrar',
  'tba',
  'tbd',
  'to be announced',
  'to be determined',
  'conflict',
  'deferred',
];

/**
 * The date on the row is when something is handed out or returned, not when
 * it is due. "Assignment 3 released Oct 2" is not a deadline.
 */
export const NOT_A_DEADLINE_TERMS: readonly string[] = [
  'released',
  'release',
  'posted',
  'handed out',
  'returned',
  'solutions',
  'solution',
  'marks back',
];

/**
 * Hard vetoes. Any of these anywhere in a row and the row is dropped outright,
 * whatever else it contains: a break or a registrar date is never coursework.
 */
export const VETO_TERMS: readonly string[] = [
  // Breaks and holidays
  'no class',
  'no lecture',
  'no tutorial',
  'no lab',
  'cancelled',
  'canceled',
  'holiday',
  'reading week',
  'reading day',
  'study day',
  'thanksgiving',
  'family day',
  'good friday',
  'victoria day',
  'canada day',
  'civic holiday',
  'labour day',
  'remembrance day',
  'christmas',
  'winter break',
  'university closed',
  'no scheduled',

  // Registrar, not coursework
  'drop deadline',
  'last day to drop',
  'last day to add',
  'withdraw',
  'withdrawal',
  'add/drop',
  'tuition',
  'refund',
  'course selection',
  'enrolment deadline',
  'enrollment deadline',
];

/**
 * Logistics and course metadata. In a table row these veto only the cell
 * naming the assessment; elsewhere, the whole line. A grading table's
 * notes column ("submit through Turnitin", "contact AccessAbility for
 * accommodations") says nothing about whether the row is a deadline, and
 * vetoing the whole row on it dropped real quizzes and midterms.
 */
export const CONTEXT_VETO_TERMS: readonly string[] = [
  // Logistics
  'office hour',
  'office hours',
  'consultation hour',
  'help session',
  'drop-in',
  'by appointment',
  'instructor availability',

  // Metadata and policy
  'prerequisite',
  'antirequisite',
  'textbook',
  'isbn',
  'academic integrity',
  'policy 70',
  'policy 71',
  'policy 72',
  'accommodation',
  'accessability',
  'accessibility services',
  'mental health',
  'territorial acknowledgement',
  'grievance',
  'turnitin',
  'copyright',
  'learning outcome',
  'course description',
];

/** Marks something ungraded. Practice quizzes are not deadlines. */
export const UNGRADED_TERMS: readonly string[] = [
  'sample',
  'practice',
  'optional',
  'ungraded',
  'not graded',
  'no marks',
  'for practice',
  'self-test',
  'self test',
  'mock',
];

/**
 * Negation. "No quiz this week" must never produce a quiz, so an assessment
 * word preceded closely by one of these is dropped.
 */
export const NEGATION_TERMS: readonly string[] = [
  'no',
  'not',
  'none',
  'cancelled',
  'canceled',
  'postponed',
  'rescheduled from',
  'there is no',
];

/** Review sessions are lecture content, not the assessment they mention. */
export const REVIEW_PREFIXES: readonly string[] = [
  'review for',
  'review of',
  'prep for',
  'preparation for',
  'practice for',
  'q&a for',
];

/**
 * Bumped whenever the rules above change, so a shipped fix actually re-parses
 * documents already cached on an existing install. Forgetting this is why a
 * heuristics fix can appear to do nothing.
 */
export const LEXICON_VERSION = 10;
