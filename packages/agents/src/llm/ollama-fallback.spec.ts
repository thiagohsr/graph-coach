import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FallbackChatProvider,
  ProviderConfigError,
  StubChatProvider,
  cfAccessHeaders,
  chatForRun,
  createChatProvider,
  createEmbeddingsProvider,
  createOllamaHealthCheck,
  embeddingsConfigFromEnv,
  llmConfigFromEnv,
  openRouterHeaders,
  type ChatProvider,
} from './index';
import type { FetchLike } from './ollama-health';

const cf = { clientId: 'id-123', clientSecret: 'secret-456' };
const msgs = [{ role: 'user' as const, content: 'hi' }];

/** A fake fetch whose answers are scripted; records what it was asked. */
function fakeFetch(answer: (n: number, signal: AbortSignal) => Promise<{ ok: boolean }>) {
  const calls: Array<{ url: string; headers: Record<string, string> | undefined }> = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, headers: init.headers });
    return answer(calls.length, init.signal);
  };
  return { fn, calls };
}

describe('createOllamaHealthCheck', () => {
  it('reports up and probes GET <base>/api/tags', async () => {
    const f = fakeFetch(async () => ({ ok: true }));
    const check = createOllamaHealthCheck({ baseUrl: 'http://o:11434/', fetch: f.fn });
    expect(await check()).toBe(true);
    expect(f.calls[0]!.url).toBe('http://o:11434/api/tags');
  });

  it('reports down for a non-2xx answer and for a network error', async () => {
    const bad = createOllamaHealthCheck({
      baseUrl: 'http://o',
      fetch: fakeFetch(async () => ({ ok: false })).fn,
    });
    expect(await bad()).toBe(false);
    const boom = createOllamaHealthCheck({
      baseUrl: 'http://o',
      fetch: fakeFetch(async () => {
        throw new Error('ECONNREFUSED');
      }).fn,
    });
    expect(await boom()).toBe(false);
  });

  it('aborts after the timeout (2 s by default) and reports down', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeFetch(
        (_n, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          ),
      );
      const check = createOllamaHealthCheck({ baseUrl: 'http://o', fetch: f.fn });
      const result = check();
      await vi.advanceTimersByTimeAsync(1_999);
      let settled = false;
      void result.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(await result).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caches the result for 30 s, up or down, then probes again', async () => {
    let t = 1_000;
    const f = fakeFetch(async (n) => ({ ok: n !== 1 }));
    const check = createOllamaHealthCheck({ baseUrl: 'http://o', fetch: f.fn, now: () => t });
    expect(await check()).toBe(false);
    t += 29_999;
    expect(await check()).toBe(false);
    expect(f.calls).toHaveLength(1);
    t += 1;
    expect(await check()).toBe(true);
    expect(f.calls).toHaveLength(2);
  });

  it('sends the Access headers when configured and none otherwise', async () => {
    const withCf = fakeFetch(async () => ({ ok: true }));
    await createOllamaHealthCheck({ baseUrl: 'http://o', cfAccess: cf, fetch: withCf.fn })();
    expect(withCf.calls[0]!.headers).toEqual({
      'CF-Access-Client-Id': 'id-123',
      'CF-Access-Client-Secret': 'secret-456',
    });
    const without = fakeFetch(async () => ({ ok: true }));
    await createOllamaHealthCheck({ baseUrl: 'http://o', fetch: without.fn })();
    expect(without.calls[0]!.headers).toBeUndefined();
  });
});

describe('header helpers', () => {
  it('cfAccessHeaders is undefined without a token', () => {
    expect(cfAccessHeaders(undefined)).toBeUndefined();
    expect(cfAccessHeaders(cf)).toEqual({
      'CF-Access-Client-Id': 'id-123',
      'CF-Access-Client-Secret': 'secret-456',
    });
  });

  it('openRouterHeaders carries the referer and the app title', () => {
    expect(openRouterHeaders()).toMatchObject({ 'X-Title': 'Graph Coach' });
    expect(openRouterHeaders()['HTTP-Referer']).toBeTruthy();
  });
});

