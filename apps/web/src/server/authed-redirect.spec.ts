// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Decision 11, against the built server handler: a signed-out request for a protected page is answered with a
// redirect to /login (carrying the return route), not a 200 empty page. Runs only when `vite build` has run.
const entry = path.resolve(__dirname, '..', '..', 'dist', 'server', 'server.js');
const built = fs.existsSync(entry);

describe.skipIf(!built)('built server: protected pages without a session', () => {
  // The built server reads its environment at runtime; no cookie means no upstream call.
  process.env.SESSION_SECRET ??= 'test-secret-test-secret-test-secret-0123456789';
  process.env.AUTH_MODE = 'dev';
  it.each(['/puzzles', '/coach', '/puzzles?x=1'])('GET %s redirects to /login with the return route', async (target) => {
    const mod = (await import(pathToFileURL(entry).href)) as { default: { fetch(r: Request): Promise<Response> } };
    const response = await mod.default.fetch(new Request(`http://localhost:3000${target}`, { redirect: 'manual' }));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = new URL(response.headers.get('location') ?? '', 'http://localhost:3000');
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('redirect')).toBe(target);
  });
});

// The real production entry (scripts/start.mjs) started as a child process, with a hard timeout.
describe.skipIf(!built)('scripts/start.mjs: started server', () => {
  it('answers a redirect for /puzzles without a cookie, even with a spoofed x-coach-peer header', async () => {
    const port = 38417;
    const child = spawn(process.execPath, ['scripts/start.mjs'], {
      cwd: path.resolve(__dirname, '..', '..'),
      env: { ...process.env, WEB_PORT: String(port), SESSION_SECRET: 'test-secret-test-secret-test-secret-0123456789', AUTH_MODE: 'dev', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += String(d)));
    child.stderr.on('data', (d) => (output += String(d)));
    try {
      // node:http, because the test setup replaces global fetch with a guard.
      const get = () =>
        new Promise<{ status: number; location: string | undefined }>((resolve, reject) => {
          const req = http.get({ host: '127.0.0.1', port, path: '/puzzles', headers: { 'x-coach-peer': '1.2.3.4' } }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location }));
          });
          req.on('error', reject);
        });
      let response: { status: number; location: string | undefined } | undefined;
      for (let i = 0; i < 60 && !response; i++) {
        try {
          response = await get();
        } catch {
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      expect(response, output).toBeDefined();
      expect(response!.status).toBeGreaterThanOrEqual(300);
      expect(response!.status).toBeLessThan(400);
      expect(response!.location).toBe('/login?redirect=%2Fpuzzles');
    } finally {
      child.kill('SIGTERM');
    }
  }, 30_000);
});
