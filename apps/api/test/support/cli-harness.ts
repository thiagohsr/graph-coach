// Drives the CLI commands the way `nest-commander`'s testing helper does (it builds the command runner module around the
// application module, then runs it with an argv), against a Postgres schema and a graph of their own. The graph is created
// without setup, so `setup-graph` has something to do.
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { CommandRunnerModule, CommandRunnerService } from 'nest-commander';
import { Module } from '@nestjs/common';
import postgres from 'postgres';
import request from 'supertest';
import { GraphKit } from '@coach/graph-kit';
import { createTestGraph, falkorConnectionFromEnv, type TestGraph } from '@coach/graph-kit/testing';
import { AppModule } from '../../src/app.module';
import { SQL_CLIENT, DB, createDb, type Db } from '../../src/common/db/db.module';
import { ENV } from '../../src/config/config.module';
import { parseEnv, type Env } from '../../src/config/env';
import { configureApp } from '../../src/configure-app';
import { CliModule } from '../../src/cli/cli.module';
import { CLI_OUTPUT, CLI_PROMPT, describeFailure } from '../../src/cli/cli-support';
import { MIGRATOR } from '../../src/cli/migrate.command';
import { applyMigrations } from './test-app';

const DEFAULT_DATABASE_URL = 'postgres://coach:coach@localhost:5432/coach';

@Module({})
class CliRootModule {}

export interface CliRunOptions {
  /** Overrides on top of the test environment variables. */
  env?: Record<string, string>;
  /** Replaces fields of the parsed environment (for example NODE_ENV: 'production'). */
  envObject?: Partial<Env>;
  /** The operator's answer when a command asks for the graph name. */
  answer?: string;
}

export interface CliResult {
  exitCode: number;
  /** Everything printed on standard output by the command, as lines. */
  lines: string[];
  /** Failure lines (what would go to standard error). */
  errors: string[];
  /** Nest log lines emitted during the run. */
  logs: string[];
}

export interface CliHarness {
  readonly db: Db;
  readonly schema: string;
  readonly testGraph: TestGraph;
  run(args: string[], options?: CliRunOptions): Promise<CliResult>;
  /** The HTTP application over the same schema and graph (development sign-in). */
  http(): Promise<{ post(path: string): request.Test; close(): Promise<void> }>;
  close(): Promise<void>;
}

const BASE_ENV = {
  JWT_SECRET: 'test-only-signing-secret-0123456789',
  AUTH_MODE: 'dev',
  NODE_ENV: 'test',
  WEB_ORIGIN: 'http://localhost:3000',
  LOG_LEVEL: 'error',
  LLM_PROVIDER: 'stub',
  EMBEDDING_PROVIDER: 'stub',
};

export async function createCliHarness(): Promise<CliHarness> {
  const databaseUrl = process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
  const schema = `test_cli_${randomBytes(6).toString('hex')}`;

  const admin = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  await admin.unsafe(`CREATE SCHEMA "${schema}"`);
  const sqlClient = postgres(databaseUrl, {
    max: 5,
    onnotice: () => undefined,
    connection: { search_path: schema },
  });
  const db = createDb(sqlClient);
  const testGraph = await createTestGraph({ setup: false });

  // The application modules end their client on shutdown; each run gets a handle whose `end` does nothing.
  const sharedClient = new Proxy(sqlClient, {
    get(target, property, receiver) {
      if (property === 'end') return async () => undefined;
      return Reflect.get(target, property, receiver) as unknown;
    },
  });

  const migrator = async () => {
    const [present] = await sqlClient`select to_regclass(${`"${schema}".users`}) as name`;
    if (present?.name === null) await applyMigrations(sqlClient, schema);
  };

  const envFor = (options: CliRunOptions): Env => {
    const parsed = parseEnv({
      DATABASE_URL: databaseUrl,
      ...BASE_ENV,
      ...(options.env ?? {}),
    } as NodeJS.ProcessEnv);
    return { ...parsed, GRAPH_NAME: testGraph.name, ...(options.envObject ?? {}) };
  };

  const freshGraph = () => GraphKit.create({ ...falkorConnectionFromEnv(), graphName: testGraph.name });

  const harness: CliHarness = {
    db,
    schema,
    testGraph,

    async run(args, options = {}) {
      const lines: string[] = [];
      const errors: string[] = [];
      const logs: string[] = [];
      let exitCode = 0;
      const capture = (message: unknown) => {
        logs.push(String(message));
      };
      Logger.overrideLogger({ log: capture, error: capture, warn: capture, debug: capture, verbose: capture });

      const moduleRef = await Test.createTestingModule({
        imports: [
          CommandRunnerModule.forModule(
            { module: CliRootModule, imports: [CliModule] },
            {
              serviceErrorHandler: (error: unknown) => {
                const failure = describeFailure(error);
                errors.push(...failure.lines);
                exitCode = failure.exitCode;
              },
            } as never,
          ),
        ],
      })
        .overrideProvider(ENV)
        .useValue(envFor(options))
        .overrideProvider(SQL_CLIENT)
        .useValue(sharedClient)
        .overrideProvider(DB)
        .useValue(db)
        .overrideProvider(GraphKit)
        .useValue(await freshGraph())
        .overrideProvider(MIGRATOR)
        .useValue(migrator)
        .overrideProvider(CLI_OUTPUT)
        .useValue({
          line: (text: string) => lines.push(text),
          error: (text: string) => errors.push(text),
        })
        .overrideProvider(CLI_PROMPT)
        .useValue(async () => options.answer ?? '')
        .compile();

      const app = await moduleRef.init();
      try {
        await app.get(CommandRunnerService).run(['node', 'cli', ...args]);
      } finally {
        await app.close();
        Logger.overrideLogger(false);
      }
      return { exitCode, lines, errors, logs };
    },

    async http() {
      const env = envFor({});
      const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env.auth.mode)] })
        .overrideProvider(ENV)
        .useValue(env)
        .overrideProvider(SQL_CLIENT)
        .useValue(sharedClient)
        .overrideProvider(DB)
        .useValue(db)
        .overrideProvider(GraphKit)
        .useValue(await freshGraph())
        .compile();
      const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
      configureApp(app, env);
      await app.init();
      return {
        post: (path: string) => request(app.getHttpServer()).post(path.startsWith('/api') ? path : `/api${path}`),
        close: () => app.close(),
      };
    },

    async close() {
      await testGraph.dispose().catch(() => undefined);
      await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await sqlClient.end({ timeout: 1 }).catch(() => undefined);
      await admin.end({ timeout: 1 }).catch(() => undefined);
    },
  };
  return harness;
}
