/**
 * "Add your own": a date the outline and LEARN never put in writing.
 *
 * Folded to one button at the top of the To do list. Open, it asks for what
 * the work is, which course, the date, an optional time, and optionally
 * "every week until", for things like a weekly math test.
 */

import { useState } from 'preact/hooks';
import { shortCourseLabel } from '@core/courseColor';
import { buildCustomItems } from '@core/customItems';
import type { Course } from '@core/types';
import { addCustomItems } from '@storage/store';

type AddOwnProps = {
  courses: readonly Course[];
  now: number;
  onAdded: () => Promise<void>;
};

const isoDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function AddOwn({ courses, now, onAdded }: AddOwnProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState(() => isoDay(now));
  const [time, setTime] = useState('');
  const [weekly, setWeekly] = useState(false);
  const [until, setUntil] = useState('');
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const reset = (): void => {
    setTitle('');
    setTime('');
    setWeekly(false);
    setUntil('');
  };

  const save = async (): Promise<void> => {
    const course = courses.find((c) => c.id === courseId);
    const check = buildCustomItems(
      {
        title,
        courseId,
        courseUrl: course?.url ?? '',
        date,
        time,
        repeatUntil: weekly ? until : '',
      },
      Date.now(),
    );
    if (!check.ok) {
      setMessage({ text: check.reason, bad: true });
      return;
    }
    if (!(await addCustomItems(check.items))) {
      setMessage({ text: 'Could not save. Try again.', bad: true });
      return;
    }
    await onAdded();
    reset();
    setOpen(false);
    setMessage({
      text: check.items.length === 1 ? 'Added.' : `Added ${check.items.length} weekly dates.`,
      bad: false,
    });
  };

  if (!open) {
    return (
      <div class="addown">
        <button
          type="button"
          class="addbtn"
          onClick={() => {
            setMessage(null);
            setOpen(true);
          }}
        >
          + Add your own date
        </button>
        {message !== null && <span class={message.bad ? 'omsg bad' : 'omsg'}>{message.text}</span>}
      </div>
    );
  }

  return (
    <form
      class="addform"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="addhead">Add your own date</div>

      <label class="afield">
        <span>What is it?</span>
        <input
          class="oinput"
          type="text"
          placeholder="e.g. Math test"
          value={title}
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
      </label>

      <label class="afield">
        <span>Course</span>
        <select
          class="oinput"
          value={courseId}
          onChange={(e) => setCourseId((e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Pick a course</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {shortCourseLabel(c.code, c.name)}
            </option>
          ))}
        </select>
      </label>

      <div class="arow">
        <label class="afield">
          <span>Date</span>
          <input
            class="oinput"
            type="date"
            value={date}
            onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label class="afield">
          <span>Time (optional)</span>
          <input
            class="oinput"
            type="time"
            value={time}
            onInput={(e) => setTime((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      </div>

      <label class="acheck">
        <input
          type="checkbox"
          checked={weekly}
          onChange={(e) => setWeekly((e.currentTarget as HTMLInputElement).checked)}
        />
        Repeats every week
      </label>

      {weekly && (
        <label class="afield">
          <span>Until</span>
          <input
            class="oinput"
            type="date"
            value={until}
            onInput={(e) => setUntil((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
      )}

      {message !== null && <div class={message.bad ? 'omsg bad' : 'omsg'}>{message.text}</div>}

      <div class="oform aactions">
        <button
          type="button"
          class="obtn ghost"
          onClick={() => {
            setOpen(false);
            setMessage(null);
          }}
        >
          Cancel
        </button>
        <button type="submit" class="obtn">
          Add
        </button>
      </div>
    </form>
  );
}
