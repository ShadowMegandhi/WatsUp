# WatsUp Privacy Policy

_Last updated: 2026-11-03_

WatsUp is a Chrome extension that shows your University of Waterloo LEARN
deadlines, exams, marks and announcements in one place. It is not affiliated
with the University of Waterloo.

## What it collects

Nothing leaves your computer. WatsUp has no server, no account, no analytics and
no advertising, and it never transmits any data to the developer or to any third
party.

To do its job, the extension reads the following from pages and APIs you are
already signed in to:

| Host | What is read | Why |
|---|---|---|
| `learn.uwaterloo.ca` | assignments, quizzes, discussions, calendar events, marks, announcements | to list your deadlines, exams and marks |
| `outline.uwaterloo.ca` | course outlines | to find dated midterms and exams |

It reads these using your existing browser sign-in, the same way the pages
themselves do. It never sees, asks for or stores your password.

## Where the data is stored

Everything is kept in `chrome.storage.local` on your own machine. It is not
synced to any cloud service and is not shared with anyone. Uninstalling the
extension deletes it.

## Permissions

| Permission | Why |
|---|---|
| `storage` | keep your deadlines and marks between browser sessions |
| `alarms` | refresh in the background on a schedule |
| `offscreen` | read PDF and Word course outlines in a hidden document |
| access to `learn.uwaterloo.ca` and `outline.uwaterloo.ca` | the only two sites it reads from |

## Contact

Questions or concerns: open an issue at
<https://github.com/ShadowMegandhi/WatsUp/issues>.
