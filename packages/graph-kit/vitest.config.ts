import { defineConfig } from 'vitest/config';

// Two projects: `unit` needs no server; `graph` needs FalkorDB (make up) and cleans test_* graphs first.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.spec.ts'],
        },
      },
      {
        test: {
          name: 'graph',
          include: ['test/**/*.spec.ts'],
          globalSetup: ['./src/testing/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // One test file per graph, files may run in parallel.
        },
      },
    ],
  },
});
