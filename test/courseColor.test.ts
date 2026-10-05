import { describe, it, expect } from 'vitest';
import { colorFor, shortCourseLabel, PALETTE_SIZE, paletteSlots, assignCourseColors } from '@core/courseColor';

describe('colorFor', () => {
  it('gives the same course the same colour every time', () => {
    expect(colorFor('100001')).toBe(colorFor('100001'));
  });

  it('gives different courses different colours in the common case', () => {
    const ids = ['100001', '100002', '1201234', '1209876', '1300001'];
    const inks = new Set(ids.map((id) => colorFor(id).ink));
    expect(inks.size).toBeGreaterThan(1);
  });

  it('spreads a realistic course load across the palette', () => {
    const ids = Array.from({ length: 40 }, (_, i) => String(900000 + i * 1337));
    const used = new Set(ids.map((id) => colorFor(id).ink));
    expect(used.size).toBe(PALETTE_SIZE);
  });

  it('never returns undefined for an odd id', () => {
    expect(colorFor('').ink).toBeTruthy();
    expect(colorFor('a-very-unusual-id-\u00e9').ink).toBeTruthy();
  });

  it('carries a dark-theme pair for every entry', () => {
    const c = colorFor('100001');
    expect(c.inkDark).toMatch(/^#/);
    expect(c.fillDark).toMatch(/^#/);
  });
});

describe('shortCourseLabel', () => {
  it('pulls subject and number out of a LEARN course code', () => {
    expect(shortCourseLabel('ECE106_F26', 'Electricity and Magnetism')).toBe('ECE 106');
  });

  it('handles a code with no separator', () => {
    expect(shortCourseLabel('MATH135', 'Algebra')).toBe('MATH 135');
  });

  it('keeps a trailing section letter', () => {
    expect(shortCourseLabel('CS136L', 'Tools')).toBe('CS 136L');
  });

  it('falls back to the name when the code is empty', () => {
    expect(shortCourseLabel('', 'Residence Experience')).toBe('Residence Exp\u2026');
  });

  it('leaves a short plain name alone', () => {
    expect(shortCourseLabel('', 'Co-op')).toBe('Co-op');
  });
});

describe('paletteSlots', () => {
  it('gives every course its own colour while there are colours to go round', () => {
    const ids = ['100001', '100002', '100003', '100007', '100008', '100009', '100012'];
    const slots = paletteSlots(ids);
    expect(new Set(slots.values()).size).toBe(ids.length);
  });

  it('is stable whatever order the courses arrive in', () => {
    const a = paletteSlots(['3', '1', '2']);
    const b = paletteSlots(['2', '3', '1']);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('colorFor follows the assignment once one is made', () => {
    const ids = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8'];
    assignCourseColors(ids);
    expect(new Set(ids.map((id) => colorFor(id).ink)).size).toBe(8);
    assignCourseColors([]);
  });
});

describe('paletteSlots with more enrolments than colours', () => {
  it('keeps the courses with work due distinct, whatever else is enrolled', () => {
    const due = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
    const extra = ['res', 'whmis', 'coop', 'engrm'];
    const slots = paletteSlots(due, extra);
    expect(new Set(due.map((id) => slots.get(id))).size).toBe(8);
    expect(extra.every((id) => slots.has(id))).toBe(true);
  });
});
