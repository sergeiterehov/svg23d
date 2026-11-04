import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const resolvePath = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@core': resolvePath('./src/core'),
      '@app': resolvePath('./src/app'),
      '@viewer': resolvePath('./src/viewer'),
      '@workers': resolvePath('./src/workers'),
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
});
