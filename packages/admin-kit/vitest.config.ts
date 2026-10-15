import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Workspace packages resolve to their sources so the tests need no build first.
    alias: [
      {
        find: /^@coach\/types$/,
        replacement: fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'admin-kit',
    include: ['src/**/*.spec.ts'],
  },
});
