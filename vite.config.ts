import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * A production build is served from a sub-path on GitHub Pages (`/svg23d/`), while the dev server
 * stays on `/`. The sub-path is the repository name, so renaming the repo means renaming it here
 * too (ADR-0034).
 */
const PAGES_BASE = '/svg23d/';

export default defineConfig(({ mode }) => ({
  // `mode` (not `command`) so that `vite preview` also serves the bundle from the sub-path.
  base: mode === 'production' ? PAGES_BASE : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@app': resolvePath('./src/app'),
      '@viewer': resolvePath('./src/viewer'),
      '@workers': resolvePath('./src/workers'),
      '@i18n': resolvePath('./src/i18n'),
    },
  },
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
  },
}));