describe('FallbackChatProvider', () => {
  const named = (name: 'ollama' | 'openrouter', model: string): ChatProvider => {
    const stub = new StubChatProvider({});
    return Object.assign(stub, { name, model }) as unknown as ChatProvider;
  };
  const quiet = { log: () => undefined, warn: vi.fn() };

  it('uses the primary while it is up and the fallback when it is down', async () => {
    const primary = named('ollama', 'qwen3:8b');
    const fallback = named('openrouter', 'openai/gpt-4o-mini');
    let up = true;
    const chat = new FallbackChatProvider(primary, fallback, async () => up, quiet);
    expect(await chat.forRun()).toBe(primary);
    up = false;
    const resolved = await chat.forRun();
    expect(resolved).toBe(fallback);
    expect([resolved.name, resolved.model]).toEqual(['openrouter', 'openai/gpt-4o-mini']);
  });

  it('falls back to the primary, which then fails by itself, when no fallback exists', async () => {
    const primary = named('ollama', 'qwen3:8b');
    const chat = new FallbackChatProvider(primary, undefined, async () => false, quiet);
    expect(await chat.forRun()).toBe(primary);
  });

  it('a run that resolved once keeps its provider even if Ollama goes down afterwards', async () => {
    const primary = named('ollama', 'qwen3:8b');
    const fallback = named('openrouter', 'openai/gpt-4o-mini');
    let up = true;
    const probe = vi.fn(async () => up);
    const chat = new FallbackChatProvider(primary, fallback, probe, quiet);
    const run = await chatForRun(chat); // resolved once at the start of the run
    up = false;
    for (let i = 0; i < 3; i += 1) expect(run).toBe(primary);
    expect(probe).toHaveBeenCalledTimes(1);
    // The next run resolves again.
    expect(await chatForRun(chat)).toBe(fallback);
  });

  it('chatForRun returns a plain provider unchanged', async () => {
    const plain = named('ollama', 'm');
    expect(await chatForRun(plain)).toBe(plain);
  });

  it('never logs the Access token or the key', async () => {
    const warn = vi.fn();
    const chat = createChatProvider(
      {
        provider: 'ollama-with-fallback',
        model: 'qwen3:8b',
        baseUrl: 'http://127.0.0.1:1',
        cfAccess: cf,
        fallback: { apiKey: 'sk-or-secret', model: 'openai/gpt-4o-mini' },
      },
      { logger: { log: () => undefined, warn }, fetch: async () => ({ ok: false }) },
    );
    await (chat as FallbackChatProvider).forRun();
    const logged = JSON.stringify(warn.mock.calls);
    for (const secret of ['secret-456', 'id-123', 'sk-or-secret'])
      expect(logged).not.toContain(secret);
  });
});

describe('factory: ollama-with-fallback', () => {
  it('builds a run-scoped provider and resolves it through the health probe', async () => {
    const config = {
      provider: 'ollama-with-fallback' as const,
      model: 'qwen3:8b',
      baseUrl: 'http://o',
      fallback: { apiKey: 'k', model: 'openai/gpt-4o-mini' },
    };
    const down = createChatProvider(config, {
      fetch: async () => ({ ok: false }),
      logger: { log() {}, warn() {} },
    });
    const r1 = await chatForRun(down);
    expect([r1.name, r1.model]).toEqual(['openrouter', 'openai/gpt-4o-mini']);
    const up = createChatProvider(config, { fetch: async () => ({ ok: true }) });
    const r2 = await chatForRun(up);
    expect([r2.name, r2.model]).toEqual(['ollama', 'qwen3:8b']);
  });

  it('requires the Ollama base URL', () => {
    expect(() =>
      createChatProvider({ provider: 'ollama-with-fallback', model: 'qwen3:8b' }),
    ).toThrow(ProviderConfigError);
  });
});

describe('config from the environment', () => {
  it('reads OLLAMA_*, CF_ACCESS_*, and OPENROUTER_* for ollama-with-fallback, with defaults', () => {
    const config = llmConfigFromEnv({
      LLM_PROVIDER: 'ollama-with-fallback',
      OLLAMA_BASE_URL: 'https://ollama.example.com',
      CF_ACCESS_CLIENT_ID: 'i',
      CF_ACCESS_CLIENT_SECRET: 's',
      OPENROUTER_API_KEY: 'k',
    });
    expect(config).toEqual({
      provider: 'ollama-with-fallback',
      model: 'qwen3:8b',
      baseUrl: 'https://ollama.example.com',
      cfAccess: { clientId: 'i', clientSecret: 's' },
      fallback: { apiKey: 'k', model: 'openai/gpt-4o-mini' },
    });
  });

  it('leaves out the token unless both halves are set, and the fallback unless the key is set', () => {
    const config = llmConfigFromEnv({
      LLM_PROVIDER: 'ollama-with-fallback',
      OLLAMA_BASE_URL: 'http://localhost:11434',
      CF_ACCESS_CLIENT_ID: 'i',
    });
    expect(config.cfAccess).toBeUndefined();
    expect(config.fallback).toBeUndefined();
  });

  it('embeddings via openrouter default to qwen/qwen3-embedding-8b and need a key and a dimension', () => {
    const config = embeddingsConfigFromEnv({
      EMBEDDING_PROVIDER: 'openrouter',
      EMBEDDING_DIM: '4096',
      OPENROUTER_API_KEY: 'k',
    });
    expect(config).toMatchObject({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      apiKey: 'k',
      dimension: 4096,
    });
    expect(() =>
      embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'openrouter', EMBEDDING_DIM: '4096' }),
    ).toThrow(/KEY/);
    expect(() =>
      embeddingsConfigFromEnv({ EMBEDDING_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'k' }),
    ).toThrow(/DIM/);
  });
});

