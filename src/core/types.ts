/**
 * The domain model.
 *
 * One shape, TaskItem, represents everything the panel shows, whether it came
 * from a LEARN assignment folder, a LEARN quiz, or a line in a syllabus. Code
 * downstream of the normalizers never has to know which.
 *
 * Two rules hold throughout:
 *   - Instants are epoch milliseconds, never date strings.
 *   - Nothing is mutated. Updates return new objects.
 */

/** Stable across re-syncs. Contains only immutable facts, never a date. */
export type TaskId = string;

export type SourceSystem = 'dropbox' | 'quiz' | 'calendar' | 'syllabus' | 'manual';

export type TaskKind =
  | 'assignment'
  | 'quiz'
  | 'exam'
  | 'test'
  | 'lab'
  | 'project'
  | 'participation'
  | 'other';

export type TaskStatus = 'completed' | 'overdue' | 'upcoming' | 'undated';

/** Where a piece of information came from, so the UI can always show its work. */
export interface SourceRef {
  readonly system: SourceSystem;
  readonly sourceId: string;
  readonly url: string;
  readonly observedAt: number;
  /** For syllabus-derived items: the file and the exact line it was read from. */
  readonly detail?: {
    readonly fileName?: string;
    readonly page?: number;
    readonly rawLine?: string;
  };
}

export interface TaskItem {
  readonly id: TaskId;
  readonly courseId: string;
  readonly title: string;
  readonly kind: TaskKind;

  readonly dueAt: number | null;
  readonly availableFrom: number | null;
  readonly endsAt: number | null;
  readonly isAllDay: boolean;

  readonly weightPct: number | null;
  readonly url: string;
  readonly sources: readonly SourceRef[];

  /** Derived from LEARN alone. User input never touches this. */
  readonly learnCompleted: boolean;
  readonly learnCompletionEvidence: 'submission' | 'grade' | 'none';

  /** The LEARN grade item this work is marked under, when LEARN says so. */
  readonly gradeItemId?: string | null;

  /** 1.0 for anything LEARN told us; lower for syllabus readings. */
  readonly confidence: number;

  readonly contentHash: string;
  readonly firstSeenAt: number;
  readonly lastSyncedAt: number;
}

/**
 * User edits, kept in a separate storage namespace the sync engine cannot
 * write to. That separation is what makes a ticked checkbox survive a re-sync
 * that rebuilds every item from scratch.
 */
export interface TaskOverride {
  /** Tri-state on purpose: absent means defer to LEARN. */
  readonly completion?: 'done' | 'not-done';
  readonly dueAt?: number | null;
  readonly title?: string;
  readonly hidden?: boolean;
  readonly updatedAt: number;
}

export interface Course {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  /** Community shells carry no coursework and are hidden by default. */
  readonly looksAcademic: boolean;
  readonly url: string;
}

export interface CourseHealth {
  readonly courseId: string;
  readonly lastOkAt: number | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  /** What the syllabus pass did, in a sentence a student can act on. */
  readonly syllabusNote?: string | null;
  readonly syllabusItems?: number;
}

/**
 * One returned mark.
 *
 * Only what LEARN released is stored. A grade item with no value yet is not a
 * mark, and a zero the instructor has not released is not one either.
 */
export interface GradeEntry {
  /** Stable: course plus LEARN grade object id. */
  readonly id: string;
  readonly courseId: string;
  readonly gradeItemId: string;
  readonly name: string;
  readonly points: number | null;
  readonly outOf: number | null;
  /** 0-100, when LEARN gives enough to work it out. */
  readonly pct: number | null;
  /** Exactly what LEARN shows, e.g. "18 / 20" or "A". */
  readonly displayed: string;
  /** When it was released or last changed, whichever LEARN reports. */
  readonly returnedAt: number | null;
  readonly url: string;
}

/** The running course grade, present only when the instructor shows it. */
export interface CourseGrade {
  readonly courseId: string;
  readonly pct: number | null;
  readonly displayed: string;
  readonly updatedAt: number | null;
}

export type AuthState = 'ok' | 'needs-signin' | 'unknown';

export interface SyncState {
  readonly lastRunAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly authState: AuthState;
  readonly running: boolean;
  readonly partial: boolean;
}

export const emptySyncState: SyncState = {
  lastRunAt: null,
  lastSuccessAt: null,
  authState: 'unknown',
  running: false,
  partial: false,
};

/** A task plus everything the UI needs to render it, resolved once. */
export interface ResolvedTask {
  readonly item: TaskItem;
  readonly override: TaskOverride | null;
  readonly course: Course | null;
  readonly status: TaskStatus;
  readonly effectiveDueAt: number | null;
  readonly effectiveTitle: string;
  /** True when the user and LEARN disagree about completion. */
  readonly completionConflict: boolean;
}
