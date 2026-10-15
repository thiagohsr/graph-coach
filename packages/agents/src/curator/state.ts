// LangGraph state of the upload run. Kept small: every node re-reads its inputs from the graph, and only the drafts
// between `draftQuestions` and `validate` live in memory.
import { Annotation } from '@langchain/langgraph';
import type { DraftQuestions } from './schemas';
import type { CuratorNode } from './steps';

export type DraftCandidate = DraftQuestions['questions'][number] & { chunkId: string };

export interface CuratorCounts {
  chunks: number;
  concepts: number;
  merged: number;
  links: number;
  kept: number;
  discarded: Record<string, number>;
}

export const EMPTY_COUNTS: CuratorCounts = {
  chunks: 0,
  concepts: 0,
  merged: 0,
  links: 0,
  kept: 0,
  discarded: {},
};

export type CuratorOutcome = 'awaiting_review' | 'nothing_usable';

const replace = <T>(_previous: T, next: T): T => next;

export const CuratorState = Annotation.Root({
  taskId: Annotation<string>(),
  kind: Annotation<'ingest' | 'cover'>(),
  /** Null for cover tasks. */
  sourceId: Annotation<string | null>(),
  /** The learner who owns the output. */
  ownerId: Annotation<string>(),
  /** The node the run starts at. */
  entry: Annotation<CuratorNode>(),
  /** In memory only; produced by draftQuestions, consumed by validate. Replaced, never appended. */
  candidates: Annotation<DraftCandidate[]>({ reducer: replace, default: () => [] }),
  counts: Annotation<CuratorCounts>({
    reducer: replace,
    default: () => ({ ...EMPTY_COUNTS, discarded: {} }),
  }),
  outcome: Annotation<CuratorOutcome | null>({ reducer: replace, default: () => null }),
});

export type CuratorStateType = typeof CuratorState.State;
