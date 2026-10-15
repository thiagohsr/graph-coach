import { Inject } from '@nestjs/common';
import { GraphKit, describeSchema, setupGraph, type SetupReport } from '@coach/graph-kit';
import { Command, CommandRunner, Option } from 'nest-commander';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { SettingsService } from '../common/settings/settings.service';
import { CLI_OUTPUT, CliError, type CliOutput } from './cli-support';

const REBUILD_COMMAND = 'pnpm --filter @coach/api cli setup-graph --rebuild-vector';

/** Prints a setup report line by line (shared with `seed`). */
export function printSetupReport(out: CliOutput, report: SetupReport): void {
  out.line(`created: ${report.created.length}`);
  for (const item of report.created) out.line(`  created ${item.kind} index ${item.label}.${item.property}`);
  out.line(`existing: ${report.existing.length}`);
  for (const item of report.skipped) {
    out.line(`  skipped ${item.kind} ${item.label}.${item.property}: ${item.reason}`);
  }
  out.line(
    `vector index: dimension ${report.vectorIndex.dimension}` +
      `${report.vectorIndex.rebuilt ? ' (rebuilt)' : ''}, chunks with an embedding: ${report.vectorIndex.chunksWithEmbedding}`,
  );
}

@Command({
  name: 'setup-graph',
  description: 'Create the graph indexes, constraints, and vector index; store the embedding dimension',
})
export class SetupGraphCommand extends CommandRunner {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(GraphKit) private readonly graph: GraphKit,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLI_OUTPUT) private readonly out: CliOutput,
  ) {
    super();
  }

  @Option({
    flags: '--rebuild-vector',
    description: 'Drop and recreate the vector index when EMBEDDING_DIM changed',
  })
  parseRebuild(): boolean {
    return true;
  }

  async run(_args: string[], options?: { rebuildVector?: boolean }): Promise<void> {
    const rebuild = options?.rebuildVector === true;
    const dimension = this.env.embeddings.dimension;

    const stored = await this.settings.get('embeddingDim');
    const indexed = (await describeSchema(this.graph)).vectorDimension;
    const known = [stored, indexed].filter((value): value is number => value !== null);
    if (!rebuild && known.some((value) => value !== dimension)) {
      throw new CliError(
        `Embedding dimension changed: stored ${known.join(' / ')}, EMBEDDING_DIM ${dimension}. ` +
          `Run: ${REBUILD_COMMAND}`,
      );
    }

    const report = await setupGraph(this.graph, { embeddingDim: dimension, rebuildVector: rebuild });
    printSetupReport(this.out, report);

    try {
      await this.settings.set('embeddingDim', dimension);
      this.out.line(`embeddingDim: ${dimension} stored`);
    } catch {
      this.out.line('warning: could not store embeddingDim (Postgres is not reachable)');
    }
  }
}