describe('over HTTP (local fake servers, no real network)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(
    handler: (
      req: IncomingMessage,
      body: string,
    ) => { status?: number; body: unknown; ndjson?: boolean },
  ) {
    const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: string }> = [];
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', headers: req.headers, body: raw });
        const out = handler(req, raw);
        res.writeHead(out.status ?? 200, {
          'content-type': out.ndjson ? 'application/x-ndjson' : 'application/json',
        });
        res.end(out.ndjson ? `${JSON.stringify(out.body)}\n` : JSON.stringify(out.body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}`, seen };
  }

  const ollamaReply = {
    model: 'qwen3:8b',
    created_at: new Date().toISOString(),
    message: { role: 'assistant', content: 'ok' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 5,
    eval_count: 2,
  };

  it('Ollama chat sends think:false and the Access headers when configured', async () => {
    const srv = await listen(() => ({ body: ollamaReply, ndjson: true }));
    const chat = createChatProvider({
      provider: 'ollama',
      model: 'qwen3:8b',
      baseUrl: srv.url,
      cfAccess: cf,
    });
    const result = await chat.complete(msgs);
    expect(result.text).toBe('ok');
    const req = srv.seen.find((r) => r.url === '/api/chat')!;
    expect(req.headers['cf-access-client-id']).toBe('id-123');
    expect(req.headers['cf-access-client-secret']).toBe('secret-456');
    expect(JSON.parse(req.body)).toMatchObject({ model: 'qwen3:8b', think: false });
  });

  it('Ollama chat sends no Access headers without a token', async () => {
    const srv = await listen(() => ({ body: ollamaReply, ndjson: true }));
    await createChatProvider({ provider: 'ollama', model: 'qwen3:8b', baseUrl: srv.url }).complete(
      msgs,
    );
    const req = srv.seen.find((r) => r.url === '/api/chat')!;
    expect(req.headers['cf-access-client-id']).toBeUndefined();
    expect(req.headers['cf-access-client-secret']).toBeUndefined();
  });

  it('OpenRouter chat sends the attribution headers and the bearer key', async () => {
    const srv = await listen(() => ({
      body: {
        id: 'x',
        object: 'chat.completion',
        created: 1,
        model: 'openai/gpt-4o-mini',
        choices: [
          { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
      },
    }));
    const chat = createChatProvider(
      {
        provider: 'ollama-with-fallback',
        model: 'qwen3:8b',
        baseUrl: 'http://127.0.0.1:1',
        fallback: { apiKey: 'sk-or-test', model: 'openai/gpt-4o-mini', baseUrl: srv.url },
      },
      { fetch: async () => ({ ok: false }), logger: { log() {}, warn() {} } },
    );
    const run = await chatForRun(chat);
    const result = await run.complete(msgs);
    expect(result.text).toBe('ok');
    expect(result.usage).toMatchObject({ inputTokens: 4, outputTokens: 1 });
    const req = srv.seen[0]!;
    expect(req.url).toBe('/chat/completions');
    expect(req.headers['x-title']).toBe('Graph Coach');
    expect(req.headers['http-referer']).toBeTruthy();
    expect(req.headers.authorization).toBe('Bearer sk-or-test');
    expect(JSON.parse(req.body).model).toBe('openai/gpt-4o-mini');
  });

  const embeddingReply = (dim: number) => ({
    object: 'list',
    model: 'qwen/qwen3-embedding-8b',
    data: [{ object: 'embedding', index: 0, embedding: Array.from({ length: dim }, () => 0.1) }],
    usage: { prompt_tokens: 3, total_tokens: 3 },
  });

  it('OpenRouter embeddings use the configured model, headers, and report tokens', async () => {
    const srv = await listen(() => ({ body: embeddingReply(8) }));
    const emb = createEmbeddingsProvider({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      apiKey: 'sk-or-test',
      baseUrl: srv.url,
      dimension: 8,
    });
    expect(emb.name).toBe('openrouter');
    const result = await emb.embed(['hello']);
    expect(result.vectors[0]).toHaveLength(8);
    expect(result.usage.embeddingTokens).toBe(3);
    const req = srv.seen[0]!;
    expect(req.url).toBe('/embeddings');
    expect(req.headers['x-title']).toBe('Graph Coach');
    expect(JSON.parse(req.body).model).toBe('qwen/qwen3-embedding-8b');
  });

  it('fails loudly when the API returns vectors of another length than EMBEDDING_DIM', async () => {
    const srv = await listen(() => ({ body: embeddingReply(8) }));
    const emb = createEmbeddingsProvider({
      provider: 'openrouter',
      model: 'qwen/qwen3-embedding-8b',
      apiKey: 'k',
      baseUrl: srv.url,
      dimension: 4096,
    });
    const error = await emb.embed(['hello']).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderConfigError);
    expect((error as Error).message).toMatch(/length 8, expected 4096/);
  });
});
