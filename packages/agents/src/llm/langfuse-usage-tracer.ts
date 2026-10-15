import { randomUUID } from 'node:crypto';
import type { CallRecord, ContentCapture, RunHandle, RunKind, StepHandle, UsageTracer } from './usage-tracer';

type Metadata = Record<string, string | number | boolean>;
type Level = 'DEFAULT' | 'ERROR';

/** The subset of the Langfuse client the tracer uses, so tests inject a fake transport. */
export interface LangfuseClientLike {
  trace(body: { id: string; name: string; userId: string; metadata?: Metadata }): void;
  span(body: { id: string; traceId: string; name: string; startTime: Date; endTime?: Date; level?: Level }): void;
  generation(body: {
    traceId: string;
    parentObservationId: string;
    name: string;
    model: string;
    startTime: Date;
    endTime: Date;
    level?: Level;
    usage: { input: number; output: number; total: number };
    metadata?: Metadata;
    /** Set only through ContentCapture. */
    input?: string;
    output?: string;
  }): void;
  flushAsync(): Promise<void>;
  shutdownAsync(): Promise<void>;
}

const FLUSH_LIMIT_MS = 5000;

interface StepState {
  spanId: string;
  start: Date;
}

export class LangfuseUsageTracer implements UsageTracer {
  readonly enabled = true as const;
  readonly content?: ContentCapture;

  private readonly client: LangfuseClientLike;
  private readonly logger: { warn(message: string): void };
  private readonly clock: { now(): Date };
  private readonly steps = new WeakMap<StepHandle, StepState>();
  private warned = false;

  constructor(options: {
    client: LangfuseClientLike;
    captureContent: boolean;
    logger?: { warn(message: string): void };
    clock?: { now(): Date };
  }) {
    this.client = options.client;
    this.logger = options.logger ?? { warn: (m) => console.warn(m) };
    this.clock = options.clock ?? { now: () => new Date() };
    if (options.captureContent) {
      this.content = {
        recordCallWithContent: (step, call, content) => this.generation(step, call, content),
      };
    }
  }

  startRun(run: { id: string; kind: RunKind; userId: string }): RunHandle {
    this.safe(() =>
      this.client.trace({ id: run.id, name: run.kind, userId: run.userId, metadata: { kind: run.kind } }),
    );
    return { runId: run.id };
  }

  startStep(run: RunHandle, node: string): StepHandle {
    const handle: StepHandle = { runId: run.runId, node };
    this.steps.set(handle, { spanId: randomUUID(), start: this.clock.now() });
    return handle;
  }

  recordCall(step: StepHandle, call: CallRecord): void {
    this.generation(step, call);
  }

  endStep(step: StepHandle, result?: { ok: boolean }): void {
    const state = this.steps.get(step);
    if (!state) return;
    this.safe(() =>
      this.client.span({
        id: state.spanId,
        traceId: step.runId,
        name: step.node,
        startTime: state.start,
        endTime: this.clock.now(),
        level: result?.ok === false ? 'ERROR' : 'DEFAULT',
      }),
    );
  }

  endRun(_run: RunHandle, _result?: { ok: boolean }): void {
    // The trace body (§4.5) carries no end state; nothing to send.
  }

  async flush(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.client.flushAsync(),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, FLUSH_LIMIT_MS);
          timer.unref?.();
        }),
      ]);
    } catch (e) {
      this.warn(e);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private generation(step: StepHandle, call: CallRecord, content?: { input: string; output: string }): void {
    const state = this.steps.get(step);
    const end = this.clock.now();
    const start = new Date(end.getTime() - Math.max(0, call.durationMs));
    const input = call.usage.inputTokens + call.usage.embeddingTokens;
    this.safe(() =>
      this.client.generation({
        traceId: step.runId,
        parentObservationId: state?.spanId ?? step.runId,
        name: call.label ?? step.node,
        model: call.model,
        startTime: start,
        endTime: end,
        level: call.ok ? 'DEFAULT' : 'ERROR',
        usage: { input, output: call.usage.outputTokens, total: input + call.usage.outputTokens },
        metadata: {
          provider: call.provider,
          modelCalls: call.usage.modelCalls,
          embeddingTokens: call.usage.embeddingTokens,
          usageReported: call.usageReported ?? true,
        },
        ...(content ? { input: content.input, output: content.output } : {}),
      }),
    );
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.warn(e);
    }
  }

  private warn(e: unknown): void {
    if (this.warned) return;
    this.warned = true;
    try {
      this.logger.warn(`Usage tracing unavailable: ${e instanceof Error ? e.message : String(e)}`);
    } catch {
      // a broken logger must not break a run
    }
  }
}
