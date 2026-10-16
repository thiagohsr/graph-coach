import type { z } from 'zod';
import {
  ProviderError,
  ProviderOutputError,
  ProviderUnavailableError,
  attachUsage,
} from './errors';
import type { ChatMessage, ProviderName } from './types';
import type { ChatResult, EmbeddingsResult, StructuredResult, Usage } from './usage';
import { ZERO_USAGE, addUsage } from './usage';
import type { CallRecord, StepHandle, UsageTracer } from './usage-tracer';

/** What one model call returns, before validation. */
export interface RawChat {
  text: string;
  usage: Usage;
  usageReported: boolean;
}

/** Reports one model call (one attempt) to the tracer. `content` is only used when the tracer supports capture. */
export type CallReporter = (
  call: { usage: Usage; usageReported: boolean; durationMs: number; ok: boolean },
  content?: { input: string; output: string },
) => void;

/** Builds a reporter, or undefined when there is no tracer or no step (nothing is recorded then). */
export function makeReporter(
  tracer: UsageTracer | undefined,
  step: StepHandle | undefined,
  base: { provider: ProviderName; model: string; label?: string | undefined },
): CallReporter | undefined {
  if (!tracer || !step) return undefined;
  return (call, content) => {
    const record: CallRecord = {
      model: base.model,
      provider: base.provider,
      usage: call.usage,
      durationMs: call.durationMs,
      ok: call.ok,
      usageReported: call.usageReported,
      ...(base.label ? { label: base.label } : {}),
    };
    try {
      if (content && tracer.content) tracer.content.recordCallWithContent(step, record, content);
      else tracer.recordCall(step, record);
    } catch {
      // tracing never changes a provider result
    }
  };
}

const joinContents = (messages: ChatMessage[]) => messages.map((m) => m.content).join('\n');

function failed(e: unknown, provider: string, label?: string): ProviderError {
  if (e instanceof ProviderError) return e;
  return new ProviderUnavailableError(e instanceof Error ? e.message : String(e), {
    provider,
    cause: e,
    ...(label ? { label } : {}),
  });
}

/** A call "was made" when its usage counts a model call; errors raised before any request carry ZERO_USAGE. */
const wasMade = (usage: Usage) => usage.modelCalls > 0;

/** One model call, with reporting and usage attached to a failure. */
export async function runComplete(args: {
  provider: ProviderName;
  label?: string | undefined;
  messages: ChatMessage[];
  call: (messages: ChatMessage[]) => Promise<RawChat>;
  report?: CallReporter | undefined;
}): Promise<ChatResult> {
  const start = Date.now();
  try {
    const raw = await args.call(args.messages);
    args.report?.(
      {
        usage: raw.usage,
        usageReported: raw.usageReported,
        durationMs: Date.now() - start,
        ok: true,
      },
      { input: joinContents(args.messages), output: raw.text },
    );
    return { text: raw.text, usage: raw.usage, usageReported: raw.usageReported };
  } catch (e) {
    const err = failed(e, args.provider, args.label);
    if (wasMade(err.usage)) {
      args.report?.({
        usage: err.usage,
        usageReported: true,
        durationMs: Date.now() - start,
        ok: false,
      });
    }
    throw err;
  }
}

/** One embeddings request, with reporting. */
export async function runEmbed(args: {
  provider: ProviderName;
  label?: string | undefined;
  call: () => Promise<EmbeddingsResult>;
  report?: CallReporter | undefined;
}): Promise<EmbeddingsResult> {
  const start = Date.now();
  try {
    const r = await args.call();
    args.report?.({
      usage: r.usage,
      usageReported: r.usageReported,
      durationMs: Date.now() - start,
      ok: true,
    });
    return r;
  } catch (e) {
    const err = failed(e, args.provider, args.label);
    if (wasMade(err.usage)) {
      args.report?.({
        usage: err.usage,
        usageReported: true,
        durationMs: Date.now() - start,
        ok: false,
      });
    }
    throw err;
  }
}

function stripFences(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return m ? (m[1] ?? text) : text;
}

function describeIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * The shared validate-and-retry loop. Each attempt is one model call; the output is parsed as JSON and checked with
 * `schema.safeParse`. On failure the issues are appended as a user message and the call is repeated, up to
 * `maxRetries` more times, then ProviderOutputError is thrown. Usage is summed over every attempt and put on the
 * result or on the thrown error. Every attempt is reported (ok: false when its output was invalid or the call failed).
 */
export async function runStructured<T>(args: {
  provider: ProviderName;
  label?: string | undefined;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  maxRetries?: number | undefined;
  call: (messages: ChatMessage[], attempt: number) => Promise<RawChat>;
  report?: CallReporter | undefined;
}): Promise<StructuredResult<T>> {
  const maxRetries = Math.max(0, args.maxRetries ?? 1);
  let messages = args.messages;
  let total: Usage = { ...ZERO_USAGE };
  let allReported = true;

  for (let attempt = 1; ; attempt++) {
    const start = Date.now();
    let raw: RawChat;
    try {
      raw = await args.call(messages, attempt);
    } catch (e) {
      const err = failed(e, args.provider, args.label);
      if (wasMade(err.usage)) {
        args.report?.({
          usage: err.usage,
          usageReported: true,
          durationMs: Date.now() - start,
          ok: false,
        });
      }
      throw attachUsage(err, addUsage(total, err.usage));
    }
    total = addUsage(total, raw.usage);
    allReported = allReported && raw.usageReported;

    let issues: z.ZodIssue[];
    let value: T | undefined;
    let valid = false;
    try {
      const parsed = args.schema.safeParse(JSON.parse(stripFences(raw.text)));
      if (parsed.success) {
        valid = true;
        value = parsed.data;
        issues = [];
      } else {
        issues = parsed.error.issues;
      }
    } catch (e) {
      issues = [
        {
          code: 'custom',
          path: [],
          message: `Reply is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
        },
      ];
    }

    args.report?.(
      {
        usage: raw.usage,
        usageReported: raw.usageReported,
        durationMs: Date.now() - start,
        ok: valid,
      },
      { input: joinContents(messages), output: raw.text },
    );

    if (valid) {
      return { value: value as T, usage: total, usageReported: allReported, attempts: attempt };
    }
    if (attempt > maxRetries) {
      throw new ProviderOutputError(
        `Model output failed validation after ${attempt} attempt(s): ${describeIssues(issues)}`,
        {
          provider: args.provider,
          issues,
          raw: raw.text,
          usage: total,
          ...(args.label ? { label: args.label } : {}),
        },
      );
    }
    messages = [
      ...args.messages,
      {
        role: 'user',
        content: `Your previous reply was invalid: ${describeIssues(issues)}. Reply again with only valid JSON that matches the required schema.`,
      },
    ];
  }
}
