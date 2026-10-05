/**
 * "Add course outlines", in the Courses tab.
 *
 * Some instructors never put the outline in LEARN, so the tracker cannot find
 * it on its own. This section sends the student to the outline site already
 * searched for the course, and takes the link they copy back. From then on
 * the outline is read on every sync like one found in LEARN.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { shortCourseLabel } from '@core/courseColor';
import { MAX_LINKS_PER_COURSE, outlineSearchUrl, parseOutlineLink } from '@core/outlineLinks';
import type { Course, CourseHealth } from '@core/types';
import { readOutlineLinks, writeOutlineLinks, type OutlineLinks } from '@storage/store';
import { colorVars } from './courseStyle';

type OutlinesProps = {
  courses: readonly Course[];
  health: ReadonlyMap<string, CourseHealth>;
};

/** Whether the tracker already found an outline for this course by itself. */
const foundOnItsOwn = (h: CourseHealth | undefined): boolean =>
  h !== undefined && !(h.syllabusNote ?? '').includes('No syllabus found');

export function Outlines({ courses, health }: OutlinesProps) {
  const [links, setLinks] = useState<OutlineLinks>({});

  const reload = useCallback(async () => setLinks(await readOutlineLinks()), []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const missing = courses.filter(
    (c) => !foundOnItsOwn(health.get(c.id)) && (links[c.id] ?? []).length === 0,
  );
  // Decided once, so adding the last missing link does not snap it shut.
  const [startOpen] = useState(() => courses.some((c) => !foundOnItsOwn(health.get(c.id))));

  return (
    <details class="crow tools outlines" open={startOpen}>
      <summary class="name">
        Add course outlines
        {missing.length > 0 && <span class="flag syllabus">{missing.length} without one</span>}
      </summary>

      <ol class="steps">
        <li>
          Press <b>Find outline</b> beside a course. The outline site opens with that course
          searched (sign in if it asks).
        </li>
        <li>Open this term&rsquo;s outline and copy the link from the address bar.</li>
        <li>
          Paste it in the box and press <b>Add</b>. Its quizzes, tests and due dates show up after
          the next refresh, marked &ldquo;from syllabus&rdquo;.
        </li>
      </ol>

      {courses.map((course) => (
        <OutlineRow
          key={course.id}
          course={course}
          found={foundOnItsOwn(health.get(course.id))}
          links={links[course.id] ?? []}
          onSaved={reload}
        />
      ))}
    </details>
  );
}

type RowProps = {
  course: Course;
  found: boolean;
  links: readonly string[];
  onSaved: () => Promise<void>;
};

function OutlineRow({ course, found, links, onSaved }: RowProps) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const save = useCallback(
    async (next: readonly string[], done: string) => {
      const ok = await writeOutlineLinks(course.id, next);
      if (!ok) {
        setMessage({ text: 'Could not save. Try again.', bad: true });
        return;
      }
      await onSaved();
      setMessage({ text: done, bad: false });
      // Read it now rather than at the next scheduled sync. The worker may be
      // asleep; if so the next sync picks the link up anyway.
      chrome.runtime.sendMessage({ type: 'sync-now' }).catch(() => undefined);
    },
    [course.id, onSaved],
  );

  const add = useCallback(async () => {
    const check = parseOutlineLink(draft);
    if (!check.ok) {
      setMessage({ text: check.reason, bad: true });
      return;
    }
    if (links.includes(check.url)) {
      setMessage({ text: 'That link is already added.', bad: true });
      return;
    }
    if (links.length >= MAX_LINKS_PER_COURSE) {
      setMessage({ text: `Up to ${MAX_LINKS_PER_COURSE} links per course.`, bad: true });
      return;
    }
    setDraft('');
    await save([...links, check.url], 'Added. Reading it now…');
  }, [draft, links, save]);

  const label = shortCourseLabel(course.code, course.name);

  return (
    <div class="orow" style={colorVars(course.id)}>
      <div class="ohead">
        <span class="course">{label}</span>
        <span class={found || links.length > 0 ? 'ostate ok' : 'ostate'}>
          {links.length > 0 ? 'link added' : found ? 'found in LEARN' : 'no outline found'}
        </span>
        <a
          class="toolbtn ghost"
          href={outlineSearchUrl(course.code, course.name)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Find outline
        </a>
      </div>

      {links.map((url) => (
        <div class="olink" key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
            {url.replace(/^https:\/\//, '')}
          </a>
          <button
            type="button"
            class="oremove"
            aria-label={`Remove outline link for ${label}`}
            onClick={() => void save(links.filter((l) => l !== url), 'Removed.')}
          >
            &times;
          </button>
        </div>
      ))}

      <form
        class="oform"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          class="search"
          type="url"
          inputMode="url"
          placeholder="Paste outline link"
          aria-label={`Outline link for ${label}`}
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="toolbtn">
          Add
        </button>
      </form>

      {message !== null && <div class={message.bad ? 'conflict' : 'note'}>{message.text}</div>}
    </div>
  );
}
