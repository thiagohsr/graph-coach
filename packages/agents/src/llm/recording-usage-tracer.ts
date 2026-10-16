import { ZERO_USAGE, addUsage, type Usage } from './usage';
import type {
  CallRecord,
  ContentCapture,
  RunHandle,
  RunKind,
  StepHandle,
  UsageTracer,
} from './usage-tracer';

/** Test double: keeps everything it is told, in order. */
export class RecordingUsageTracer implements UsageTracer {
  readonly enabled = true as const;
  readonly content?: ContentCapture;
  readonly runs: Array<{
    id: string;
    kind: RunKind;
    userId: string;
    ok?: boolean;
    ended: boolean;
  }> = [];
  readonly steps: Array<{ runId: string; node: string; ok?: boolean; ended: boolean }> = [];
  readonly calls: Array<{
    runId: string;
    node: string;
    call: CallRecord;
    content?: { input: string; output: string };
  }> = [];

  constructor(options: { captureContent?: boolean } = {}) {
    if (options.captureContent) {
      this.content = {
        recordCallWithContent: (step, call, content) =>
          void this.calls.push({ runId: step.runId, node: step.node, call, content }),
      };
    }
  }

  startRun(run: { id: string; kind: RunKind; userId: string }): RunHandle {
    this.runs.push({ id: run.id, kind: run.kind, userId: run.userId, ended: false });
    return { runId: run.id };
  }

  startStep(run: RunHandle, node: string): StepHandle {
    this.steps.push({ runId: run.runId, node, ended: false });
    return { runId: run.runId, node };
  }

  recordCall(step: StepHandle, call: CallRecord): void {
    this.calls.push({ runId: step.runId, node: step.node, call });
  }

  endStep(step: StepHandle, result?: { ok: boolean }): void {
    const rec = [...this.steps]
      .reverse()
      .find((s) => s.runId === step.runId && s.node === step.node && !s.ended);
    if (!rec) return;
    rec.ended = true;
    if (result) rec.ok = result.ok;
  }

  endRun(run: RunHandle, result?: { ok: boolean }): void {
    const rec = [...this.runs].reverse().find((r) => r.id === run.runId && !r.ended);
    if (!rec) return;
    rec.ended = true;
    if (result) rec.ok = result.ok;
  }

  async flush(): Promise<void> {}

  callsFor(node: string): CallRecord[] {
    return this.calls.filter((c) => c.node === node).map((c) => c.call);
  }

  totalUsage(runId?: string): Usage {
    return this.calls
      .filter((c) => runId === undefined || c.runId === runId)
      .reduce((sum, c) => addUsage(sum, c.call.usage), { ...ZERO_USAGE });
  }

  reset(): void {
    this.runs.length = 0;
    this.steps.length = 0;
    this.calls.length = 0;
  }
}
