// LangGraph state of the prompt run. Kept small: every node re-reads its inputs from the graph (the brief and the stored
// outline), and only the drafts between `draftQuestions` and `validate` live in memory.
import { Annotation } from '@langchain/langgraph';
import { CuratorStepError, type CuratorDeps } from '../ports';
import type { PromptNode, RunContext, StepName } from '../steps';
import type { Verdict } from './schemas';

export interface PromptDraft {
  /** Index of the planned sentence. */
  index: number;
  sentence: string;
  answers: string[];
  distractors: string[];
  conceptSlug: string;
  verdict?: Verdict;
  note?: string;
  rewritten: boolean;
}

export interface PromptCounts {
  concepts: number;
  links: number;
  planned: number;
  passed: number;
  rewritten: number;
  dropped: number;
  kept: number;
  discarded: Record<string, number>;
}

export const EMPTY_PROMPT_COUNTS: PromptCounts = {
  concepts: 0,
  links: 0,
  planned: 0,
  passed: 0,
  rewritten: 0,
  dropped: 0,
  kept: 0,
  discarded: {},
};

export type PromptOutcome = 'awaiting_review' | 'nothing_usable';

const replace = <T>(_previous: T, next: T): T => next;

export const PromptState = Annotation.Root({
  taskId: Annotation<string>(),
  sourceId: Annotation<string>(),
  /** The learner who owns the output. */
  ownerId: Annotation<string>(),
  /** The node the run starts at. */
  entry: Annotation<PromptNode>(),
  /** The puzzle is only written when at least this many drafts remain. */
  minQuestions: Annotation<number>(),
  /** In memory only. Replaced, never appended. */
  drafts: Annotation<PromptDraft[]>({ reducer: replace, default: () => [] }),
  counts: Annotation<PromptCounts>({
    reducer: replace,
    default: () => ({ ...EMPTY_PROMPT_COUNTS, discarded: {} }),
  }),
  outcome: Annotation<PromptOutcome | null>({ reducer: replace, default: () => null }),
});

export type PromptStateType = typeof PromptState.State;
export type PromptNodeFn = (state: PromptStateType) => Promise<Partial<PromptStateType>>;
export type PromptNodeFactory = (deps: CuratorDeps) => PromptNodeFn;

export const promptRunOf = (state: PromptStateType): RunContext => ({
  taskId: state.taskId,
  requesterId: state.ownerId,
});

/** A node of this graph reads the brief and the outline from the source; a missing brief is an inconsistent graph. */
export async function readPromptSource(deps: CuratorDeps, state: PromptStateType, node: StepName) {
  const read = await deps.graph.sourceChunks(state.sourceId);
  if (!read) throw new CuratorStepError(node, 'INCONSISTENT_STATE', 'The source is missing');
  if (!read.source.brief) {
    throw new CuratorStepError(node, 'INCONSISTENT_STATE', 'The source has no brief');
  }
  return { title: read.source.title, brief: read.source.brief, outline: read.source.outline };
}
