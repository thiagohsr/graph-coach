// The Coach state graph (plan "State graph"): checkRecent -> [resolveGoal] -> collectSignals -> selectTarget -> findPuzzles
// -> explain -> recordDecision -> [requestCoverage], with the reuse, cold-start and no-content shortcuts. No
// checkpointer: a run is one request.
import { END, START, StateGraph } from '@langchain/langgraph';
import type { RunHandle, StepHandle } from '../llm/usage-tracer';
import type { CoachDeps, CoachInput, CoachNode, CoachResult } from './deps';
import { createCheckRecentNode } from './nodes/check-recent';
import { createCollectSignalsNode } from './nodes/collect-signals';
import { createExplainNode } from './nodes/explain';
import { createFindPuzzlesNode } from './nodes/find-puzzles';
import { normaliseGoal } from './nodes/check-recent';
import { createRecordDecisionNode } from './nodes/record-decision';
import { createRequestCoverageNode } from './nodes/request-coverage';
import { createResolveGoalNode } from './nodes/resolve-goal';
import { createSelectTargetNode } from './nodes/select-target';
import { CoachState, type CoachStateType } from './state';

/** resolveGoal when a (non-blank) goal was given and no decision is reused. */
export function routeAfterCheckRecent(s: CoachStateType): 'reuse' | 'resolveGoal' | 'collectSignals' {
  if (s.outcome === 'reused') return 'reuse';
  return normaliseGoal(s.goalText) !== '' ? 'resolveGoal' : 'collectSignals';
}

/** coldStart when the learner has no mastery edge at all. */
export function routeAfterCollectSignals(s: CoachStateType): 'coldStart' | 'select' {
  return (s.recent?.masteryCount ?? 0) === 0 ? 'coldStart' : 'select';
}

/** noContent when there is neither a puzzle nor a target. */
export function routeAfterFindPuzzles(s: CoachStateType): 'explain' | 'noContent' {
  return s.outcome === 'no_content' || (s.puzzle === null && s.selection === null) ? 'noContent' : 'explain';
}

/** requestCoverage only when `explain` saw the creation allowance pass (flag `coverage_requested`). */
export function routeAfterRecordDecision(s: CoachStateType): 'requestCoverage' | 'end' {
  return s.flags.includes('coverage_requested') && s.missingConceptIds.length > 0 ? 'requestCoverage' : 'end';
}

/** Tracer calls for one graph build. Every call is guarded: a faulty tracer never changes the outcome. */
function createTracing(deps: Pick<CoachDeps, 'tracer' | 'logger'>) {
  const runs = new Map<string, { handle: RunHandle; failed: boolean }>();
  const guard = (runId: string, fn: () => void): void => {
    try {
      fn();
    } catch {
      const run = runs.get(runId);
      if (!run?.failed) deps.logger?.warn('coach.tracer_failed', { runId });
      if (run) run.failed = true;
    }
  };
  return {
    startRun(runId: string, userId: string): void {
      const { tracer } = deps;
      if (!tracer) return;
      try {
        const handle = tracer.startRun({ id: runId, kind: 'coach', userId });
        runs.set(runId, { handle, failed: false });
      } catch {
        deps.logger?.warn('coach.tracer_failed', { runId });
      }
    },
    startStep(runId: string, node: string): StepHandle | undefined {
      const run = runs.get(runId);
      const tracer = deps.tracer;
      if (!run || !tracer) return undefined;
      let step: StepHandle | undefined;
      guard(runId, () => {
        step = tracer.startStep(run.handle, node);
      });
      return step;
    },
    endStep(runId: string, step: StepHandle | undefined, ok: boolean): void {
      const tracer = deps.tracer;
      if (!step || !tracer) return;
      guard(runId, () => tracer.endStep(step, { ok }));
    },
    endRun(runId: string, ok: boolean): void {
      const run = runs.get(runId);
      const tracer = deps.tracer;
      if (!run || !tracer) return;
      guard(runId, () => tracer.endRun(run.handle, { ok }));
      runs.delete(runId);
    },
  };
}

export function buildCoachGraph(deps: CoachDeps): { invoke(input: CoachInput): Promise<CoachStateType> } {
  const tracing = createTracing(deps);

  const traced =
    (name: string, node: CoachNode) =>
    async (state: CoachStateType): Promise<Partial<CoachStateType>> => {
      const step = tracing.startStep(state.runId, name);
      try {
        const out = await node(state, step);
        tracing.endStep(state.runId, step, true);
        return out;
      } catch (error) {
        tracing.endStep(state.runId, step, false);
        throw error;
      }
    };

  const checkRecent = createCheckRecentNode(deps);
  // The run is opened after checkRecent has decided not to reuse (a reused decision opens no run), so this node is untraced.
  const checkRecentThenOpenRun = async (state: CoachStateType): Promise<Partial<CoachStateType>> => {
    const out = await checkRecent(state);
    if (out.outcome !== 'reused') tracing.startRun(state.runId, state.learnerId);
    return out;
  };

  const graph = new StateGraph(CoachState)
    .addNode('checkRecent', checkRecentThenOpenRun)
    .addNode('resolveGoal', traced('resolveGoal', createResolveGoalNode(deps)))
    .addNode('collectSignals', traced('collectSignals', createCollectSignalsNode(deps)))
    .addNode('selectTarget', traced('selectTarget', createSelectTargetNode(deps)))
    .addNode('findPuzzles', traced('findPuzzles', createFindPuzzlesNode(deps)))
    .addNode('explain', traced('explain', createExplainNode(deps)))
    .addNode('recordDecision', traced('recordDecision', createRecordDecisionNode(deps)))
    .addNode('requestCoverage', traced('requestCoverage', createRequestCoverageNode(deps)))
    .addEdge(START, 'checkRecent')
    .addConditionalEdges('checkRecent', routeAfterCheckRecent, {
      reuse: END,
      resolveGoal: 'resolveGoal',
      collectSignals: 'collectSignals',
    })
    .addEdge('resolveGoal', 'collectSignals')
    .addConditionalEdges('collectSignals', routeAfterCollectSignals, { coldStart: 'findPuzzles', select: 'selectTarget' })
    .addEdge('selectTarget', 'findPuzzles')
    .addConditionalEdges('findPuzzles', routeAfterFindPuzzles, { explain: 'explain', noContent: END })
    .addEdge('explain', 'recordDecision')
    .addConditionalEdges('recordDecision', routeAfterRecordDecision, { requestCoverage: 'requestCoverage', end: END })
    .addEdge('requestCoverage', END)
    .compile();

  return {
    async invoke(input) {
      const runId = deps.newId();
      try {
        const final = (await graph.invoke({ ...input, runId })) as CoachStateType;
        tracing.endRun(runId, final.outcome === 'recorded');
        return final;
      } catch (error) {
        tracing.endRun(runId, false);
        throw error;
      }
    },
  };
}

/** Build, invoke, project the result. */
export async function runCoach(deps: CoachDeps, input: CoachInput): Promise<CoachResult> {
  const state = await buildCoachGraph(deps).invoke(input);
  const outcome = state.outcome ?? 'no_content';
  return {
    outcome,
    decisionId: outcome === 'no_content' ? null : state.decisionId,
    coverageTaskId: state.coverageTaskId,
  };
}
