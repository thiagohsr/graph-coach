// The prompt run: START -> route(state.entry) -> outline -> draftQuestions -> critique -> refine -> validate -> END.
// Same discipline as the upload graph: the conditional edges (leaving START, and the shortfall check after validate) are plain code, every node runs inside `withStep`, writes
// are MERGEs on deterministic ids. It never touches the embeddings provider, chunks, or the vector index.
import { END, START, StateGraph } from '@langchain/langgraph';
import { MAX_TOPUP_ROUNDS } from '../constants';
import { CuratorStepError, type CuratorDeps } from '../ports';
import { EMPTY_COUNTS } from '../state';
import type { CuratorRunResult } from '../graph';
import type { PromptNode } from '../steps';
import { critiqueNode } from './nodes/critique';
import { draftQuestionsNode } from './nodes/draft-questions';
import { outlineNode } from './nodes/outline';
import { refineNode } from './nodes/refine';
import { topUpNode } from './nodes/top-up';
import { validateNode } from './nodes/validate';
import { EMPTY_PROMPT_COUNTS, PromptState, needsTopUp, type PromptStateType } from './state';

const ENTRY_NODES: PromptNode[] = ['outline', 'draftQuestions', 'critique', 'refine', 'validate'];

export function buildPromptGraph(deps: CuratorDeps) {
  return new StateGraph(PromptState)
    .addNode('outline', outlineNode(deps))
    .addNode('draftQuestions', draftQuestionsNode(deps))
    .addNode('critique', critiqueNode(deps))
    .addNode('refine', refineNode(deps))
    .addNode('validate', validateNode(deps))
    .addNode('topUp', topUpNode(deps))
    .addConditionalEdges(START, (state: PromptStateType) => state.entry, ENTRY_NODES)
    .addEdge('outline', 'draftQuestions')
    .addEdge('draftQuestions', 'critique')
    .addEdge('critique', 'refine')
    .addEdge('refine', 'validate')
    .addConditionalEdges(
      'validate',
      (state: PromptStateType) => (needsTopUp(state, MAX_TOPUP_ROUNDS) ? 'topUp' : END),
      ['topUp', END],
    )
    .addEdge('topUp', 'critique')
    .compile();
}

export interface PromptRunInput {
  taskId: string;
  sourceId: string;
  ownerId: string;
  entry: PromptNode;
  minQuestions: number;
}

/**
 * Runs the prompt graph from `input.entry`. Does not change `Task.status`: the orchestrator does, before and after.
 * Throws CuratorStepError.
 */
export async function runPromptCreation(
  deps: CuratorDeps,
  input: PromptRunInput,
): Promise<CuratorRunResult> {
  const graph = buildPromptGraph(deps);
  const final = await graph.invoke({
    taskId: input.taskId,
    sourceId: input.sourceId,
    ownerId: input.ownerId,
    entry: input.entry,
    minQuestions: input.minQuestions,
    counts: { ...EMPTY_PROMPT_COUNTS, discarded: {} },
  });
  if (final.outcome === null) {
    throw new CuratorStepError(
      'validate',
      'INCONSISTENT_STATE',
      'The run ended without an outcome',
    );
  }
  return {
    outcome: final.outcome,
    counts: {
      ...EMPTY_COUNTS,
      concepts: final.counts.concepts,
      links: final.counts.links,
      kept: final.counts.kept,
      discarded: final.counts.discarded,
    },
  };
}
