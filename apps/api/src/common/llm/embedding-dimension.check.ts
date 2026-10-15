import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { EmbeddingsProvider } from '@coach/agents/llm';
import { ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { SettingsService } from '../settings/settings.service';
import { EMBEDDINGS_PROVIDER } from './llm.tokens';

export const REBUILD_COMMAND = 'pnpm --filter @coach/api cli setup-graph --rebuild-vector';

export type DimensionCheck =
  | { status: 'ok' }
  | { status: 'warning'; message: string }
  | { status: 'mismatch'; message: string };

/**
 * Compares `EMBEDDING_DIM`, the provider's dimension, and the dimension the vector index was built with
 * (contracts/cli-and-config.md §4, step 5). A stored value of null means it could not be read or setup has not run.
 */
export function checkEmbeddingDimension(input: {
  configured: number;
  provider: number;
  stored: number | null;
}): DimensionCheck {
  const { configured, provider, stored } = input;
  const numbers = `EMBEDDING_DIM=${configured}, provider dimension=${provider}, stored embeddingDim=${stored ?? 'none'}`;
  if (configured !== provider || (stored !== null && stored !== configured)) {
    return {
      status: 'mismatch',
      message: `Embedding dimension mismatch (${numbers}). Run: ${REBUILD_COMMAND}`,
    };
  }
  if (stored === null) {
    return {
      status: 'warning',
      message: 'The stored embedding dimension could not be read (run cli setup-graph if the graph is new)',
    };
  }
  return { status: 'ok' };
}

/** Start-up step 5. Not part of the CLI module. Exits 1 on a difference. */
@Injectable()
export class EmbeddingDimensionCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('EmbeddingDimension');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(EMBEDDINGS_PROVIDER) private readonly embeddings: EmbeddingsProvider,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = checkEmbeddingDimension({
      configured: this.env.embeddings.dimension,
      provider: this.embeddings.dimension,
      stored: await this.settings.get('embeddingDim'),
    });
    if (result.status === 'warning') this.logger.warn(result.message);
    if (result.status === 'mismatch') {
      console.error(result.message);
      process.exit(1);
    }
  }
}
