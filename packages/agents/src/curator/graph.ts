// The upload run: START -> route(state.entry) -> chunk -> embed -> extractConcepts -> linkPrerequisites -> draftQuestions
// -> validate -> END. The only conditional edge is the one leaving START; after that the edges are fixed. `publish`
// is not in the graph: it runs after review (publish.ts).
import { END, START, StateGraph } from '@langchain/langgraph';
import { chunkNode } from './nodes/chunk';
import { draftQuestionsNode } from './nodes/draft-questions';
import { embedNode } from './nodes/embed';
import { extractConceptsNode } from './nodes/extract-concepts';
import { linkPrerequisitesNode } from './nodes/link-prerequisites';
import { validateNode } from './nodes/validate';
import { CuratorStepError, type CuratorDeps } from './ports';
import { CuratorState, EMPTY_COUNTS, type CuratorOutcome, type CuratorStateType } from './state';
import type { CuratorNode } from './steps';

const ENTRY_NODES: CuratorNode[] = [
  'chunk',
  'embed',
  'extractConcepts',
  'linkPrerequisites',
  'draftQuestions',
  'validate',
];

export function buildCuratorGraph(deps: CuratorDeps) {
  return new StateGraph(CuratorState)
    .addNode('chunk', chunkNode(deps))
    .addNode('embed', embedNode(deps))
    .addNode('extractConcepts', extractConceptsNode(deps))
    .addNode('linkPrerequisites', linkPrerequisitesNode(deps))
    .addNode('draftQuestions', draftQuestionsNode(deps))
    .addNode('validate', validateNode(deps))
    .addConditionalEdges(START, (state: CuratorStateType) => state.entry, ENTRY_NODES)
    .addEdge('chunk', 'embed')
    .addEdge('embed', 'extractConcepts')
    .addEdge('extractConcepts', 'linkPrerequisites')
    .addEdge('linkPrerequisites', 'draftQuestions')
    .addEdge('draftQuestions', 'validate')
    .addEdge('validate', END)
    .compile();
}

export interface CuratorRunInput {
  taskId: string;
  kind: 'ingest';
  sourceId: string;
  ownerId: string;
  entry: CuratorNode;
}

export interface CuratorRunResult {
  outcome: CuratorOutcome;
  counts: CuratorStateType['counts'];
}

/**
 * Runs the graph from `input.entry`. Does not change `Task.status`: the orchestrator does, before and after.
 * Throws CuratorStepError.
 */
export async function runCurator(
  deps: CuratorDeps,
  input: CuratorRunInput,
): Promise<CuratorRunResult> {
  const graph = buildCuratorGraph(deps);
  const final = await graph.invoke({
    taskId: input.taskId,
    kind: input.kind,
    sourceId: input.sourceId,
    ownerId: input.ownerId,
    entry: input.entry,
    counts: { ...EMPTY_COUNTS, discarded: {} },
  });
  if (final.outcome === null) {
    throw new CuratorStepError(
      'validate',
      'INCONSISTENT_STATE',
      'The run ended without an outcome',
    );
  }
  return { outcome: final.outcome, counts: final.counts };
}
