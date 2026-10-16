import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ProviderConfigError,
  ProviderUnavailableError,
  StubChatProvider,
  createChatProvider,
  llmConfigFromEnv,
  promptHash,
  stubTokens,
} from './index';

const dir = join(__dirname, 'fixtures', 'recordings');
const question = [
  { role: 'system' as const, content: 'sys' },
  { role: 'user' as const, content: 'user question' },
];

describe('StubChatProvider.fromRecordings', () => {
  it('hashes the joined message contents with sha-256', () => {
    expect(promptHash(question)).toBe(
      '916708666a24a8c65e879cf02b01e386add11286b373468e54c8d92c5e3730e1',
    );
  });

  it('answers structured calls by label and prompt hash, with deterministic usage', async () => {
    const chat = StubChatProvider.fromRecordings(dir);
    const out = await chat.completeStructured(question, z.object({ answer: z.number() }), {
      label: 'demo.label',
    });
    expect(out.value).toEqual({ answer: 42 });
    expect(out.usage.inputTokens).toBe(stubTokens('sys\nuser question'));
    expect(out.usage.outputTokens).toBe(stubTokens('{"answer":42}'));
    expect(out.usage.modelCalls).toBe(1);
  });

  it('returns string responses as plain text', async () => {
    const chat = StubChatProvider.fromRecordings(dir);
    const out = await chat.complete([{ role: 'user', content: 'other' }], { label: 'demo.label' });
    expect(out.text).toBe('plain text reply');
  });

  it('throws ProviderUnavailableError naming the label, not the prompt, when nothing matches', async () => {
    const chat = StubChatProvider.fromRecordings(dir);
    const secret = 'SECRET PROMPT TEXT';
    const err = await chat
      .complete([{ role: 'user', content: secret }], { label: 'demo.label' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect((err as Error).message).toContain('"demo.label"');
    expect((err as Error).message).not.toContain(secret);
    const other = await chat
      .complete(question, { label: 'unknown.label' })
      .catch((e: unknown) => e);
    expect(other).toBeInstanceOf(ProviderUnavailableError);
  });

  it('never resolves traversal labels or non-json files', async () => {
    const chat = StubChatProvider.fromRecordings(dir);
    for (const label of [
      '../recordings/demo.label',
      '..',
      'demo.label/../demo.label',
      'ignored.txt',
      'ignored',
    ]) {
      const err = await chat.complete(question, { label }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ProviderUnavailableError);
    }
  });

  it('fails at start-up when the directory is missing', () => {
    expect(() => StubChatProvider.fromRecordings(join(dir, 'nope'))).toThrow(ProviderConfigError);
  });
});

describe('factory with file:// base URL', () => {
  it('selects recorded mode for LLM_PROVIDER=stub and LLM_BASE_URL=file://dir', async () => {
    const config = llmConfigFromEnv({
      LLM_PROVIDER: 'stub',
      LLM_BASE_URL: pathToFileURL(dir).href,
    });
    const chat = createChatProvider(config);
    const out = await chat.complete(question, { label: 'demo.label' });
    expect(out.text).toBe('{"answer":42}');
  });

  it('rejects file:// for other providers', () => {
    expect(() =>
      llmConfigFromEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'm', LLM_BASE_URL: 'file:///x' }),
    ).toThrow(/file:\/\//);
  });
});
