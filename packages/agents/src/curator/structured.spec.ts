import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProviderOutputError, ProviderUnavailableError } from '../llm/errors';
import type { StructuredOptions } from '../llm/types';
import { StubChatProvider, stubTokens } from '../llm/stub';
import { ZERO_USAGE } from '../llm/usage';
import { RecordingUsageTracer } from '../llm/recording-usage-tracer';
import { MAX_OUTPUT_RETRIES } from './constants';
import { CuratorStepError, UsageMeter } from './ports';
import { callStructured } from './structured';

const Schema = z.object({ n: z.number() });
const trace = { runId: 'run', node: 'extractConcepts' };

function setup() {
  const tracer = new RecordingUsageTracer();
  const chat = new StubChatProvider({ tracer });
  const meter = new UsageMeter();
  const request = {
    node: 'extractConcepts' as const,
    label: 'curator.extractConcepts',
    schema: Schema,
    system: 'sys',
    user: 'usr',
  };
  return { chat, meter, tracer, request };
}

describe('callStructured', () => {
  it('returns the validated value and adds the usage to the meter', async () => {
    const { chat, meter, request } = setup();
    chat.on('curator.extractConcepts', { n: 7 });
    const value = await callStructured({ chat }, { meter, trace }, request);
    expect(value).toEqual({ n: 7 });
    expect(meter.total()).toEqual({
      modelCalls: 1,
      inputTokens: stubTokens('sys\nusr'),
      outputTokens: stubTokens('{"n":7}'),
      embeddingTokens: 0,
    });
  });

  it('passes the label, the schema name, the retry limit, and the trace handle to the provider', async () => {
    const { chat, meter, request } = setup();
    chat.on('curator.extractConcepts', { n: 1 });
    await callStructured({ chat }, { meter, trace }, request);
    const call = chat.calls[0]!;
    expect(call.label).toBe('curator.extractConcepts');
    expect(call.structured).toBe(true);
    const options = call.options as StructuredOptions;
    expect(options.maxRetries).toBe(MAX_OUTPUT_RETRIES);
    expect(call.options.trace).toBe(trace);
    expect(options.schemaName).toBeTruthy();
    expect(call.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('adds the usage of every attempt when the provider retried', async () => {
    const { chat, meter, request } = setup();
    chat.enqueue('curator.extractConcepts', { n: 'wrong' }, { n: 2 });
    const value = await callStructured({ chat }, { meter, trace }, request);
    expect(value).toEqual({ n: 2 });
    expect(chat.callCount('curator.extractConcepts')).toBe(2);
    expect(meter.total().modelCalls).toBe(2);
  });

  it('maps exhausted retries to INVALID_MODEL_OUTPUT without echoing the output, and keeps the spent usage', async () => {
    const { chat, meter, request } = setup();
    chat.on('curator.extractConcepts', { n: 'SECRET-MODEL-TEXT' });
    const error = await callStructured({ chat }, { meter, trace }, request).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CuratorStepError);
    expect(error).toMatchObject({ code: 'INVALID_MODEL_OUTPUT', node: 'extractConcepts' });
    expect((error as Error).message).not.toContain('SECRET-MODEL-TEXT');
    expect(chat.callCount()).toBe(1 + MAX_OUTPUT_RETRIES);
    expect(meter.total().modelCalls).toBe(1 + MAX_OUTPUT_RETRIES);
  });

  it('maps an unavailable provider to PROVIDER_UNAVAILABLE and adds the usage of the failed call', async () => {
    const { chat, meter, request } = setup();
    chat.on(
      'curator.extractConcepts',
      new ProviderUnavailableError('down', {
        provider: 'stub',
        usage: { ...ZERO_USAGE, modelCalls: 1, inputTokens: 9 },
      }),
    );
    await expect(callStructured({ chat }, { meter, trace }, request)).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
    expect(meter.total()).toMatchObject({ modelCalls: 1, inputTokens: stubTokens('sys\nusr') });
  });

  it('maps a ProviderOutputError thrown by the provider the same way', async () => {
    const meter = new UsageMeter();
    const chat = {
      completeStructured: async () => {
        throw new ProviderOutputError('bad', {
          provider: 'x',
          issues: [],
          raw: 'RAW',
          usage: { ...ZERO_USAGE, modelCalls: 3 },
        });
      },
    } as never;
    await expect(
      callStructured(
        { chat },
        { meter, trace },
        { node: 'draftQuestions', label: 'l', schema: Schema, system: 's', user: 'u' },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT', node: 'draftQuestions' });
    expect(meter.total().modelCalls).toBe(3);
  });

  it('lets errors that are not provider errors through unchanged', async () => {
    const meter = new UsageMeter();
    const chat = { completeStructured: async () => Promise.reject(new TypeError('bug')) } as never;
    await expect(
      callStructured(
        { chat },
        { meter, trace },
        { node: 'draftQuestions', label: 'l', schema: Schema, system: 's', user: 'u' },
      ),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('makes no tracer call of its own', async () => {
    const { chat, meter, request, tracer } = setup();
    chat.on('curator.extractConcepts', { n: 1 });
    await callStructured({ chat }, { meter, trace }, request);
    // The stub reports the call itself (the provider owns that); callStructured adds no start/end events.
    expect(tracer.runs).toEqual([]);
    expect(tracer.steps).toEqual([]);
  });
});
