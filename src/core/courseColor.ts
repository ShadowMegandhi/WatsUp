/**
 * One colour per course, assigned deterministically.
 *
 * Colour is the primary wayfinding device in this interface. A student thinks
 * in courses, not in assignment ids, so being able to glance at a month and
 * see which stripe is math is worth more than any amount of labelling. It is
 * the only saturated thing in the design, which keeps its meaning unambiguous.
 *
 * Derived from the course id rather than stored, so the same course keeps the
 * same colour across devices, reinstalls and sync order changes, with nothing
 * to migrate.
 */

export interface CourseColor {
  readonly ink: string;
  readonly fill: string;
  readonly edge: string;
  readonly inkDark: string;
  readonly fillDark: string;
}

/**
 * Eight hues, spaced around the wheel and checked so the ink tone carries
 * enough contrast on its own fill in both themes. Reds are deliberately absent:
 * red means overdue here, and a course that happened to be red would fight it.
 */
const PALETTE: readonly CourseColor[] = [
  { ink: '#2F5FD0', fill: '#E8EEFC', edge: '#C6D6F7', inkDark: '#9CBBF5', fillDark: '#1B2740' },
  { ink: '#0E7C86', fill: '#E0F4F5', edge: '#B7E4E7', inkDark: '#6FD4DD', fillDark: '#0F2A2D' },
  { ink: '#8A5A00', fill: '#FBF0DC', edge: '#F0DCAF', inkDark: '#E8B95C', fillDark: '#2E2413' },
  { ink: '#7A3E9D', fill: '#F3EAFA', edge: '#DFC8F0', inkDark: '#C79BE8', fillDark: '#261A33' },
  { ink: '#1F7A4D', fill: '#E3F5EB', edge: '#BCE5CE', inkDark: '#74D3A0', fillDark: '#13291F' },
  { ink: '#A8456B', fill: '#FBE9F0', edge: '#F2C9DA', inkDark: '#EC9BBA', fillDark: '#301823' },
  { ink: '#4A5A8F', fill: '#EBEEF8', edge: '#CBD3EC', inkDark: '#A8B6E4', fillDark: '#1E2338' },
  { ink: '#0F6FA8', fill: '#E2F0FA', edge: '#B9DCF1', inkDark: '#7EC5EC', fillDark: '#122836' },
];

export const colorFor = (courseId: string): CourseColor => {
  let h = 2166136261;
  for (let i = 0; i < courseId.length; i += 1) {
    h ^= courseId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return PALETTE[h % PALETTE.length] as CourseColor;
};

export const PALETTE_SIZE = PALETTE.length;

/**
 * A short label for a course, for places too tight for the full name.
 * Prefers the subject and number out of a code like ECE106_F26, since that is
 * what a student actually calls the course.
 */
export const shortCourseLabel = (code: string, name: string): string => {
  const source = code.trim() !== '' ? code : name;
  const match = /([A-Za-z]{2,6})[ _-]?([0-9]{2,4}[A-Za-z]?)/.exec(source);
  if (match !== null) return `${(match[1] ?? '').toUpperCase()} ${match[2] ?? ''}`.trim();
  return source.length > 14 ? `${source.slice(0, 13)}\u2026` : source;
};
