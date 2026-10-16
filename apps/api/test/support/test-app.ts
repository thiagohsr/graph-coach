import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import request from 'supertest';
import { GraphKit, createLearner, toEpochMs } from '@coach/graph-kit';
import { createTestGraph, falkorConnectionFromEnv, type TestGraph } from '@coach/graph-kit/testing';
import type { Role, UserStatus } from '@coach/types';
import { AppModule } from '../../src/app.module';
import { AccountsService } from '../../src/apps/accounts/accounts.service';
import { users } from '../../src/apps/accounts/user.model';
import { DevTokenVerifier } from '../../src/common/auth/dev-token-verifier';
import { CLOCK, type Clock } from '../../src/common/clock';
import { DB, SQL_CLIENT, createDb, type Db } from '../../src/common/db/db.module';
import { ConflictError } from '../../src/common/errors/app-error';
import { ENV } from '../../src/config/config.module';
import { parseEnv } from '../../src/config/env';
import { configureApp } from '../../src/configure-app';
import {
  createTestProviders,
  overrideProviders,
  testControllersModule,
  type TestProviders,
} from './providers';

export interface TestAppOptions {
  /** Default false: empty graph. Seeding arrives with spec 002 phase 8 (T058, T061). */
  seed?: false | { scenario?: boolean; now?: Date };
  /** Overrides on top of the test defaults (`AUTH_MODE=dev`, a fixed JWT secret, the local stores). */
  env?: Partial<Record<string, string>>;
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
  /** Test-only controllers, mounted in the application under test (for example a route with @Roles). */
  controllers?: Type[];
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  token: string;
  auth: { Authorization: string };
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'options';
/** supertest bound to the app. Paths may omit the `/api` prefix. */
export type TestHttp = Record<Method, (path: string) => request.Test>;

export interface TestApp {
  readonly app: INestApplication;
  readonly http: TestHttp;
  readonly testGraph: TestGraph;
  readonly chat: TestProviders['chat'];
  readonly embeddings: TestProviders['embeddings'];
  readonly tracer: TestProviders['tracer'];
  readonly clock: { now(): Date; set(date: Date): void; advance(ms: number): void };
  /** Direct access for assertions on the account tables (the application's own database handle). */
  readonly db: Db;
  readonly schema: string;
  /** Inserts the users row and its Learner node, and returns a development token. No user_identities row. */
  createUser(options?: {
    email?: string;
    name?: string;
    role?: Role;
    status?: UserStatus;
    signedIn?: boolean;
  }): Promise<TestUser>;
  /** A development token for a user that expired one second ago, for 401 tests. */
  expiredToken(userId?: string): Promise<string>;
  /** Blocks or unblocks through AccountsService (actor null), so the guard's cache is invalidated. */
  setStatus(userId: string, status: UserStatus): Promise<void>;
  /** Starts listening on a free port and returns the base URL (for streaming tests). */
  listen(): Promise<string>;
  close(): Promise<void>;
}

const JWT_SECRET = 'test-only-signing-secret-0123456789';
const DEFAULT_DATABASE_URL = 'postgres://coach:coach@localhost:5432/coach';
const DRIZZLE_DIR = join(__dirname, '..', '..', 'drizzle');

class TestClock implements Clock {
  constructor(private ms = Date.UTC(2026, 9, 11, 12, 0, 0)) {}
  now(): Date {
    return new Date(this.ms);
  }
  set(date: Date): void {
    this.ms = date.getTime();
  }
  advance(ms: number): void {
    this.ms += ms;
  }
}

/** Applies the generated migrations inside one schema (the files name `public` explicitly). */
export async function applyMigrations(sql: postgres.Sql, schema: string): Promise<void> {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  for (const { tag } of journal.entries) {
    const text = readFileSync(join(DRIZZLE_DIR, `${tag}.sql`), 'utf8').replaceAll('"public".', `"${schema}".`);
    for (const statement of text.split('--> statement-breakpoint')) {
      if (statement.trim() !== '') await sql.unsafe(statement);
    }
  }
}

function dummyEmailPart(): string {
  return randomBytes(5).toString('hex');
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const schema = `test_api_${randomBytes(6).toString('hex')}`;

  // Postgres: a schema of its own, with migrations applied.
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  const sqlClient = postgres(databaseUrl, {
    max: 5,
    onnotice: () => undefined,
    connection: { search_path: schema },
  });
  const db = createDb(sqlClient);

  // FalkorDB: a graph of its own (test_<file>_<hex>) for assertions, and a second connection to it for the app.
  let testGraph: TestGraph;
  try {
    await applyMigrations(sqlClient, schema);
    testGraph = await createTestGraph();
  } catch (error) {
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await sqlClient.end({ timeout: 1 }).catch(() => undefined);
    await admin.end({ timeout: 1 }).catch(() => undefined);
    throw error;
  }
  const appGraph = await GraphKit.create({ ...falkorConnectionFromEnv(), graphName: testGraph.name });

  const env = parseEnv({
    DATABASE_URL: databaseUrl,
    JWT_SECRET,
    AUTH_MODE: 'dev',
    NODE_ENV: 'test',
    WEB_ORIGIN: 'http://localhost:3000',
    LOG_LEVEL: 'error',
    LLM_PROVIDER: 'stub',
    EMBEDDING_PROVIDER: 'stub',
    ...Object.fromEntries(Object.entries(options.env ?? {}).filter(([, v]) => v !== undefined)),
  } as NodeJS.ProcessEnv);

  const clock = new TestClock();
  const providers = createTestProviders(env.embeddings.dimension);

  let builder = overrideProviders(
    Test.createTestingModule({ imports: [AppModule.forRoot(env.auth.mode), testControllersModule(options.controllers)] }),
    providers,
  )
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(SQL_CLIENT)
    .useValue(sqlClient)
    .overrideProvider(DB)
    .useValue(db)
    .overrideProvider(GraphKit)
    .useValue(appGraph);
  if (options.configure) builder = options.configure(builder);

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, env);
  await app.init();

