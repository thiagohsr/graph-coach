import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  createChatProvider,
  createEmbeddingsProvider,
  createUsageTracer,
  type UsageTracer,
} from '@coach/agents/llm';
import { ConfigModule, ENV } from '../../config/config.module';
import type { Env } from '../../config/env';
import { EmbeddingDimensionCheck } from './embedding-dimension.check';
import { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from './llm.tokens';

export { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER } from './llm.tokens';

/** Banners and warnings of start-up step 6; flushes the tracer on shutdown. */
@Injectable()
class LlmLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Llm');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(USAGE_TRACER) private readonly tracer: UsageTracer,
  ) {}

  onApplicationBootstrap(): void {
    const { env } = this;
    if (env.NODE_ENV !== 'test') {
      const stubs = [
        env.llm.provider === 'stub' ? 'LLM_PROVIDER (chat: puzzle generation, coaching)' : null,
        env.embeddings.provider === 'stub' ? 'EMBEDDING_PROVIDER (embeddings: source search)' : null,
      ].filter((entry): entry is string => entry !== null);
      if (stubs.length > 0) {
        const text = `Stub provider in use for ${stubs.join(' and ')}: features that need a real model return canned or empty answers.`;
        if (env.NODE_ENV === 'production') this.logger.warn(text);
        else this.logger.log(text);
      }
    }

    if (env.llm.provider === 'ollama-with-fallback' && !env.llm.fallback) {
      this.logger.warn('LLM_PROVIDER=ollama-with-fallback without OPENROUTER_API_KEY: there is no fallback if Ollama is down');
    }

    const { publicKey, secretKey, host } = env.tracer;
    const set = [publicKey, secretKey, host].filter((value) => value !== undefined).length;
    if (set > 0 && set < 3) {
      const missing = [
        publicKey ? null : 'LANGFUSE_PUBLIC_KEY',
        secretKey ? null : 'LANGFUSE_SECRET_KEY',
        host ? null : 'LANGFUSE_HOST',
      ].filter((name) => name !== null);
      this.logger.warn(`Usage tracing is off: ${missing.join(', ')} not set`);
    }
    if (this.tracer.enabled && env.tracer.captureContent) {
      this.logger.warn(
        'LANGFUSE_CAPTURE_CONTENT is on: prompt and response text is being sent to Langfuse (synthetic content only)',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.tracer.flush().catch(() => undefined);
  }
}

/** Global. Provides the chat and embeddings providers (built with the tracer) and the tracer itself. */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: USAGE_TRACER,
      inject: [ENV],
      useFactory: (env: Env): UsageTracer =>
        createUsageTracer(env.tracer, { logger: new Logger('UsageTracer') }),
    },
    {
      provide: CHAT_PROVIDER,
      inject: [ENV, USAGE_TRACER],
      useFactory: (env: Env, tracer: UsageTracer) =>
        createChatProvider(env.llm, { tracer, logger: new Logger('LlmProvider') }),
    },
    {
      provide: EMBEDDINGS_PROVIDER,
      inject: [ENV, USAGE_TRACER],
      useFactory: (env: Env, tracer: UsageTracer) =>
        createEmbeddingsProvider(env.embeddings, { tracer }),
    },
    LlmLifecycle,
    EmbeddingDimensionCheck,
  ],
  exports: [CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER],
})
export class LlmModule {}
