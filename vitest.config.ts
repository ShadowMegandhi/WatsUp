import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const r = (p: string) => resolve(__dirname, p);

export default defineConfig({
  resolve: {
    alias: {
      '@shared': r('src/shared'),
      '@core': r('src/core'),
      '@d2l': r('src/d2l'),
      '@storage': r('src/storage'),
      '@sync': r('src/sync'),
      '@platform': r('src/platform'),
      '@ui': r('src/ui'),
      '@test': r('test'),
    },
  },
  define: {
    __LEARN_ORIGIN__: JSON.stringify('https://learn.uwaterloo.ca'),
    __DEV_TOOLS__: 'true',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Entry files and chrome.* wrappers are verified by E2E, not unit tests.
      // This is a deliberate exclusion, not an oversight.
      exclude: [
        'src/background/index.ts',
        'src/content/**',
        'src/offscreen/**',
        'src/platform/**',
        '**/*.d.ts',
        'scripts/**',
      ],
      thresholds: {
        'src/core/**': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'src/d2l/**': { statements: 85, branches: 80, functions: 85, lines: 85 },
      },
    },
  },
});
