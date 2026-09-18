/**
 * A real, dated meeting of a course component.
 *
 * Kept separate from the Portal parser so the placement logic depends on a
 * shape rather than on where that shape was read from. A session captured from
 * Quest, from Portal, or typed in by hand is the same fact.
 */

export interface DatedSession {
  readonly courseCode: string | null;
  readonly kind: string | null;
  readonly startsAt: number;
}
