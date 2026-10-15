import type { z } from 'zod';
import type { StepHandle } from './usage-tracer';
import type { ChatResult, EmbeddingsResult, StructuredResult } from './usage';

export type ProviderName = 'stub' | 'openai' | 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  /** Call-site name, e.g. 'curator.extractConcepts'; used by stubs, logs, and traces. */
  label?: string;
  /** Default 0. */
  temperature?: number;
  maxTokens?: number;
  /** Default 60_000. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** When given, each model call is reported to the UsageTracer under this step. */
  trace?: StepHandle;
}

export interface StructuredOptions extends ChatOptions {
  /** Default 1: one more attempt with the validation issues appended. */
  maxRetries?: number;
  /** Name given to the provider's structured-output feature. */
  schemaName?: string;
}

export interface EmbedOptions {
  label?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  trace?: StepHandle;
}

export interface ChatProvider {
  readonly name: ProviderName;
  readonly model: string;
  /** Plain text completion: one model call. */
  complete(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  /** value has passed schema.parse. usage is the sum over all attempts. Throws ProviderOutputError when retries are exhausted. */
  completeStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options?: StructuredOptions,
  ): Promise<StructuredResult<T>>;
}

export interface EmbeddingsProvider {
  readonly name: ProviderName;
  readonly model: string;
  readonly dimension: number;
  /** One vector per input, same order, each of length = dimension. */
  embed(texts: string[], options?: EmbedOptions): Promise<EmbeddingsResult>;
}
