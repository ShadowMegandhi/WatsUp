/**
 * Panel styles, injected into a shadow root.
 *
 * A shadow root is not decoration here. This markup lands inside a LEARN page
 * whose stylesheets are broad and unpredictable, and without isolation LEARN
 * would restyle the panel and the panel could restyle LEARN. Nothing here
 * leaks out and nothing gets in.
 *
 * All sizing is in px rather than rem, because rem would inherit whatever root
 * font size LEARN happens to set.
 */

export const PANEL_CSS = `
:host {
  all: initial;
}

*, *::before, *::after { box-sizing: border-box; }

.root {
  position: fixed;
  z-index: 2147483000;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #111827;
}

.panel {
  width: 370px;
  max-height: min(620px, calc(100vh - 40px));
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #d8dbe2;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

/* ---- header ---- */

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  background: #1c2030;
  color: #f3f4f6;
  cursor: grab;
  user-select: none;
  flex: none;
}
.head:active { cursor: grabbing; }

.mark {
  width: 16px; height: 16px; border-radius: 4px; flex: none;
  background: #e3b341;
  display: grid; place-items: center;
  color: #1c2030; font-size: 11px; font-weight: 800;
}

.title { font-weight: 650; letter-spacing: -0.01em; flex: 1; font-size: 13px; }

.count {
  background: #e3b341; color: #1c2030;
  border-radius: 999px; padding: 1px 8px;
  font-size: 11px; font-weight: 700; flex: none;
}
.count.zero { background: #3a4055; color: #cbd5e1; }

.iconbtn {
  all: unset;
  width: 24px; height: 24px; flex: none;
  display: grid; place-items: center;
  border-radius: 6px; cursor: pointer;
  color: #cbd5e1; font-size: 14px; line-height: 1;
}
.iconbtn:hover { background: rgba(255,255,255,0.12); color: #fff; }
.iconbtn:focus-visible { outline: 2px solid #e3b341; outline-offset: 1px; }
.iconbtn.spin { animation: spin 0.9s linear infinite; }

@keyframes spin { to { transform: rotate(360deg); } }

/* ---- toolbar ---- */

.toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; border-bottom: 1px solid #e8eaef;
  background: #fbfcfd; flex: none;
}

.search {
  all: unset;
  flex: 1; min-width: 0;
  padding: 5px 9px;
  border: 1px solid #d8dbe2; border-radius: 7px;
  background: #fff; font-size: 12px; color: #111827;
}
.search:focus { border-color: #b8860b; box-shadow: 0 0 0 2px rgba(184,134,11,0.15); }
.search::placeholder { color: #9aa1ad; }

.toggle {
  all: unset;
  padding: 4px 9px; border-radius: 999px; cursor: pointer;
  font-size: 11px; font-weight: 600;
  border: 1px solid #d8dbe2; color: #5b6472; background: #fff;
  white-space: nowrap;
}
.toggle:hover { border-color: #b3b9c4; }
.toggle[aria-pressed="true"] { background: #1c2030; border-color: #1c2030; color: #fff; }

/* ---- body ---- */

.body { overflow-y: auto; overscroll-behavior: contain; flex: 1; }

.section { border-bottom: 1px solid #eef0f4; }
.section:last-child { border-bottom: 0; }

.sechead {
  all: unset;
  display: flex; align-items: center; gap: 7px; width: 100%;
  padding: 7px 12px; cursor: pointer;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  color: #6b7280; background: #f7f8fa;
}
.sechead:hover { background: #f1f3f6; }
.sechead .n { font-weight: 600; color: #9aa1ad; letter-spacing: 0; text-transform: none; }
.sechead .chev { margin-left: auto; color: #9aa1ad; font-size: 10px; }
.sechead.overdue { color: #b42318; background: #fef4f2; }
.sechead.overdue:hover { background: #fdeae6; }

/* ---- task rows ---- */

.row {
  display: flex; gap: 9px; align-items: flex-start;
  padding: 9px 12px;
  border-top: 1px solid #f1f3f6;
}
.row:first-of-type { border-top: 0; }
.row:hover { background: #fafbfc; }
.row.done .name { text-decoration: line-through; color: #9aa1ad; }

.check {
  all: unset;
  width: 16px; height: 16px; flex: none; margin-top: 1px;
  border: 1.5px solid #c3c8d1; border-radius: 4px;
  cursor: pointer; display: grid; place-items: center;
  font-size: 11px; color: transparent; background: #fff;
}
.check:hover { border-color: #8a9099; }
.check:focus-visible { outline: 2px solid #b8860b; outline-offset: 1px; }
.check[aria-checked="true"] { background: #15803d; border-color: #15803d; color: #fff; }

.main { flex: 1; min-width: 0; }

.name {
  color: #111827; text-decoration: none; font-weight: 550;
  display: block; word-break: break-word;
}
.name:hover { color: #92400e; text-decoration: underline; }

.meta {
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  margin-top: 3px; font-size: 11px; color: #6b7280;
}

.tag {
  background: #eef1f5; color: #4b5563;
  border-radius: 4px; padding: 0 5px; font-weight: 600; font-size: 10px;
  white-space: nowrap;
}
.tag.kind { background: #e8eefb; color: #1e40af; }
.tag.syllabus { background: #fdf2e0; color: #92400e; }
.tag.new { background: #dcfce7; color: #166534; }

.due.soon { color: #b45309; font-weight: 650; }
.due.late { color: #b42318; font-weight: 650; }

.conflict { color: #92400e; font-size: 10.5px; margin-top: 2px; }

/* ---- states ---- */

.empty { padding: 26px 18px; text-align: center; color: #6b7280; }
.empty .big { font-size: 22px; margin-bottom: 6px; }

.banner {
  padding: 10px 12px; background: #fef4f2;
  border-bottom: 1px solid #f7d4cc; color: #b42318; flex: none;
}
.banner a { color: #b42318; font-weight: 650; }

.foot {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 12px; border-top: 1px solid #e8eaef;
  background: #fbfcfd; color: #8b93a1; font-size: 11px; flex: none;
}
.linkbtn {
  all: unset; cursor: pointer; color: #6b7280;
  text-decoration: underline; text-underline-offset: 2px;
}
.linkbtn:hover { color: #111827; }

/* ---- minimized pill ---- */

.pill {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 13px;
  background: #1c2030; color: #f3f4f6;
  border-radius: 999px; cursor: pointer; user-select: none;
  box-shadow: 0 6px 20px rgba(15,23,42,0.24);
  font-weight: 600; font-size: 12px;
  border: 0;
}
.pill:hover { background: #262b3d; }

@media (prefers-color-scheme: dark) {
  .panel { background: #14161d; border-color: #2a2f3c; }
  .root { color: #e5e7eb; }
  .toolbar, .foot { background: #181b24; border-color: #262b36; }
  .search { background: #0f1115; border-color: #2a2f3c; color: #e5e7eb; }
  .sechead { background: #181b24; color: #9aa1ad; }
  .sechead:hover { background: #1d212c; }
  .sechead.overdue { background: #2a1614; color: #f87171; }
  .row { border-color: #232834; }
  .row:hover { background: #1a1e27; }
  .name { color: #e5e7eb; }
  .name:hover { color: #e3b341; }
  .toggle { background: #14161d; border-color: #2a2f3c; color: #9aa1ad; }
  .toggle[aria-pressed="true"] { background: #e3b341; border-color: #e3b341; color: #1c2030; }
  .check { background: #0f1115; border-color: #3a4152; }
  .tag { background: #232834; color: #b9c0cc; }
  .tag.kind { background: #1c2740; color: #93b4f5; }
  .tag.syllabus { background: #2e2413; color: #e3b341; }
  .tag.new { background: #14321f; color: #6ee7a0; }
  .empty, .foot { color: #8b93a1; }
  .banner { background: #2a1614; border-color: #4a2521; color: #f87171; }
  .banner a { color: #f87171; }
}
`;
