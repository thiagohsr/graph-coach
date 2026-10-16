import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Starts the BUILT API exactly as production does (`node dist/main.js`, CommonJS output requiring the
// ESM-only workspace packages) and checks that it listens and answers GET /api/health. Needs
// `pnpm --filter "./packages/*" run build` and `pnpm --filter @coach/api run build` first; it skips
// (with a message) when either is missing. The stores need not be up: health answers 200 and names them.

const apiRoot = resolve(__dirname, '..');
const mainJs = resolve(apiRoot, 'dist/main.js');
const llmDist = resolve(apiRoot, '../../packages/agents/dist/llm/index.js');
const built = existsSync(mainJs) && existsSync(llmDist);
const PORT = 3991;

describe.skipIf(!built)('built API (node dist/main.js)', () => {
  let child: ReturnType<typeof spawn> | undefined;
  let output = '';

  beforeAll(() => {
    child = spawn(process.execPath, ['dist/main.js'], {
      cwd: apiRoot,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        API_PORT: String(PORT),
        AUTH_MODE: 'dev',
        JWT_SECRET: 'built-api-test-signing-key',
        LLM_PROVIDER: 'stub',
        EMBEDDING_PROVIDER: 'stub',
        DATABASE_URL: 'postgres://coach:coach@localhost:5432/coach',
        FALKORDB_HOST: 'localhost',
        FALKORDB_PORT: '6379',
        GRAPH_NAME: 'coach',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  });

  afterAll(async () => {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
    child.kill('SIGTERM');
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  it('answers GET /api/health with 200', async () => {
    let response: Response | undefined;
    for (let attempt = 0; attempt < 60 && !response; attempt += 1) {
      if (child!.exitCode !== null) break;
      try {
        response = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    expect(response, `API did not answer; output:\n${output}`).toBeDefined();
    expect(response!.status).toBe(200);
    const body = (await response!.json()) as Record<string, unknown>;
    expect(Object.keys(body).length).toBeGreaterThan(0);
  }, 40_000);
});
