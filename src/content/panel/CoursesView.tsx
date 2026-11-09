/**
 * The Courses tab: one card per course, in its colour.
 *
 * Each card says how much is on the list for that course and whether its
 * outline was found. When it was not, the fix is right there in the card:
 * find the outline on the outline site, paste its link, done. Or paste the
 * outline's text itself, for an outline no link reaches. From then on the
 * outline is read on every sync like one found in LEARN.
 *
 * Exists because an empty syllabus result and a syllabus that was never found
 * look identical from the outside, and a student who cannot tell which
 * happened has no way to know whether to trust the list.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { shortCourseLabel } from '@core/courseColor';
import {
  MAX_LINKS_PER_COURSE,
  outlineSearchUrl,
  parseOutlineLink,
  preparePaste,
} from '@core/outlineLinks';
import type { Course, CourseHealth, ResolvedTask } from '@core/types';
import {
  readOutlineLinks,
  readOutlineTexts,
  writeOutlineLinks,
  writeOutlineText,
  type OutlineLinks,
  type OutlineTexts,
} from '@storage/store';
import { colorVars } from './courseStyle';
import { Empty } from './Row';

type CoursesProps = {
  courses: readonly Course[];
  health: readonly CourseHealth[];
  tasks: readonly ResolvedTask[];
  helpOpen: boolean | null;
  onHelpOpen: (open: boolean) => void;
  showOther: boolean;
  onShowOther: (show: boolean) => void;
  diagnostics: () => string;
};

/** Whether the tracker already found an outline for this course by itself. */
const foundOnItsOwn = (h: CourseHealth | undefined): boolean =>
  h !== undefined && !(h.syllabusNote ?? '').includes('No syllabus found');

