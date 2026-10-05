/**
 * Builds the dev-only panel preview (scripts/preview/entry.tsx) into a folder
 * with an index.html, for screenshots. Not part of the extension build.
 *
 *   node scripts/preview.mjs <outDir>
 *
 * Then serve <outDir> with any static server and open index.html
 * (add ?state=dock for the minimized disc).
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'preview-out');
const src = (p) => resolve('src', p);

mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['scripts/preview/entry.tsx'],
  bundle: true,
  format: 'esm',
  outfile: resolve(out, 'preview.js'),
  jsx: 'automatic',
  jsxImportSource: 'preact',
  loader: { '.css': 'text' },
  define: {
    __BUILD_ID__: JSON.stringify('preview'),
    __LEARN_ORIGIN__: JSON.stringify('https://learn.uwaterloo.ca'),
    __DEV_TOOLS__: 'false',
  },
  alias: {
    '@core': src('core'),
    '@shared': src('shared'),
    '@storage': src('storage'),
    '@sync': src('sync'),
    '@platform': src('platform'),
    '@d2l': src('d2l'),
  },
  logLevel: 'warning',
});

writeFileSync(
  resolve(out, 'index.html'),
  `<!doctype html><html><head><meta charset="utf-8"><title>Panel preview</title>
<style>body{margin:0;padding:24px;background:#d9d6cf;font-family:system-ui}</style></head>
<body><div id="host"></div><script type="module" src="preview.js"></script></body></html>`,
);

console.log(`preview built in ${out}`);