  const signer = new DevTokenVerifier({ secret: JWT_SECRET, clock });
  const accounts = app.get(AccountsService);

  const http = Object.fromEntries(
    (['get', 'post', 'put', 'patch', 'delete', 'options'] as const).map((method) => [
      method,
      (path: string) =>
        request(app.getHttpServer())[method](path.startsWith('/api/') || path === '/api' ? path : `/api${path}`),
    ]),
  ) as TestHttp;

  let closed = false;

  return {
    app,
    http,
    testGraph,
    chat: providers.chat,
    embeddings: providers.embeddings,
    tracer: providers.tracer,
    clock,
    db,
    schema,

    async createUser(userOptions = {}) {
      const id = randomUUID();
      const role = userOptions.role ?? 'learner';
      const name = userOptions.name ?? `Test ${role} ${dummyEmailPart().slice(0, 4)}`;
      const email = (userOptions.email ?? `user-${dummyEmailPart()}@example.test`).trim().toLowerCase();
      const now = clock.now();
      await db.insert(users).values({
        id,
        email,
        displayName: name,
        role,
        status: userOptions.status ?? 'active',
        createdAt: now,
        lastSeenAt: userOptions.signedIn === false ? null : now,
      });
      await appGraph.runOne(createLearner, { id, displayName: name, createdAt: toEpochMs(now) });
      const { accessToken } = await signer.sign(id);
      return { id, email, name, role, token: accessToken, auth: { Authorization: `Bearer ${accessToken}` } };
    },

    async expiredToken(userId = randomUUID()) {
      return (await signer.sign(userId, { expiresInSeconds: -1 })).accessToken;
    },

    async setStatus(userId, status) {
      try {
        await accounts.setStatus(null, userId, status);
      } catch (error) {
        // The last-active-admin rule would refuse blocking a lone admin; tests still need such a caller.
        if (!(error instanceof ConflictError)) throw error;
        await db.update(users).set({ status }).where(eq(users.id, userId));
        accounts.invalidate(userId);
      }
    },

    async listen() {
      await app.listen(0, '127.0.0.1');
      const url = await app.getUrl();
      return url.replace('[::1]', '127.0.0.1');
    },

    async close() {
      if (closed) return;
      closed = true;
      await app.close().catch(() => undefined);
      await testGraph.dispose().catch(() => undefined);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await sqlClient.end({ timeout: 1 }).catch(() => undefined);
      await admin.end({ timeout: 1 }).catch(() => undefined);
    },
  };
}
