import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Inject } from '@nestjs/common';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Command, CommandRunner } from 'nest-commander';
import { DB, type Db } from '../common/db/db.module';
import { SettingsService } from '../common/settings/settings.service';
import { CLI_OUTPUT, type CliOutput } from './cli-support';

/** Applies the pending migrations. Replaced in tests, which run inside a schema of their own. */
export type Migrator = (db: Db) => Promise<void>;
export const MIGRATOR = Symbol('MIGRATOR');

/** `apps/api/drizzle`, found by walking up from this file (works from `src` and from `dist`). */
export function migrationsFolder(): string {
  let dir = __dirname;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Cannot find the drizzle migrations folder');
}

export const drizzleMigrator: Migrator = async (db) => {
  await migrate(db, { migrationsFolder: migrationsFolder() });
};

@Command({
  name: 'migrate',
  description: 'Apply pending Postgres migrations, then insert the default settings rows',
})
export class MigrateCommand extends CommandRunner {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(MIGRATOR) private readonly migrator: Migrator,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  async run(): Promise<void> {
    await this.migrator(this.db);
    this.out.line('migrations: applied');
    await this.settings.ensureDefaults();
    this.out.line('settings: defaults ensured');
  }
}
