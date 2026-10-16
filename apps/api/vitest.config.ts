import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

// Workspace packages resolve to their sources so API tests do not need a build first.
const alias = [
  { find: /^@coach\/types$/, replacement: fromRoot('packages/types/src/index.ts') },
  {
    find: /^@coach\/graph-kit\/testing$/,
    replacement: fromRoot('packages/graph-kit/src/testing/index.ts'),
  },
  { find: /^@coach\/graph-kit$/, replacement: fromRoot('packages/graph-kit/src/index.ts') },
  { find: /^@coach\/agents\/llm$/, replacement: fromRoot('packages/agents/src/llm/index.ts') },
  {
    find: /^@coach\/agents\/curator$/,
    replacement: fromRoot('packages/agents/src/curator/index.ts'),
  },
  { find: /^@coach\/agents\/coach$/, replacement: fromRoot('packages/agents/src/coach/index.ts') },
  {
    find: /^@coach\/admin-kit\/testing$/,
    replacement: fromRoot('packages/admin-kit/src/testing.ts'),
  },
  { find: /^@coach\/admin-kit$/, replacement: fromRoot('packages/admin-kit/src/index.ts') },
  {
    find: /^@coach\/agents\/testing$/,
    replacement: fromRoot('packages/agents/src/testing/index.ts'),
  },
];

const common = {
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: { alias },
};

// `unit`: src/**/*.spec.ts, no servers. `api`: test/**, real FalkorDB and Postgres, always AUTH_MODE=dev.
export default defineConfig({
  test: {
    projects: [
      {
        ...common,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        ...common,
        test: {
          name: 'api',
          include: ['test/**/*.spec.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: true,
          env: { AUTH_MODE: 'dev', NODE_ENV: 'test' },
        },
      },
    ],
  },
});
