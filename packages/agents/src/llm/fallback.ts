import type { z } from 'zod';
import type { ChatMessage, ChatOptions, ChatProvider, ProviderName, StructuredOptions } from './types';
import type { ChatResult, StructuredResult } from './usage';

/** A chat provider that picks its real provider when a run starts, not per call. */
export interface RunScopedChatProvider extends ChatProvider {
  /** Resolves the provider for one run. Use the result for every call of the run. */
  forRun(): Promise<ChatProvider>;
}

export function isRunScoped(chat: ChatProvider): chat is RunScopedChatProvider {
  return typeof (chat as Partial<RunScopedChatProvider>).forRun === 'function';
}

/** The provider one run must use: resolved now for a run-scoped provider, the provider itself otherwise. */
export function chatForRun(chat: ChatProvider): Promise<ChatProvider> {
  return isRunScoped(chat) ? chat.forRun() : Promise.resolve(chat);
}

export interface FallbackLogger {
  log(message: string): void;
  warn(message: string): void;
}

/**
 * "Ollama primary, OpenRouter fallback". `forRun()` probes the primary (the probe is cached) and returns the primary
 * when it answers, the fallback otherwise; a run calls it once so it never changes model midway. When there is no
 * fallback the primary is returned either way and its own errors surface. Direct calls on this object resolve per call,
 * for callers that are not runs.
 */
export class FallbackChatProvider implements RunScopedChatProvider {
  constructor(
    private readonly primary: ChatProvider,
    private readonly fallback: ChatProvider | undefined,
    private readonly isPrimaryUp: () => Promise<boolean>,
    private readonly logger: FallbackLogger = console,
  ) {}

  get name(): ProviderName {
    return this.primary.name;
  }

  get model(): string {
    return this.primary.model;
  }

  async forRun(): Promise<ChatProvider> {
    if (await this.isPrimaryUp()) return this.primary;
    if (!this.fallback) {
      this.logger.warn(`${this.primary.name} is unreachable and no fallback is configured`);
      return this.primary;
    }
    this.logger.warn(`${this.primary.name} is unreachable; this run uses ${this.fallback.name} (${this.fallback.model})`);
    return this.fallback;
  }

  async complete(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult> {
    return (await this.forRun()).complete(messages, options);
  }

  async completeStructured<T>(
    messages: ChatMessage[],
    schema: z.ZodType<T>,
    options?: StructuredOptions,
  ): Promise<StructuredResult<T>> {
    return (await this.forRun()).completeStructured(messages, schema, options);
  }
}
