import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // @coach/types is not linked into this package (no workspace dependency yet), so it resolves to its source.
  resolve: {
    alias: [
      {
        find: /^@coach\/types$/,
        replacement: fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    name: 'agents',
    include: ['src/**/*.spec.ts'],
  },
});
