import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const r = (p: string) => resolve(__dirname, p);

/**
 * Two build targets share this config, selected by BUILD_TARGET:
 *
 *   "main"    ESM build for the service worker, offscreen document, popup and
 *             dashboard. Code splitting is fine here: the SW is declared
 *             `"type": "module"` and HTML pages load real module graphs.
 *
 *   "content" IIFE single-file build for the content script. MV3 content
 *             scripts are NOT modules and cannot import chunks, so this target
 *             must inline everything into one file.
 *
 * `npm run build` runs both in sequence (see scripts/build.mjs).
 */
const target = process.env.BUILD_TARGET ?? 'main';

const alias = {
  '@shared': r('src/shared'),
  '@core': r('src/core'),
  '@d2l': r('src/d2l'),
  '@storage': r('src/storage'),
  '@sync': r('src/sync'),
  '@platform': r('src/platform'),
  '@ui': r('src/ui'),
  '@test': r('test'),
};

export default defineConfig(({ mode }) => ({
  plugins: [preact()],
  resolve: { alias },
  define: {
    // Overridden by the E2E build so Playwright can point the extension at a
    // local fake LEARN server instead of the real one.
    __LEARN_ORIGIN__: JSON.stringify(
      process.env.LEARN_ORIGIN ?? 'https://learn.uwaterloo.ca',
    ),
    __DEV_TOOLS__: JSON.stringify(mode !== 'production'),
    // Stamped at build time so a stale load is visible rather than inferred.
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(5, 16).replace('T', ' '),
    ),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: target === 'main',
    sourcemap: mode !== 'production' ? 'inline' : false,
    minify: mode === 'production',
    target: 'chrome120',
    // pdf.js ships its worker as a separate module that must survive as a
    // real file, not be inlined into a chunk.
    assetsInlineLimit: 0,
    rollupOptions:
      target === 'content'
        ? {
            input:
              process.env.CONTENT_ENTRY === 'portal'
                ? r('src/portal/index.ts')
                : r('src/content/index.ts'),
            output: {
              format: 'iife',
              entryFileNames:
                process.env.CONTENT_ENTRY === 'portal' ? 'portal.js' : 'content.js',
              inlineDynamicImports: true,
            },
          }
        : {
            input: {
              background: r('src/background/index.ts'),
              offscreen: r('src/offscreen/offscreen.html'),
              popup: r('src/ui/popup/popup.html'),
              dashboard: r('src/ui/dashboard/dashboard.html'),
            },
            output: {
              format: 'es',
              entryFileNames: '[name].js',
              chunkFileNames: 'chunks/[name]-[hash].js',
              assetFileNames: 'assets/[name][extname]',
            },
          },
  },
}));
