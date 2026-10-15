import { GraphKit } from '@coach/graph-kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB } from '../src/common/db/db.module';
import { createTestApp, type TestApp } from './support/test-app';

describe('GET /api/health', () => {
  describe('both stores up', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp();
    });
    afterAll(async () => {
      await t.close();
    });

    it('answers 200 with api, graph, and sql ok, without a token', async () => {
      const res = await t.http.get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ api: 'ok', graph: 'ok', sql: 'ok' });
      expect(Object.keys(res.body)).toHaveLength(3);
    });
  });

  describe('graph reported down', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({
        configure: (builder) =>
          builder.overrideProvider(GraphKit).useValue({
            health: async () => ({ status: 'down', error: 'connection refused' }),
            // Modules that register generated queries at start-up (006 admin) only need these to exist.
            defineQuery: () => undefined,
            registerQuery: () => undefined,
            close: async () => undefined,
          }),
      });
    });
    afterAll(async () => {
      await t.close();
    });

    it('answers 200 with graph down and the sign-in list still answering', async () => {
      const res = await t.http.get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ api: 'ok', graph: 'down', sql: 'ok' });
      expect(res.text).not.toContain('refused');
      expect((await t.http.get('/auth/dev-users')).status).toBe(200);
    });
  });

  describe('SQL hangs', () => {
    let t: TestApp;
    beforeAll(async () => {
      t = await createTestApp({
        configure: (builder) =>
          builder.overrideProvider(DB).useFactory({
            factory: () => ({
              execute: () => new Promise(() => undefined),
              // Anything else the application touches at start-up fails fast instead of hanging.
              select: () => {
                throw new Error('database unavailable');
              },
            }),
          }),
      });
    });
    afterAll(async () => {
      await t.close();
    });

    it('reports sql down within 1.5 seconds', async () => {
      const started = Date.now();
      const res = await t.http.get('/health');
      expect(Date.now() - started).toBeLessThan(1500);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ api: 'ok', graph: 'ok', sql: 'down' });
    });
  });
});
