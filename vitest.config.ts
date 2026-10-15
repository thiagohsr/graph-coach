// Lists each package's own Vitest config as a project, so `pnpm vitest run <path>`
// works from the repository root. Test patterns live in each package (spec 008, T013).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
