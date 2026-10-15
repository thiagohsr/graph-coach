import type { CallRecord, ContentCapture, RunHandle, RunKind, StepHandle, UsageTracer } from './usage-tracer';

/** Does nothing. Used when Langfuse is not configured. */
export class NoopUsageTracer implements UsageTracer {
  readonly enabled = false as const;
  readonly content?: ContentCapture = undefined;

  startRun(run: { id: string; kind: RunKind; userId: string }): RunHandle {
    return { runId: run.id };
  }
  startStep(run: RunHandle, node: string): StepHandle {
    return { runId: run.runId, node };
  }
  recordCall(_step: StepHandle, _call: CallRecord): void {}
  endStep(_step: StepHandle, _result?: { ok: boolean }): void {}
  endRun(_run: RunHandle, _result?: { ok: boolean }): void {}
  async flush(): Promise<void> {}
}
