import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// Component tests run in jsdom. Server-side specs (src/server/**) opt into the node environment with a
// `// @vitest-environment node` docblock so that Request, Response, and AbortSignal are the real ones.
export default defineConfig({
  resolve: { alias: { '~': path.resolve(here, 'src') } },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    env: {
      // Tests never read the root .env; the values that matter are passed explicitly.
      NODE_ENV: 'test',
    },
  },
});
