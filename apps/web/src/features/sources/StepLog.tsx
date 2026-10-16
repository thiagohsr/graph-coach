import type { TaskKind } from '@coach/types';
import { logLines, type PipelineState } from './pipeline-state';

/** Every log line of the run, in step order (`role="log"` is polite by default). */
export function StepLog({ kind, state }: { kind: TaskKind; state: PipelineState }) {
  const lines = logLines(kind, state);
  return (
    <div
      role="log"
      aria-label="Run log"
      className="max-h-64 min-h-12 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-xs"
    >
      {lines.length === 0 ? (
        <p className="text-muted-foreground">No log lines yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