export function CoursesView({
  courses,
  health,
  tasks,
  helpOpen,
  onHelpOpen,
  showOther,
  onShowOther,
  diagnostics,
}: CoursesProps) {
  const [links, setLinks] = useState<OutlineLinks>({});
  const [texts, setTexts] = useState<OutlineTexts>({});
  const reload = useCallback(async () => {
    setLinks(await readOutlineLinks());
    setTexts(await readOutlineTexts());
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (courses.length === 0) {
    return <Empty copy={{ line: 'No courses loaded yet.', sub: 'Press refresh at the top to fetch them.' }} />;
  }

  const healthById = new Map(health.map((h) => [h.courseId, h]));
  const missing = courses.filter(
    (c) => !foundOnItsOwn(healthById.get(c.id)) && (links[c.id] ?? []).length === 0 && texts[c.id] === undefined,
  ).length;
  const open = helpOpen ?? missing > 0;

  return (
    <div class="courses">
      <section class={missing > 0 ? 'help warn' : 'help'}>
        <button type="button" class="helphdr" aria-expanded={open} onClick={() => onHelpOpen(!open)}>
          <span class="helpicon" aria-hidden="true">
            {missing > 0 ? '!' : '✓'}
          </span>
          <span class="helptitle">
            {missing > 0
              ? `${missing} ${missing === 1 ? 'course is' : 'courses are'} missing an outline`
              : 'All your course outlines are connected'}
          </span>
          <span class="ohint">{open ? 'Hide' : 'How?'}</span>
        </button>
        {open && (
          <ol class="steps">
            <li>
              On a course below, press <b>Find outline</b>. The outline site opens, already searched.
            </li>
            <li>Open this term&rsquo;s outline and copy the link from the address bar.</li>
            <li>
              Paste it into that course&rsquo;s box and press <b>Add</b>. Its quizzes and due dates appear
              in a moment.
            </li>
            <li>
              Still missing a quiz or due date? Open the outline, press <b>Ctrl+A</b> then <b>Ctrl+C</b>, and
              use <b>Paste the outline</b> on that course.
            </li>
          </ol>
        )}
      </section>

      {courses.map((course) => (
        <CourseCard
          key={course.id}
          course={course}
          health={healthById.get(course.id)}
          openCount={tasks.filter((t) => t.item.courseId === course.id && t.status !== 'completed').length}
          links={links[course.id] ?? []}
          pasted={texts[course.id] ?? null}
          fromOutline={tasks.filter(
            (t) => t.item.courseId === course.id && t.item.sources.some((s) => s.system === 'syllabus'),
          )}
          onSaved={reload}
        />
      ))}

      <label class="othertoggle">
        <input
          type="checkbox"
          checked={showOther}
          onChange={(e) => onShowOther((e.currentTarget as HTMLInputElement).checked)}
        />
        Also show clubs, residence and other non-course enrolments
      </label>

      <Troubleshoot diagnostics={diagnostics} />
    </div>
  );
}

type CardProps = {
  course: Course;
  health: CourseHealth | undefined;
  openCount: number;
  links: readonly string[];
  pasted: string | null;
  fromOutline: readonly ResolvedTask[];
  onSaved: () => Promise<void>;
};

const whenLabel = (t: ResolvedTask): string => {
  const at = t.effectiveDueAt ?? t.item.dueAt;
  if (at === null) return 'no date';
  const d = new Date(at);
  const day = d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  return t.item.isAllDay ? day : `${day}, ${d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' })}`;
};

/** Everything read from this course's outline, so a gap is easy to spot. */
function FoundList({ items }: { items: readonly ResolvedTask[] }) {
  const sorted = [...items].sort((a, b) => (a.item.dueAt ?? 0) - (b.item.dueAt ?? 0));
  return (
    <ul class="ofound">
      {sorted.map((t) => (
        <li key={t.item.id} title={t.item.sources.find((s) => s.system === 'syllabus')?.detail?.rawLine ?? ''}>
          <span class="ofname">{t.effectiveTitle}</span>
          <span class="ofwhen">{whenLabel(t)}</span>
        </li>
      ))}
    </ul>
  );
}

function CourseCard({ course, health, openCount, links, pasted, fromOutline: outlineItems, onSaved }: CardProps) {
  const found = foundOnItsOwn(health);
  const hasLink = links.length > 0;
  const hasPasted = pasted !== null;
  const [adding, setAdding] = useState(false);
  const [pasteFirst, setPasteFirst] = useState(false);
  const [showFound, setShowFound] = useState(false);
  const fromOutline = outlineItems.length;
  const label = shortCourseLabel(course.code, course.name);
  // LEARN names are often just the code again ("ENGR151_instr_1269").
  const fullName = /\s/.test(course.name.trim()) ? course.name : null;

  const status = hasLink
    ? { tone: 'ok', text: 'Outline link added' }
    : hasPasted
      ? { tone: 'ok', text: 'Outline text pasted' }
      : found
      ? { tone: 'ok', text: 'Outline found in LEARN' }
      : { tone: 'missing', text: 'No outline found yet' };

  return (
    <div class="ccard" style={colorVars(course.id)}>
      <div class="chead">
        <span class="course big">{label}</span>
        <a class="cname" href={course.url} target="_top" rel="noreferrer" title="Open in LEARN">
          {fullName ?? 'Open in LEARN'}
        </a>
      </div>

      <div class="cstats">
        <span>
          <b>{openCount}</b> to do
        </span>
        {fromOutline > 0 && (
          <button type="button" class="textbtn cfound" aria-expanded={showFound} onClick={() => setShowFound(!showFound)}>
            <b>{fromOutline}</b> {fromOutline === 1 ? 'date' : 'dates'} from outline &middot; {showFound ? 'hide' : 'see them'}
          </button>
        )}
      </div>

      {showFound && <FoundList items={outlineItems} />}

      <div class={`cstatus ${status.tone}`}>
        <span class="cicon" aria-hidden="true">
          {status.tone === 'ok' ? '✓' : '!'}
        </span>
        {status.text}
        {status.tone === 'ok' && !adding && (
          <button type="button" class="textbtn" onClick={() => setAdding(true)}>
            Add a link or text
          </button>
        )}
      </div>

      {(status.tone === 'missing' || hasLink || hasPasted || adding) && (
        <OutlineEditor
          course={course}
          label={label}
          links={links}
          pasted={pasted}
          startPasting={pasteFirst}
          onSaved={onSaved}
        />
      )}

      {status.tone === 'ok' && !hasPasted && !pasteFirst && (
        <div class="cbackup">
          Still missing something?
          <button
            type="button"
            class="textbtn"
            onClick={() => {
              setAdding(true);
              setPasteFirst(true);
            }}
          >
            Copy and paste the outline
          </button>
        </div>
      )}

      {health?.lastError != null && health.lastError !== '' && (
        <div class="conflict">{health.lastError}</div>
      )}
      {health?.syllabusNote != null && health.syllabusNote !== '' && status.tone !== 'missing' && (
        <div class="cnote">{health.syllabusNote}</div>
      )}
    </div>
  );
}

type EditorProps = {
  course: Course;
  label: string;
  links: readonly string[];
  pasted: string | null;
  /** Open with the paste box showing, from "Still missing something?". */
  startPasting?: boolean;
  onSaved: () => Promise<void>;
};

/**
 * Read it now rather than at the next scheduled sync. The worker may be
 * asleep; if so the next sync picks it up anyway.
 */
const readSoon = (): void => {
  chrome.runtime.sendMessage({ type: 'sync-now' }).catch(() => undefined);
};

function OutlineEditor({ course, label, links, pasted, startPasting = false, onSaved }: EditorProps) {
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const [pasting, setPasting] = useState(startPasting);
  const [textDraft, setTextDraft] = useState('');
  // The page markup that came with the last paste, which keeps table rows
  // whole. Cleared when the box is emptied.
  const [pastedHtml, setPastedHtml] = useState('');

  useEffect(() => {
    if (startPasting) setPasting(true);
  }, [startPasting]);

  const saveText = useCallback(
    async (text: string | null, done: string): Promise<boolean> => {
      const ok = await writeOutlineText(course.id, text);
      if (!ok) {
        setMessage({ text: 'Could not save. Try again.', bad: true });
        return false;
      }
      await onSaved();
      setMessage({ text: done, bad: false });
      readSoon();
      return true;
    },
    [course.id, onSaved],
  );

  const addText = useCallback(async () => {
    const check = preparePaste(textDraft, textDraft.trim() === '' ? '' : pastedHtml);
    if (!check.ok) {
      setMessage({ text: check.reason, bad: true });
      return;
    }
    // The draft is kept until it is safely stored: it can be a whole outline.
    if (!(await saveText(check.text, 'Saved. Reading it now…'))) return;
    setTextDraft('');
    setPastedHtml('');
    setPasting(false);
  }, [textDraft, pastedHtml, saveText]);

  const save = useCallback(
    async (next: readonly string[], done: string) => {
      const ok = await writeOutlineLinks(course.id, next);
      if (!ok) {
        setMessage({ text: 'Could not save. Try again.', bad: true });
        return;
      }
      await onSaved();
      setMessage({ text: done, bad: false });
      readSoon();
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

  return (
    <div class="oeditor">
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
        <a
          class="obtn ghost"
          href={outlineSearchUrl(course.code, course.name)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Find outline
        </a>
        <input
          class="oinput"
          type="url"
          inputMode="url"
          placeholder="Paste the outline link"
          aria-label={`Outline link for ${label}`}
          value={draft}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class="obtn">
          Add
        </button>
      </form>

      {pasted !== null && (
        <div class="olink">
          <span>{pasted.startsWith('<') ? 'Pasted outline (copied from a page)' : 'Pasted outline text'}</span>
          <button
            type="button"
            class="oremove"
            aria-label={`Remove pasted outline text for ${label}`}
            onClick={() => void saveText(null, 'Removed.')}
          >
            &times;
          </button>
        </div>
      )}

      {pasting ? (
        <form
          class="opaste"
          onSubmit={(e) => {
            e.preventDefault();
            void addText();
          }}
        >
          <textarea
            class="oinput otext"
            rows={5}
            placeholder="Open the outline, press Ctrl+A then Ctrl+C, and paste it here with Ctrl+V"
            aria-label={`Outline text for ${label}`}
            value={textDraft}
            onPaste={(e) => setPastedHtml(e.clipboardData?.getData('text/html') ?? '')}
            onInput={(e) => {
              const value = (e.currentTarget as HTMLTextAreaElement).value;
              setTextDraft(value);
              if (value.trim() === '') setPastedHtml('');
            }}
          />
          <div class="oform">
            <button type="button" class="obtn ghost" onClick={() => setPasting(false)}>
              Cancel
            </button>
            <button type="submit" class="obtn">
              {pasted === null ? 'Save' : 'Replace'}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" class="textbtn" onClick={() => setPasting(true)}>
          {pasted === null ? 'Or copy and paste the outline' : 'Paste it again'}
        </button>
      )}

      {message !== null && <div class={message.bad ? 'omsg bad' : 'omsg'}>{message.text}</div>}
    </div>
  );
}

/**
 * The two things worth doing when something looks wrong, folded away.
 *
 * A reset exists because a cache can hold an empty result and there is
 * otherwise no way to ask for another attempt. It keeps ticked-off state,
 * which cannot be rebuilt from anywhere.
 */
function Troubleshoot({ diagnostics }: { diagnostics: () => string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnostics());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be refused by the page. The reset button still works.
    }
  }, [diagnostics]);

  const reset = useCallback(async () => {
    setResetting(true);
    try {
      await chrome.runtime.sendMessage({ type: 'reset-and-sync' });
    } catch {
      // The worker may have been evicted; storage updates arrive either way.
    } finally {
      setTimeout(() => setResetting(false), 4000);
    }
  }, []);

  return (
    <section class="trouble">
      <button type="button" class="textbtn" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide troubleshooting' : 'Something look wrong?'}
      </button>
      {open && (
        <div class="troublebody">
          <p>Start fresh reads everything again from LEARN. Anything you ticked off stays ticked.</p>
          <div class="toolrow">
            <button type="button" class="obtn" onClick={reset} disabled={resetting}>
              {resetting ? 'Starting fresh…' : 'Start fresh'}
            </button>
            <button type="button" class="obtn ghost" onClick={copy}>
              {copied ? 'Copied' : 'Copy diagnostics'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
