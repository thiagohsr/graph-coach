import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { ConfigModule, ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import * as schema from './schema';

export type Db = PostgresJsDatabase<typeof schema>;
export type SqlClient = postgres.Sql;

/** Injection token: the Drizzle database. */
export const DB = Symbol('DB');
/** Injection token: the underlying postgres.js client (ping, transactions' raw access, shutdown). */
export const SQL_CLIENT = Symbol('SQL_CLIENT');

const PING_TIMEOUT_MS = 1_000;

/** Creates the client without connecting: postgres.js opens its first connection on the first query. */
export function createSqlClient(databaseUrl: string): SqlClient {
  return postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 5,
    // Notices (for example "relation already exists, skipping") are not errors and not worth a log line.
    onnotice: () => undefined,
  });
}

export function createDb(client: SqlClient): Db {
  return drizzle(client, { schema });
}

/** `SELECT 1` with a 1 s timeout. Never throws: true = Postgres answered. */
export async function pingSql(db: Db, timeoutMs = PING_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('ping timed out')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
class DbLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SQL_CLIENT) private readonly client: SqlClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.end({ timeout: 5 }).catch(() => undefined);
  }
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: SQL_CLIENT,
      inject: [ENV],
      useFactory: (env: Env) => createSqlClient(env.DATABASE_URL),
    },
    { provide: DB, inject: [SQL_CLIENT], useFactory: (client: SqlClient) => createDb(client) },
    DbLifecycle,
  ],
  exports: [DB, SQL_CLIENT],
})
export class DbModule {}
