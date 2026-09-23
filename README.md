# LEARN Tracker

A Chrome extension that pulls every assignment, quiz and deadline across all your
University of Waterloo LEARN courses into one panel, right on the page.

**Not affiliated with, endorsed by, or connected to the University of Waterloo.**

## What it does

A collapsible panel sits on LEARN itself, with six views:

| | |
|---|---|
| **Assigned** | everything still due, soonest first |
| **Overdue** | what slipped past, so it stays visible |
| **Done** | what you have ticked off |
| **Calendar** | the term laid out by date |
| **News** | course announcements, newest first, with unread marks |
| **Courses** | per-course breakdown, each with its own colour |

It also reads your Quest schedule to match course names, parses syllabus PDFs for
assessment dates LEARN does not list (tutorial tests, midterms), and can export to
your calendar as `.ics`.

## Install

The extension is not on the Chrome Web Store yet, so it installs unpacked. This
takes about a minute.

1. Download **`learn-tracker.zip`** from the
   [latest release](../../releases/latest) and unzip it somewhere you will not
   delete by accident.
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and pick the unzipped folder
5. Open <https://learn.uwaterloo.ca> and sign in

Chrome will show a "Developer mode extensions" warning on startup. That is Chrome
telling you this extension did not come from the Web Store, which is true.

To update later, download the new zip, replace the folder contents, and click the
reload icon on the extension card. **Then refresh your LEARN tab** — Chrome does
not re-inject content scripts into tabs that are already open.

### From source

```
npm install
npm run build
```

Then load the `dist` folder with the steps above.

## Privacy

There is no server, no account, no analytics, and nothing is ever sent anywhere.
Your data stays in `chrome.storage.local` on your own machine.

The extension requests access to four UW hosts, and only these:

| Host | Why |
|---|---|
| `learn.uwaterloo.ca` | the assignments, quizzes and announcements themselves |
| `quest.pecs.uwaterloo.ca` | your course schedule, to match course names |
| `portal.uwaterloo.ca` | schedule data |
| `outline.uwaterloo.ca` | course outlines, for assessment dates LEARN omits |

It reads these using your existing sign-in, the same way the pages themselves do.
It never sees or stores your password.

## How it works

The content script runs on `learn.uwaterloo.ca` and performs the actual fetches,
because there it runs in a genuine first-party context and your session cookie is
attached the way the browser always attaches it. It has no domain logic at all —
it is a dumb relay. The service worker decides what every response means and is
the single writer of state, so two open LEARN tabs cannot race.

The one trap worth knowing about: when a LEARN session expires, the API does
**not** return 401. It redirects to ADFS, `fetch` follows the redirect, and you
get a 200 full of sign-in HTML. Code that trusts the status code will parse that,
fail, decide the API is broken, and retry forever. `src/d2l/authGuard.ts` exists
solely to catch this, and it is checked before anything else.

## Commands

| | |
|---|---|
| `npm run build` | production build into `dist/` |
| `npm run dev` | rebuild on change |
| `npm test` | run the test suite |
| `npm run test:cov` | with coverage |
| `npm run typecheck` | types only |
| `npm run lint` | eslint |
