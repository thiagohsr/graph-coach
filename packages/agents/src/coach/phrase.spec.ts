// Model phrasing of the summary (T067) and the coach.phrase_fallback event (T068).
import { describe, expect, it, vi } from 'vitest';
import { ProviderUnavailableError } from '../llm/errors';
import { StubChatProvider, stubTokens } from '../llm/stub';
import type { ChatProvider } from '../llm/types';
import type { CallRecord } from '../llm/usage-tracer';
import { PHRASE_WITH_MODEL } from './constants';
import type { CoachDeps } from './deps';
import { runCoach } from './graph';
import { phraseSummary } from './phrase';
import { DEFAULT_COACH_SETTINGS } from './settings';
import {
  T,
  WORKED_IDS,
  createRecordingTracer,
  createStubCoachQueries,
  type StubCoachQueries,
} from './testing/stubs';

const TEMPLATE =
  'Practise "B-trees" first. Recommended puzzle: "Databases 101: Storage and B-trees".';
const MUST = ['B-trees', 'Databases 101: Storage and B-trees'];
const GOOD = 'Start with "B-trees": try "Databases 101: Storage and B-trees" next.';
const input = { learnerId: WORKED_IDS.learner, goalText: null, now: T };

function makeDeps(queries: StubCoachQueries, over: Partial<CoachDeps> = {}): CoachDeps {
  return { queries, settings: DEFAULT_COACH_SETTINGS, newId: () => 'run-1', ...over };
}

/** A chat provider with a scripted `complete`. */
function chat(complete: ChatProvider['complete']): ChatProvider {
  return {
    name: 'stub',
    model: 'scripted',
    complete,
    completeStructured: async () => {
      throw new Error('not used');
    },
  };
}

describe('phraseSummary', () => {
  it('accepts a rewrite that keeps the target and the puzzle name, read from result.text', async () => {
    const provider = chat(async () => ({
      text: `  ${GOOD}  `,
      usage: { modelCalls: 1, inputTokens: 11, outputTokens: 5, embeddingTokens: 0 },
      usageReported: true,
    }));
    const result = await phraseSummary(TEMPLATE, MUST, provider);
    expect(result).toEqual({
      text: GOOD,
      usage: { modelCalls: 1, inputTokens: 11, outputTokens: 5, embeddingTokens: 0 },
    });
  });

  it('sends the template and passes label, timeout, and the trace step', async () => {
    const complete = vi.fn<ChatProvider['complete']>(async () => ({
      text: GOOD,
      usage: { modelCalls: 1, inputTokens: 1, outputTokens: 1, embeddingTokens: 0 },
      usageReported: true,
    }));
    const step = { runId: 'r', node: 'explain' };
    await phraseSummary(TEMPLATE, MUST, chat(complete), { timeoutMs: 1234, trace: step });
    const [messages, options] = complete.mock.calls[0]!;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1]!.content).toBe(TEMPLATE);
    expect(options).toEqual({ label: 'coach.phraseSummary', timeoutMs: 1234, trace: step });
  });

  it('rejects a rewrite without the target name, without the puzzle name, empty, or over 400 characters, and still counts the usage', async () => {
    const stub = new StubChatProvider();
    const bad: Array<[string, string[]]> = [
      ['A friendly study tip with "Databases 101" only.', ['Indexes', 'Databases 101']], // target name missing
      ['Do "B-trees" soon.', MUST], // puzzle name missing
      ['', MUST], // empty
      [`B-trees Databases 101: Storage and B-trees ${'x'.repeat(400)}`, MUST], // too long
    ];
    for (const [text, must] of bad) {
      stub.reset();
      stub.on('coach.phraseSummary', text);
      const result = await phraseSummary(TEMPLATE, must, stub);
      expect(result.text).toBe(TEMPLATE);
      expect(result.fallback).toBe('rejected');
      expect(result.usage).toEqual({
        modelCalls: 1,
        inputTokens: stubTokens(stub.calls[0]!.messages.map((m) => m.content).join('\n')),
        outputTokens: stubTokens(text),
        embeddingTokens: 0,
      });
    }
  });

  it('a thrown error falls back to the template with the error usage', async () => {
    const failing = new StubChatProvider().on('coach.phraseSummary', new Error('boom'));
    const result = await phraseSummary(TEMPLATE, MUST, failing);
    expect(result).toMatchObject({ text: TEMPLATE, fallback: 'error' });
    expect(result.usage.modelCalls).toBe(1);

    const unavailable = chat(async () => {
      throw new ProviderUnavailableError('down', {
        provider: 'stub',
        usage: { modelCalls: 1, inputTokens: 9, outputTokens: 0, embeddingTokens: 0 },
      });
    });
    expect((await phraseSummary(TEMPLATE, MUST, unavailable)).usage).toEqual({
      modelCalls: 1,
      inputTokens: 9,
      outputTokens: 0,
      embeddingTokens: 0,
    });

    const plain = chat(async () => {
      throw new Error('not a provider error');
    });
    expect(await phraseSummary(TEMPLATE, MUST, plain)).toEqual({
      text: TEMPLATE,
      usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 },
      fallback: 'error',
    });
  });

  it('a call that outlasts the timeout falls back to the template', async () => {
    const hanging = chat(() => new Promise(() => undefined));
    const result = await phraseSummary(TEMPLATE, MUST, hanging, { timeoutMs: 20 });
    expect(result).toMatchObject({ text: TEMPLATE, fallback: 'error' });
  });
});

