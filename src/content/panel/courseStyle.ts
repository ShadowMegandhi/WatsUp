/**
 * Inline custom properties, so one course colour drives chip, tag and stripe
 * wherever a course appears in the panel.
 */

import { colorFor } from '@core/courseColor';

export const colorVars = (courseId: string | null): Record<string, string> => {
  if (courseId === null) return {};
  const c = colorFor(courseId);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  return {
    '--c-ink': dark ? c.inkDark : c.ink,
    '--c-fill': dark ? c.fillDark : c.fill,
    '--c-edge': dark ? c.inkDark : c.edge,
    '--stripe': dark ? c.inkDark : c.ink,
  };
};
