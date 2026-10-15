import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'types',
    include: ['src/**/*.spec.ts'],
  },
});
