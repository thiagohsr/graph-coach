import { z } from 'zod';
import { ProviderConfigError } from './errors';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_APP_TITLE = 'Graph Coach';

/** Cloudflare Access service token for an Ollama host behind the tunnel; absent when Ollama is reached directly. */
export const CfAccess = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) });
export type CfAccess = z.infer<typeof CfAccess>;

/** OpenRouter through its OpenAI-compatible API. `baseUrl` defaults to OPENROUTER_BASE_URL. */
export const OpenRouterConfig = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
});
export type OpenRouterConfig = z.infer<typeof OpenRouterConfig>;

/**
 * For "ollama-with-fallback", `model`/`baseUrl`/`cfAccess` describe Ollama (the primary) and `fallback` describes
 * OpenRouter. `fallback` may be absent outside production; then an unreachable Ollama is a provider error.
 */
export const LlmConfig = z.object({
  provider: z.enum(['stub', 'openai', 'ollama', 'ollama-with-fallback']),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  cfAccess: CfAccess.optional(),
  fallback: OpenRouterConfig.optional(),
});
export type LlmConfig = z.infer<typeof LlmConfig>;

export const EmbeddingsConfig = z.object({
  provider: z.enum(['stub', 'openai', 'ollama', 'openrouter']),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  cfAccess: CfAccess.optional(),
  dimension: z.number().int().positive(),
});
export type EmbeddingsConfig = z.infer<typeof EmbeddingsConfig>;

const STUB_DIMENSION = 64;

const blank = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/** Problems that apply to a parsed config regardless of where it came from. `prefix` names the env variables. */
export function configProblems(
  config: { provider: string; model: string; apiKey?: string | undefined; baseUrl?: string | undefined },
  prefix: 'LLM' | 'EMBEDDING',
): string[] {
  const problems: string[] = [];
  if (config.baseUrl?.startsWith('file:') && !(prefix === 'LLM' && config.provider === 'stub')) {
    problems.push(`${prefix}_BASE_URL with file:// is only allowed when LLM_PROVIDER is "stub"`);
  }
  if (config.provider === 'ollama-with-fallback' && !config.baseUrl) {
    problems.push(`${prefix}_BASE_URL (OLLAMA_BASE_URL) is required when ${prefix}_PROVIDER is "ollama-with-fallback"`);
  }
  if (config.provider !== 'stub' && !config.model.trim()) {
    problems.push(`${prefix}_MODEL is required when ${prefix}_PROVIDER is "${config.provider}"`);
  }
  if ((config.provider === 'openai' || config.provider === 'openrouter') && !config.apiKey) {
    problems.push(`${prefix}_API_KEY is required when ${prefix}_PROVIDER is "${config.provider}"`);
  }
  return problems;
}

export function assertValidConfig(
  config: { provider: string; model: string; apiKey?: string | undefined; baseUrl?: string | undefined },
  prefix: 'LLM' | 'EMBEDDING',
): void {
  const problems = configProblems(config, prefix);
  if (problems.length > 0) {
    throw new ProviderConfigError(`Invalid ${prefix} configuration: ${problems.join('; ')}`, {
      provider: config.provider,
    });
  }
}

function fromEnv<S extends z.ZodTypeAny>(
  schema: S,
  raw: Record<string, unknown>,
  prefix: 'LLM' | 'EMBEDDING',
  extraProblems: string[],
): z.infer<S> {
  const problems = [...extraProblems];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      problems.push(`${prefix}_${String(issue.path[0] ?? 'CONFIG').toUpperCase()}: ${issue.message}`);
    }
  } else {
    problems.push(...configProblems(parsed.data, prefix));
  }
  if (problems.length > 0 || !parsed.success) {
    throw new ProviderConfigError(`Invalid ${prefix} configuration: ${problems.join('; ')}`, {
      provider: String(raw.provider ?? 'unknown'),
    });
  }
  return parsed.data;
}

export const DEFAULT_OLLAMA_BASE_URL = 'https://ollama.example.com';
export const DEFAULT_OLLAMA_MODEL = 'qwen3:8b';
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
export const DEFAULT_OPENROUTER_EMBEDDING_MODEL = 'qwen/qwen3-embedding-8b';

/** CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET together, or nothing. */
export function cfAccessFromEnv(env: NodeJS.ProcessEnv): CfAccess | undefined {
  const clientId = blank(env.CF_ACCESS_CLIENT_ID);
  const clientSecret = blank(env.CF_ACCESS_CLIENT_SECRET);
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

/**
 * Reads LLM_PROVIDER (default "stub"), LLM_MODEL, LLM_BASE_URL, LLM_API_KEY. For "ollama-with-fallback" it reads
 * OLLAMA_BASE_URL, OLLAMA_MODEL, CF_ACCESS_CLIENT_ID/SECRET, OPENROUTER_API_KEY and OPENROUTER_MODEL instead.
 * Throws ProviderConfigError listing every problem.
 */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = blank(env.LLM_PROVIDER) ?? 'stub';
  const withFallback = provider === 'ollama-with-fallback';
  const cfAccess = provider === 'ollama' || withFallback ? cfAccessFromEnv(env) : undefined;
  const openRouterKey = blank(env.OPENROUTER_API_KEY);
  return fromEnv(
    LlmConfig,
    {
      provider,
      model: withFallback
        ? (blank(env.OLLAMA_MODEL) ?? blank(env.LLM_MODEL) ?? DEFAULT_OLLAMA_MODEL)
        : (blank(env.LLM_MODEL) ?? (provider === 'stub' ? 'stub-chat' : '')),
      baseUrl: withFallback
        ? (blank(env.OLLAMA_BASE_URL) ?? blank(env.LLM_BASE_URL) ?? DEFAULT_OLLAMA_BASE_URL)
        : blank(env.LLM_BASE_URL),
      apiKey: blank(env.LLM_API_KEY),
      ...(cfAccess ? { cfAccess } : {}),
      ...(withFallback && openRouterKey
        ? { fallback: { apiKey: openRouterKey, model: blank(env.OPENROUTER_MODEL) ?? DEFAULT_OPENROUTER_MODEL } }
        : {}),
    },
    'LLM',
    [],
  );
}

/**
 * Reads EMBEDDING_PROVIDER (default "stub"), EMBEDDING_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_DIM.
 * For "openrouter" the model falls back to OPENROUTER_EMBEDDING_MODEL and the key to OPENROUTER_API_KEY.
 */
export function embeddingsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingsConfig {
  const provider = blank(env.EMBEDDING_PROVIDER) ?? 'stub';
  const problems: string[] = [];
  const dimText = blank(env.EMBEDDING_DIM);
  let dimension: number | undefined;
  if (dimText !== undefined) {
    dimension = /^\d+$/.test(dimText) ? Number(dimText) : undefined;
    if (dimension === undefined || dimension <= 0) {
      problems.push(`EMBEDDING_DIM must be a positive integer, got "${dimText}"`);
      dimension = undefined;
    }
  } else if (provider === 'stub') {
    dimension = STUB_DIMENSION;
  } else {
    problems.push(`EMBEDDING_DIM is required when EMBEDDING_PROVIDER is "${provider}"`);
  }
  const viaOpenRouter = provider === 'openrouter';
  const cfAccess = provider === 'ollama' ? cfAccessFromEnv(env) : undefined;
  return fromEnv(
    EmbeddingsConfig,
    {
      provider,
      model:
        blank(env.EMBEDDING_MODEL) ??
        (viaOpenRouter
          ? (blank(env.OPENROUTER_EMBEDDING_MODEL) ?? DEFAULT_OPENROUTER_EMBEDDING_MODEL)
          : provider === 'stub'
            ? 'stub-embeddings'
            : ''),
      baseUrl: blank(env.EMBEDDING_BASE_URL),
      apiKey: blank(env.EMBEDDING_API_KEY) ?? (viaOpenRouter ? blank(env.OPENROUTER_API_KEY) : undefined),
      ...(cfAccess ? { cfAccess } : {}),
      dimension,
    },
    'EMBEDDING',
    problems,
  );
}
