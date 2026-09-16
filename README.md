# LEARN Tracker

A Chrome extension that pulls every assignment, quiz and deadline across all
your University of Waterloo LEARN courses into one place.

**Not affiliated with the University of Waterloo.**

## Status: Phase 1 of 10

The build order is in the plan. Phase 1 is the risk spike: it proves the whole
architecture is possible before anything is built on top of it.

The open question Phase 1 answers is whether an extension can read the Valence
API using nothing but your existing LEARN sign-in. Everything else assumes yes.

| Phase | What | State |
|---|---|---|
| 0 | Project skeleton, build, tests | done |
| 1 | Connection probe (cookie auth risk spike) | **done, needs your verification** |
| 2 | Core domain: items, status, merge, diff | next |
| 3 | Storage and the sync engine | |
| 4 | Dashboard with the six sections | |
| 5 | Popup, badge, notifications | |
| 6 | Background alarm sync | |
| 7 | Calendar view and grades | |
| 8 | Syllabus parser | |
| 9 | ICS export | |
| 10 | Hardening and store submission | |

## Try it

```
npm install
npm run build
```

Then in Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the `dist` folder
4. Open <https://learn.uwaterloo.ca> and sign in
5. Click the extension icon, then **Run probe**

Every step should show a green dot. Use **Copy report** at the bottom to grab
the full output.

### Reading the result

- **All green** - cookie auth works. The architecture holds.
- **Amber on step 1** - your LEARN session expired. Sign in and retry.
- **`Relay idle (Tier B)`** - no LEARN tab is open, so the probe used the
  background path instead. Worth testing both: open a LEARN tab for Tier A,
  close them all for Tier B. Tier B is expected to be less reliable, and
  knowing that now is the point of the spike.
- **Red on a per-course step only** - that course restricts an endpoint. Not
  fatal; the design isolates failures per course.

## How it works

The content script runs on `learn.uwaterloo.ca` and performs the actual fetches,
because there it runs in a genuine first-party context and your session cookie
is attached the way the browser always attaches it. It has no domain logic at
all - it is a dumb relay. The service worker decides what every response means
and is the single writer of state, so two open LEARN tabs cannot race.

The one trap worth knowing about: when a LEARN session expires, the API does
**not** return 401. It redirects to ADFS, `fetch` follows the redirect, and you
get a 200 full of sign-in HTML. Code that trusts the status code will parse
that, fail, decide the API is broken, and retry forever. `src/d2l/authGuard.ts`
exists solely to catch this, and it is checked before anything else.

## Privacy

Nothing leaves your device. There is no server, no analytics, and no network
access beyond `learn.uwaterloo.ca` - that is the only host permission the
extension requests. Your data lives in `chrome.storage.local`.

## Commands

| | |
|---|---|
| `npm run build` | production build into `dist/` |
| `npm run dev` | rebuild on change |
| `npm test` | run the test suite |
| `npm run test:cov` | with coverage |
| `npm run typecheck` | types only |
