/**
 * Runs the Vite build targets in order, through the programmatic API.
 *
 * "main" emits the service worker, offscreen document and HTML pages as an ES
 * module graph. The content target then emits a single-file IIFE bundle,
 * because MV3 content scripts are not modules and cannot import chunks.
 *
 * The JS API is used rather than spawning the CLI: on Windows, spawning the
 * npx/vite .cmd shim fails with EINVAL unless a shell is involved, and Vite
 * does not export its bin path for a direct node invocation.
 */
import { build } from 'vite';

const mode = process.argv.includes('--dev') ? 'development' : 'production';
const watch = process.argv.includes('--watch');

const runTarget = async (target, contentEntry) => {
  const label = contentEntry === undefined ? target : `${target}:${contentEntry}`;
  console.log(`\n> building ${label} mode=${mode}`);

  process.env.BUILD_TARGET = target;
  if (contentEntry === undefined) delete process.env.CONTENT_ENTRY;
  else process.env.CONTENT_ENTRY = contentEntry;

  await build({ mode, ...(watch ? { build: { watch: {} } } : {}) });
};

// Order matters: "main" empties dist, so the content bundle follows it.
await runTarget('main');
await runTarget('content', 'learn');

console.log('\nOK - dist/ is ready. Load it unpacked at chrome://extensions');
