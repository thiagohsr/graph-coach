// LangGraph state of the prompt run. Kept small: every node re-reads its inputs from the graph (the brief and the stored
// outline), and only the drafts between `draftQuestions` and `validate` live in memory.
import { Annotation } from '@langchain/langgraph';
import { CuratorStepError, type CuratorDeps, type GeneratedQuestionWrite } from '../ports';
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

/** A draft that passed `validate` in some round. `written` is false until the puzzle has the question. */
export interface KeptDraft extends GeneratedQuestionWrite {
  written: boolean;
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
  /** In memory only. Drafts that passed `validate` in any round so far (reconciliation N). */
  kept: Annotation<KeptDraft[]>({ reducer: replace, default: () => [] }),
  /** 0 = first pass; n = the nth top-up round. */
  round: Annotation<number>({ reducer: replace, default: () => 0 }),
  /** The number of sentences the learner asked for; set by `validate`. */
  requested: Annotation<number>({ reducer: replace, default: () => 0 }),
  /** Planned indexes the writer has already been asked about. */
  tried: Annotation<number[]>({ reducer: replace, default: () => [] }),
  /** No top-up possible: the questions of this task were stored by an earlier attempt. */
  settled: Annotation<boolean>({ reducer: replace, default: () => false }),
  /** Kept drafts added by the latest `validate`. */
  lastAdded: Annotation<number>({ reducer: replace, default: () => 0 }),
  counts: Annotation<PromptCounts>({
    reducer: replace,
    default: () => ({ ...EMPTY_PROMPT_COUNTS, discarded: {} }),
  }),
  outcome: Annotation<PromptOutcome | null>({ reducer: replace, default: () => null }),
});

export type PromptStateType = typeof PromptState.State;
export type PromptNodeFn = (state: PromptStateType) => Promise<Partial<PromptStateType>>;
export type PromptNodeFactory = (deps: CuratorDeps) => PromptNodeFn;

/** The prefix of a top-up round's log lines; empty in the first pass. */
export const roundPrefix = (round: number): string => (round > 0 ? `Top-up round ${round}: ` : '');

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

/**
 * The shortfall rule of reconciliation N, in plain code (no model): top up while fewer drafts are kept than the learner
 * asked for, the round limit is not reached, and the latest round added something.
 */
export function needsTopUp(state: PromptStateType, maxRounds: number): boolean {
  if (state.settled || state.outcome === null) return false;
  if (state.kept.length >= state.requested) return false;
  if (state.round >= maxRounds) return false;
  // The first pass always may top up; a later round that added nothing ends the loop.
  return state.round === 0 || state.lastAdded > 0;
}
