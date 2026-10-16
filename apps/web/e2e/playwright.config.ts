import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Ports default to the local-development ports (3000 web, 3001 API) and can be overridden with
// WEB_PORT and API_PORT (the Makefile target `test-e2e` passes the root .env through dotenv).
const webPort = Number(process.env.E2E_WEB_PORT || process.env.WEB_PORT || 3000);
const apiPort = Number(process.env.E2E_API_PORT || process.env.API_PORT || 3001);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const env = {
  AUTH_MODE: 'dev',
  LLM_PROVIDER: 'stub',
  EMBEDDING_PROVIDER: 'stub',
  WEB_PORT: String(webPort),
  API_PORT: String(apiPort),
  WEB_ORIGIN: `http://localhost:${webPort}`,
  API_URL: `http://localhost:${apiPort}/api`,
};

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @coach/api run dev',
      cwd: repoRoot,
      url: `http://localhost:${apiPort}/api/health`,
      // Never reuse a server that was already running: a stale process may run old code or another config.
      reuseExistingServer: false,
      timeout: 180_000,
      env,
    },
    {
      command: 'pnpm --filter @coach/web run dev',
      cwd: repoRoot,
      url: `http://localhost:${webPort}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env,
    },
  ],
});
