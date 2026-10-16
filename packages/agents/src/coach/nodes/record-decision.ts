import type { CoachDeps, CoachNode } from '../deps';
import { DecisionNotRecordedError, EvidenceMissingError } from '../errors';

/** The only core node that writes. The decision id is the run id. */
export function createRecordDecisionNode(deps: Pick<CoachDeps, 'queries' | 'chatModel'>): CoachNode {
  return async (state) => {
    if (state.evidence.length === 0) throw new EvidenceMissingError();
    const chatRan = state.usage.inputTokens > 0 || state.usage.outputTokens > 0;
    const puzzleId = state.puzzle?.puzzleId ?? '';
    const result = await deps.queries.recordDecision({
      decisionId: state.runId,
      learnerId: state.learnerId,
      kind: state.kind,
      summary: state.summary ?? '',
      flags: [...state.flags],
      now: state.now,
      modelCalls: state.usage.modelCalls,
      inputTokens: state.usage.inputTokens,
      outputTokens: state.usage.outputTokens,
      embeddingTokens: state.usage.embeddingTokens,
      llmProvider: chatRan && deps.chatModel ? deps.chatModel.name : '',
      llmModel: chatRan && deps.chatModel ? deps.chatModel.model : '',
      puzzleId,
      goalId: state.goal?.goalId ?? '',
      evidence: state.evidence,
    });
    if (!result || result.becauseCount < 1 || (puzzleId !== '' && !result.linkedPuzzle)) {
      throw new DecisionNotRecordedError();
    }
    return { decisionId: result.decisionId, outcome: 'recorded' };
  };
}
