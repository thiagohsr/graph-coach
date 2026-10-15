// Stub providers for the test application: the real `LlmModule` tokens, overridden with stubs built on a recording tracer
// so tests can script responses and assert on usage.
import { Module, type DynamicModule, type Type } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import {
  RecordingUsageTracer,
  StubChatProvider,
  StubEmbeddingsProvider,
} from '@coach/agents/testing';
import {
  CHAT_PROVIDER,
  EMBEDDINGS_PROVIDER,
  USAGE_TRACER,
} from '../../src/common/llm/llm.module';

export { CHAT_PROVIDER, EMBEDDINGS_PROVIDER, USAGE_TRACER };

export interface TestProviders {
  chat: StubChatProvider;
  embeddings: StubEmbeddingsProvider;
  tracer: RecordingUsageTracer;
}

/** Stub providers built with the recording tracer, so tests can assert on usage. */
export function createTestProviders(embeddingDim = 64): TestProviders {
  const tracer = new RecordingUsageTracer();
  return {
    chat: new StubChatProvider({ tracer }),
    embeddings: new StubEmbeddingsProvider(embeddingDim, { tracer }),
    tracer,
  };
}

/** Replaces the three `LlmModule` providers with the stubs. */
export function overrideProviders(
  builder: TestingModuleBuilder,
  providers: TestProviders,
): TestingModuleBuilder {
  return builder
    .overrideProvider(CHAT_PROVIDER)
    .useValue(providers.chat)
    .overrideProvider(EMBEDDINGS_PROVIDER)
    .useValue(providers.embeddings)
    .overrideProvider(USAGE_TRACER)
    .useValue(providers.tracer);
}

/** A module that mounts test-only controllers (for example a route with @Roles) in the application under test. */
export function testControllersModule(controllers: Type[] = []): DynamicModule {
  @Module({})
  class TestControllersModule {}
  return { module: TestControllersModule, controllers };
}