describe('explain with model phrasing', () => {
  it('is off by default', () => {
    expect(PHRASE_WITH_MODEL).toBe(false);
  });

  it('does not call the model while phrasing is off, even with a chat model', async () => {
    const stub = new StubChatProvider().on('coach.phraseSummary', GOOD);
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { chatModel: stub }), input);
    expect(stub.calls).toEqual([]);
    expect(queries.recorded[0]!.modelCalls).toBe(0);
  });

  it('stores the rewrite and its usage; target, puzzle, flags, and evidence are unchanged', async () => {
    const baseline = createStubCoachQueries();
    await runCoach(makeDeps(baseline), input);

    const response =
      'Begin with "B-trees" (the weaker one) using "Databases 101: Storage and B-trees".';
    const stub = new StubChatProvider().on('coach.phraseSummary', response);
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { chatModel: stub, phraseWithModel: true }), input);

    const recorded = queries.recorded[0]!;
    expect(recorded.summary).toBe(response);
    expect(recorded.modelCalls).toBe(1);
    expect(recorded.inputTokens).toBe(
      stubTokens(stub.calls[0]!.messages.map((m) => m.content).join('\n')),
    );
    expect(recorded.outputTokens).toBe(stubTokens(response));
    expect(recorded.embeddingTokens).toBe(0);
    // The run's chat provider and model are recorded (reconciliation M7); a run with no model call leaves them empty.
    expect([recorded.llmProvider, recorded.llmModel]).toEqual([stub.name, stub.model]);
    expect([baseline.recorded[0]!.llmProvider, baseline.recorded[0]!.llmModel]).toEqual(['', '']);
    const {
      summary: _s,
      modelCalls: _m,
      inputTokens: _i,
      outputTokens: _o,
      llmProvider: _p,
      llmModel: _l,
      ...rest
    } = recorded;
    const {
      summary: _bs,
      modelCalls: _bm,
      inputTokens: _bi,
      outputTokens: _bo,
      llmProvider: _bp,
      llmModel: _bl,
      ...baseRest
    } = baseline.recorded[0]!;
    expect(rest).toEqual(baseRest);
  });

  it('a rejected rewrite keeps the template, stores the usage, and logs coach.phrase_fallback without text', async () => {
    const response = 'Something with no names at all.';
    const stub = new StubChatProvider().on('coach.phraseSummary', response);
    const warn = vi.fn();
    const baseline = createStubCoachQueries();
    await runCoach(makeDeps(baseline), input);
    const queries = createStubCoachQueries();
    await runCoach(
      makeDeps(queries, { chatModel: stub, phraseWithModel: true, logger: { warn } }),
      input,
    );

    const recorded = queries.recorded[0]!;
    expect(recorded.summary).toBe(baseline.recorded[0]!.summary);
    expect(recorded.modelCalls).toBe(1);
    expect(recorded.outputTokens).toBe(stubTokens(response));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('coach.phrase_fallback', {
      runId: 'run-1',
      reason: 'rejected',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Something');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('B-trees');
  });

  it('a stub provider without responses (LLM_PROVIDER=stub) falls back to the template and logs once', async () => {
    const stub = new StubChatProvider();
    const warn = vi.fn();
    const baseline = createStubCoachQueries();
    await runCoach(makeDeps(baseline), input);
    const queries = createStubCoachQueries();
    const result = await runCoach(
      makeDeps(queries, { chatModel: stub, phraseWithModel: true, logger: { warn } }),
      input,
    );

    expect(result.outcome).toBe('recorded');
    expect(queries.recorded[0]!.summary).toBe(baseline.recorded[0]!.summary);
    expect(warn).toHaveBeenCalledWith('coach.phrase_fallback', { runId: 'run-1', reason: 'error' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a scripted ProviderUnavailableError stores that error usage', async () => {
    const provider = chat(async () => {
      throw new ProviderUnavailableError('down', {
        provider: 'stub',
        usage: { modelCalls: 1, inputTokens: 13, outputTokens: 0, embeddingTokens: 0 },
      });
    });
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { chatModel: provider, phraseWithModel: true }), input);
    expect(queries.recorded[0]).toMatchObject({
      modelCalls: 1,
      inputTokens: 13,
      outputTokens: 0,
      embeddingTokens: 0,
    });
  });

  it('with the recording tracer the provider reports one call whose record has only CallRecord fields', async () => {
    const tracer = createRecordingTracer();
    const stub = new StubChatProvider({ tracer }).on(
      'coach.phraseSummary',
      'Begin with "B-trees" via "Databases 101: Storage and B-trees".',
    );
    const queries = createStubCoachQueries();
    await runCoach(makeDeps(queries, { chatModel: stub, phraseWithModel: true, tracer }), input);

    const calls = tracer.callsTo('recordCall');
    expect(calls).toHaveLength(1);
    const [step, record] = calls[0]!.args as [{ node: string }, CallRecord];
    expect(step.node).toBe('explain');
    const allowed = ['model', 'provider', 'usage', 'durationMs', 'ok', 'label', 'usageReported'];
    expect(Object.keys(record).filter((key) => !allowed.includes(key))).toEqual([]);
    expect(record.label).toBe('coach.phraseSummary');
    expect(JSON.stringify(record)).not.toContain('B-trees');
  });
});
