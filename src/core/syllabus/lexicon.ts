/**
 * The vocabulary the extractor recognises.
 *
 * Kept as data rather than scattered conditionals, because tuning a table is
 * reviewable and tuning conditionals is not.
 *
 * The governing rule, from the person who asked for this: do not assume. In a
 * weekly schedule table most dated rows are lecture topics, not assessments,
 * so a date alone is never enough. A row has to name something gradeable
 * before it can become an item.
 */

/** Names a thing that is marked. Required for a row to be considered at all. */
export const ASSESSMENT_TERMS: readonly string[] = [
  'midterm',
  'mid-term',
  'final exam',
  'final examination',
  'exam',
  'test',
  'term test',
  'tutorial test',
  'quiz',
  'assignment',
  'homework',
  'problem set',
  'lab',
  'lab report',
  'project',
  'milestone',
  'proposal',
  'presentation',
  'essay',
  'report',
  'deliverable',
  'checkpoint',
  'peer review',
  'participation',
];

/** Strengthens a row but never creates one on its own. */
export const SUPPORTING_TERMS: readonly string[] = [
  'due',
  'deadline',
  'submit',
  'submission',
  'hand in',
  'worth',
  'weight',
  'graded',
  'marked',
  'in tutorial',
  'in class',
  'in lecture',
];

/**
 * Hard vetoes. Any of these in the same row and the row is dropped outright,
 * whatever else it contains.
 *
 * Every entry here is a real false positive class: term breaks, registrar
 * deadlines that are not coursework, logistics, and course metadata. Between
 * them they account for most of what a naive date scan would wrongly surface.
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
export const LEXICON_VERSION = 1;
