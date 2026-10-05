# WatsUp (LEARN Tracker)

*What's up at Waterloo.* A Chrome extension that pulls every assignment, quiz,
exam, returned mark and announcement across your University of Waterloo LEARN
courses, plus the dated work in your course outlines, into one panel right on
the LEARN page.

**Not affiliated with, endorsed by, or connected to the University of Waterloo.**

## What it does

A panel sits on LEARN itself (drag it anywhere, or shrink it to a small W
circle), with five tabs:

| | |
|---|---|
| **To do** | what is next, then everything open by day: Overdue, Today, Tomorrow, This week, Later |
| **Calendar** | the month at a glance, one coloured dot per item |
| **Marks** | grades as instructors release them, plus the course grade where it is shown |
| **News** | course announcements, newest first |
| **Courses** | each course in its own colour, whether its outline was found, and where to add it if not |

### Where items come from

Both LEARN and your course outlines:

1. **LEARN**: Assignments (Dropbox), Quizzes, and the course calendar.
2. **Course outlines** (a PDF or Word file in LEARN, the course Overview page, or
   outline.uwaterloo.ca): quizzes, tests, midterms, labs and other work that has a
   single, exact date written beside it. Anything vaguer ("midterm week", "during the
   exam period", "TBA") is left out. These are tagged *From course outline*, and
   hovering the tag shows the exact line they came from.

When LEARN and an outline both list the same thing, LEARN's copy wins, because its
dates are the live ones.

## Install

The extension is not on the Chrome Web Store yet, so it installs unpacked. This
takes about a minute.

1. Download **`watsup.zip`** from the
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

The extension requests access to two UW hosts, and only these:

| Host | Why |
|---|---|
| `learn.uwaterloo.ca` | assignments, quizzes, calendar exams, marks and announcements |
| `outline.uwaterloo.ca` | course outlines, read only for dated midterms and exams |

Earlier versions also read Quest and Portal. Since v0.3.0 they do not, and the
extension no longer asks for access to them.

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
