import { Inject } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import {
  GraphKit,
  SeedReadError,
  importGraph,
  readSeedDir,
  seedIds,
  seedToFixture,
  setupGraph,
  validateSeed,
} from '@coach/graph-kit';
import { Command, CommandRunner, Option } from 'nest-commander';
import { users } from '../apps/accounts/user.model';
import { CLOCK, type Clock } from '../common/clock';
import { DB, type Db } from '../common/db/db.module';
import { SettingsService } from '../common/settings/settings.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CLI_OUTPUT, CliError, type CliOutput } from './cli-support';
import { printSetupReport } from './setup-graph.command';

@Command({
  name: 'seed',
  description:
    'Load the synthetic seed content: demo users, concepts, puzzles, and the Coach scenario',
})
export class SeedCommand extends CommandRunner {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  @Option({
    flags: '--no-scenario',
    description: 'Skip the Coach scenario (sessions, answers, mastery)',
  })
  parseNoScenario(): boolean {
    return false;
  }

  @Option({
    flags: '--dir <path>',
    description: 'Read the seed from this directory instead of seed/',
  })
  parseDir(value: string): string {
    return value;
  }

  async run(_args: string[], options: { scenario?: boolean; dir?: string } = {}): Promise<void> {
    const withScenario = options.scenario !== false;

    // 1. Read and validate the files.
    let data;
    try {
      data = await readSeedDir(options.dir);
    } catch (error) {
      if (error instanceof SeedReadError) throw new CliError(error.message);
      throw error;
    }
    const issues = validateSeed(data);
    if (issues.length > 0) {
      for (const issue of issues) this.out.line(`${issue.file} ${issue.path}: ${issue.message}`);
      throw new CliError(
        `The seed has ${issues.length} problem${issues.length === 1 ? '' : 's'}; nothing was loaded`,
      );
    }

    // 2. The graph schema (idempotent; reports only what it had to create).
    const dimension = this.env.embeddings.dimension;
    const report = await setupGraph(this.graph, { embeddingDim: dimension });
    if (report.created.length > 0) {
      printSetupReport(this.out, report);
      await this.settings.set('embeddingDim', dimension).catch(() => undefined);
    }

    // 3. Demo users in Postgres: display name only on conflict; never role, status, or identities.
    const now = this.clock.now();
    const emails = data.users.map((user) => user.email.trim().toLowerCase());
    const existing = await this.db
      .select({ email: users.email })
      .from(users)
      .where(inArray(users.email, emails));
    for (const user of data.users) {
      const email = user.email.trim().toLowerCase();
      await this.db
        .insert(users)
        .values({
          id: seedIds.user(user.key as Parameters<typeof seedIds.user>[0]),
          email,
          displayName: user.displayName,
          role: user.role,
          status: 'active',
          createdAt: now,
        })
        .onConflictDoUpdate({ target: users.email, set: { displayName: user.displayName } });
      const [row] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email));
      if (row && row.id !== seedIds.user(user.key as Parameters<typeof seedIds.user>[0])) {
        this.out.line(
          `warning: demo user "${user.key}" already exists under another id; its graph node uses the seeded id`,
        );
      }
    }
    const created = data.users.length - existing.length;
    this.out.line(`users: ${created} created, ${existing.length} already there`);

    // 4. Settings rows, then the graph.
    await this.settings.ensureDefaults();
    const fixture = seedToFixture(data, { now, scenario: withScenario });
    const result = await importGraph(this.graph, fixture);

    const perLabel = new Map<string, number>();
    for (const node of fixture.nodes) perLabel.set(node.label, (perLabel.get(node.label) ?? 0) + 1);
    this.out.line(`seed${withScenario ? '' : ' (without the scenario)'}: nodes by label`);
    for (const [label, count] of [...perLabel].sort(([a], [b]) => a.localeCompare(b))) {
      this.out.line(`  ${label}: ${count}`);
    }
    this.out.line(
      `graph: ${result.nodesCreated} nodes and ${result.relationshipsCreated} relationships created, ` +
        `${result.propertiesSet} properties set`,
    );
  }
}
