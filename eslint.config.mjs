// Flat config for the whole workspace (spec 008, T007).
import tseslint from 'typescript-eslint';

const buildOutput = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.output/**',
  '**/.vinxi/**',
  '**/.tanstack/**',
  '**/coverage/**',
  'spike/**',
  'specs/**',
  '.specify/**',
];

export default tseslint.config(
  { ignores: buildOutput },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    // Only graph-kit may talk to FalkorDB directly (spec 002, SC-P03).
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['packages/graph-kit/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'falkordb', message: 'Use @coach/graph-kit instead.' }] },
      ],
    },
  },
  {
    // The Coach and the Curator coordinate through the graph, never by import (Principle IV).
    files: ['packages/agents/src/coach/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'falkordb', message: 'Use @coach/graph-kit instead.' }],
          patterns: [{ group: ['**/curator/**'], message: 'Agents must not import each other.' }],
        },
      ],
    },
  },
  {
    files: ['packages/agents/src/curator/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'falkordb', message: 'Use @coach/graph-kit instead.' }],
          patterns: [{ group: ['**/coach/**'], message: 'Agents must not import each other.' }],
        },
      ],
    },
  },
);
