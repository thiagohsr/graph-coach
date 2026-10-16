import type { ChatProvider, EmbeddingsProvider } from '../llm/types';
import type { StepHandle, UsageTracer } from '../llm/usage-tracer';
import type { CoachQueries } from './queries';
import type { CoachSettings } from './settings';
import type { CoachStateType } from './state';

export interface CoachLogger {
  warn(event: string, data?: object): void;
}

export interface CoachDeps {
  queries: CoachQueries;
  settings: CoachSettings;
  /** Decision id (UUID v4); injected for tests; called once by the graph run as runId. */
  newId: () => string;
  /** Absent = no tracing. */
  tracer?: UsageTracer;
  logger?: CoachLogger;
  /** Optional. Only ever rephrases the summary (stretch, T067). */
  chatModel?: ChatProvider;
  /** Overrides the constant `PHRASE_WITH_MODEL` (tests; a future setting). Has no effect without `chatModel`. */
  phraseWithModel?: boolean;
  /** Stretch (goals). */
  embeddings?: EmbeddingsProvider;
  /** Stretch. Read-only: the Coach never consumes allowance. */
  coverageAllowance?: () => Promise<{
    allowed: boolean;
    reason?: 'no_allowance' | 'paused' | 'hourly_limit';
  }>;
}

export interface CoachInput {
  learnerId: string;
  goalText: string | null;
  now: number;
}

export interface CoachResult {
  outcome: 'reused' | 'recorded' | 'no_content';
  /** Null only for no_content. */
  decisionId: string | null;
  coverageTaskId: string | null;
}

/** A node: state in, partial state out. `step` is the tracer step of this execution; it is only passed on to a provider. */
export type CoachNode = (
  state: CoachStateType,
  step?: StepHandle,
) => Promise<Partial<CoachStateType>>;
