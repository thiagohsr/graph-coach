import { Langfuse } from 'langfuse';
import { LangfuseUsageTracer, type LangfuseClientLike } from './langfuse-usage-tracer';
import { NoopUsageTracer } from './noop-usage-tracer';
import type { ProviderName } from './types';
import type { Usage } from './usage';

export type RunKind = 'ingest' | 'generate' | 'cover' | 'coach';

export interface RunHandle {
  readonly runId: string;
}
export interface StepHandle {
  readonly runId: string;
  readonly node: string;
}

/** Everything a tracer may know about a model call. There is no field for prompt, response, source, or brief text. */
export interface CallRecord {
  model: string;
  provider: ProviderName;
  usage: Usage;
  durationMs: number;
  ok: boolean;
  /** The call-site name; never content. */
  label?: string;
  usageReported?: boolean;
}

export interface UsageTracer {
  readonly enabled: boolean;
  /** One trace per run. id = the task id or the decision id. userId = the internal user id, never an e-mail address. */
  startRun(run: { id: string; kind: RunKind; userId: string }): RunHandle;
  startStep(run: RunHandle, node: string): StepHandle;
  /** One generation per model call. */
  recordCall(step: StepHandle, call: CallRecord): void;
  endStep(step: StepHandle, result?: { ok: boolean }): void;
  endRun(run: RunHandle, result?: { ok: boolean }): void;
  /** Sends what is buffered. Resolves even when the service is unreachable. */
  flush(): Promise<void>;
  /** Present only when content capture is on (local development on synthetic content). */
  readonly content?: ContentCapture;
}

/** A separate, optional capability, so that usage-only code paths have no way to pass text. */
export interface ContentCapture {
  recordCallWithContent(step: StepHandle, call: CallRecord, content: { input: string; output: string }): void;
}

export interface TracerConfig {
  publicKey?: string | undefined;
  secretKey?: string | undefined;
  host?: string | undefined;
  captureContent: boolean;
}

const blank = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : undefined);

/** Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST, LANGFUSE_CAPTURE_CONTENT. */
export function tracerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): TracerConfig {
  const capture = blank(env.LANGFUSE_CAPTURE_CONTENT)?.toLowerCase();
  return {
    publicKey: blank(env.LANGFUSE_PUBLIC_KEY),
    secretKey: blank(env.LANGFUSE_SECRET_KEY),
    host: blank(env.LANGFUSE_HOST),
    captureContent: capture === 'true' || capture === '1',
  };
}

/** Adapts the real Langfuse client (V19) to the narrow interface the tracer uses. */
function adaptLangfuse(client: Langfuse): LangfuseClientLike {
  return {
    trace: (body) => void client.trace(body),
    span: (body) => void client.span(body),
    generation: (body) => void client.generation(body),
    flushAsync: () => client.flushAsync(),
    shutdownAsync: () => client.shutdownAsync(),
  };
}

/** Langfuse tracer when publicKey, secretKey, and host are all set; otherwise the no-op tracer. Never throws. */
export function createUsageTracer(
  config: TracerConfig,
  options: { logger?: { warn(message: string): void } } = {},
): UsageTracer {
  if (!config.publicKey || !config.secretKey || !config.host) return new NoopUsageTracer();
  try {
    const client = new Langfuse({ publicKey: config.publicKey, secretKey: config.secretKey, baseUrl: config.host });
    return new LangfuseUsageTracer({
      client: adaptLangfuse(client),
      captureContent: config.captureContent,
      ...(options.logger ? { logger: options.logger } : {}),
    });
  } catch (e) {
    options.logger?.warn(`Usage tracing unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return new NoopUsageTracer();
  }
}
