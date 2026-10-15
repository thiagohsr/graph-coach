import { Inject } from '@nestjs/common';
import { GraphKit, dropGraph } from '@coach/graph-kit';
import { Command, CommandRunner, Option } from 'nest-commander';
import { adminSettings } from '../common/settings/admin-setting.model';
import { users } from '../apps/accounts/user.model';
import { DB, type Db } from '../common/db/db.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CLI_OUTPUT, CLI_PROMPT, CliError, type CliOutput, type CliPrompt } from './cli-support';

@Command({
  name: 'reset',
  description: 'Delete the graph and, unless --graph-only, empty the users and admin_settings tables',
})
export class ResetCommand extends CommandRunner {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(DB) private readonly db: Db,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
    @Inject(CLI_PROMPT) private readonly prompt: CliPrompt,
  ) {
    super();
  }

  @Option({ flags: '--yes', description: 'Do not ask for the graph name' })
  parseYes(): boolean {
    return true;
  }

  @Option({ flags: '--graph-only', description: 'Leave the Postgres tables alone' })
  parseGraphOnly(): boolean {
    return true;
  }

  async run(_args: string[], options: { yes?: boolean; graphOnly?: boolean } = {}): Promise<void> {
    if (this.env.NODE_ENV === 'production') throw new CliError('reset is not allowed when NODE_ENV=production');

    if (!options.yes) {
      const answer = await this.prompt(`This deletes the graph "${this.env.GRAPH_NAME}". Type its name to confirm: `);
      if (answer !== this.env.GRAPH_NAME) throw new CliError('Cancelled: nothing was changed', 2);
    }

    try {
      await dropGraph(this.graph);
      this.out.line(`graph ${this.env.GRAPH_NAME}: deleted`);
    } catch (error) {
      // A graph that was never created has nothing to delete.
      if (!/empty key|does not exist|not found/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      this.out.line(`graph ${this.env.GRAPH_NAME}: did not exist`);
    }

    if (!options.graphOnly) {
      await this.db.delete(users);
      await this.db.delete(adminSettings);
      this.out.line('tables users and admin_settings: emptied');
    }
    this.out.line('Next: run migrate, setup-graph, and seed again (make migrate seed).');
  }
}
