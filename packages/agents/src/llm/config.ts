import { z } from 'zod';
import { ProviderConfigError } from './errors';

export const LlmConfig = z.object({
  provider: z.enum(['stub', 'openai', 'ollama']),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});
export type LlmConfig = z.infer<typeof LlmConfig>;

export const EmbeddingsConfig = z.object({
  provider: z.enum(['stub', 'openai', 'ollama']),
  model: z.string(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
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
  if (config.provider !== 'stub' && !config.model.trim()) {
    problems.push(`${prefix}_MODEL is required when ${prefix}_PROVIDER is "${config.provider}"`);
  }
  if (config.provider === 'openai' && !config.apiKey) {
    problems.push(`${prefix}_API_KEY is required when ${prefix}_PROVIDER is "openai"`);
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

/** Reads LLM_PROVIDER (default "stub"), LLM_MODEL, LLM_BASE_URL, LLM_API_KEY. Throws ProviderConfigError listing every problem. */
export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = blank(env.LLM_PROVIDER) ?? 'stub';
  return fromEnv(
    LlmConfig,
    {
      provider,
      model: blank(env.LLM_MODEL) ?? (provider === 'stub' ? 'stub-chat' : ''),
      baseUrl: blank(env.LLM_BASE_URL),
      apiKey: blank(env.LLM_API_KEY),
    },
    'LLM',
    [],
  );
}

/** Reads EMBEDDING_PROVIDER (default "stub"), EMBEDDING_MODEL, EMBEDDING_BASE_URL, EMBEDDING_API_KEY, EMBEDDING_DIM. */
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
  return fromEnv(
    EmbeddingsConfig,
    {
      provider,
      model: blank(env.EMBEDDING_MODEL) ?? (provider === 'stub' ? 'stub-embeddings' : ''),
      baseUrl: blank(env.EMBEDDING_BASE_URL),
      apiKey: blank(env.EMBEDDING_API_KEY),
      dimension,
    },
    'EMBEDDING',
    problems,
  );
}
