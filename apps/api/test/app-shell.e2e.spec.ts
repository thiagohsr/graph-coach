import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { ENV } from '../src/config/config.module';
import { parseEnv } from '../src/config/env';
import { configureApp } from '../src/configure-app';

const source = {
  DATABASE_URL: 'postgres://coach:coach@localhost:5432/coach_unused',
  JWT_SECRET: 'a-development-secret-of-16+',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('application shell (in process)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const env = parseEnv(source);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ENV)
      .useValue(env)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('starts without either store being reachable and answers unknown routes with the error envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/nothing');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('allows only WEB_ORIGIN, with the documented methods and headers', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/anything')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-id-token');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']?.toLowerCase()).toContain('x-id-token');
  });

  it('refuses a JSON body over 1 MB', async () => {
    const big = JSON.stringify({ text: 'x'.repeat(1_100_000) });
    const res = await request(app.getHttpServer())
      .post('/api/anything')
      .set('Content-Type', 'application/json')
      .send(big);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.error).toBeDefined();
  });
});

const entry = join(__dirname, '..', 'dist', 'main.js');

// The process-level checks run the built server; they are skipped until `pnpm --filter @coach/api build` has run.
describe.skipIf(!existsSync(entry))('built server process', () => {
  const baseEnv = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

  it('exits 1 with one readable line per problem when the environment is invalid', () => {
    const result = spawnSync('node', [entry], {
      env: {
        ...baseEnv,
        NODE_ENV: 'production',
        AUTH_MODE: 'dev',
        WEB_ORIGIN: 'http://example.test',
      },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(result.status).toBe(1);
    const lines = result.stderr.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(lines.every((line) => line.startsWith('ENV '))).toBe(true);
    expect(result.stderr).toContain('ENV DATABASE_URL: required');
    expect(result.stderr).toContain(
      'ENV AUTH_MODE: the development sign-in is not allowed in production',
    );
  });

  it('listens on API_PORT with a valid environment, with the stores down', async () => {
    const port = 38000 + Math.floor(Math.random() * 1000);
    const child = spawn('node', [entry], {
      env: {
        ...baseEnv,
        ...source,
        API_PORT: String(port),
        FALKORDB_PORT: '1',
        LOG_LEVEL: 'error',
      },
      stdio: 'ignore',
    });
    try {
      let status = 0;
      for (let attempt = 0; attempt < 50 && status === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        status = await fetch(`http://127.0.0.1:${port}/api/nothing`).then(
          (res) => res.status,
          () => 0,
        );
      }
      expect(status).toBe(404);
    } finally {
      child.kill('SIGTERM');
    }
  });
});
