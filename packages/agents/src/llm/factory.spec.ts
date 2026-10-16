import { describe, expect, it } from 'vitest';
import {
  ProviderConfigError,
  ProviderUnavailableError,
  RecordingUsageTracer,
  createChatProvider,
  createEmbeddingsProvider,
  embeddingsConfigFromEnv,
  llmConfigFromEnv,
} from './index';

const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('createChatProvider', () => {
  it('builds a stub with no responses from provider "stub"', async () => {
    const chat = createChatProvider({ provider: 'stub', model: 'stub-chat' });
    expect(chat.name).toBe('stub');
    const err = await chat.complete(msgs, { label: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as Error).message).toBe(
      'LLM provider is "stub"; set LLM_PROVIDER to use this feature',
    );
  });

  it('rejects openai without key or model, listing both', () => {
    expect.assertions(3);
    try {
      createChatProvider({ provider: 'openai', model: '' });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderConfigError);
      expect((e as Error).message).toMatch(/model/i);
      expect((e as Error).message).toMatch(/key/i);
    }
  });

  it('builds openai and ollama providers without any network call', () => {
    const o = createChatProvider({
      provider: 'openai',
      model: 'gpt-x',
      apiKey: 'k',
      baseUrl: 'http://localhost:1/v1',
    });
    expect(o.name).toBe('openai');
    expect(o.model).toBe('gpt-x');
    const l = createChatProvider({ provider: 'ollama', model: 'llama3' });
    expect(l.name).toBe('ollama');
  });

  it('a stub built with a tracer reports to it', async () => {
    const tracer = new RecordingUsageTracer();
    const chat = createEmbeddingsProvider(
      { provider: 'stub', model: 'stub-embeddings', dimension: 16 },
      { tracer },
    );
    const run = tracer.startRun({ id: 'r', kind: 'ingest', userId: 'u' });
    await chat.embed(['a'], { trace: tracer.startStep(run, 's') });
    expect(tracer.calls).toHaveLength(1);
  });
});

describe('createEmbeddingsProvider', () => {
  it('builds a working stub', async () => {
    const e = createEmbeddingsProvider({
      provider: 'stub',
      model: 'stub-embeddings',
      dimension: 12,
    });
    expect(e.dimension).toBe(12);
    expect((await e.embed(['x'])).vectors[0]).toHaveLength(12);
  });

  it('rejects openai without key or model', () => {
    expect(() => createEmbeddingsProvider({ provider: 'openai', model: '', dimension: 8 })).toThrow(
      ProviderConfigError,
    );
  });
});

describe('config from env', () => {
  it('llmConfigFromEnv reads the LLM_* variables', () => {
    expect(
      llmConfigFromEnv({
        LLM_PROVIDER: 'openai',
        LLM_MODEL: 'm',
        LLM_API_KEY: 'k',
        LLM_BASE_URL: 'http://h/v1',
      }),
    ).toEqual({ provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'http://h/v1' });
    expect(llmConfigFromEnv({ LLM_PROVIDER: 'stub' }).provider).toBe('stub');
  });

  it('llmConfigFromEnv lists every problem', () => {
    expect.assertions(2);
    try {
      llmConfigFromEnv({ LLM_PROVIDER: 'openai' });
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderConfigError);
      expect((e as Error).message).toMatch(
        /LLM_MODEL[\s\S]*LLM_API_KEY|LLM_API_KEY[\s\S]*LLM_MODEL/,
      );
    }
  });

  it('embeddingsConfigFromEnv defaults the dimension to 64 only for the stub', () => {
    expect(embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'stub' }).dimension).toBe(64);
    expect(
      embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'stub', EMBEDDING_DIM: '32' }).dimension,
    ).toBe(32);
    expect(() =>
      embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'ollama', EMBEDDING_MODEL: 'm' }),
    ).toThrow(ProviderConfigError);
    expect(
      embeddingsConfigFromEnv({
        EMBEDDING_PROVIDER: 'ollama',
        EMBEDDING_MODEL: 'm',
        EMBEDDING_DIM: '1024',
      }).dimension,
    ).toBe(1024);
  });

  it('rejects an unknown provider and a bad dimension', () => {
    expect(() => llmConfigFromEnv({ LLM_PROVIDER: 'nope' })).toThrow(ProviderConfigError);
    expect(() =>
      embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'stub', EMBEDDING_DIM: 'abc' }),
    ).toThrow(ProviderConfigError);
  });
});
