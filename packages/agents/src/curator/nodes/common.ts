import { CuratorStepError, type CuratorDeps } from '../ports';
import type { CuratorStateType } from '../state';
import type { RunContext, StepName } from '../steps';

export type NodeFn = (state: CuratorStateType) => Promise<Partial<CuratorStateType>>;
export type NodeFactory = (deps: CuratorDeps) => NodeFn;

export const runOf = (state: CuratorStateType): RunContext => ({
  taskId: state.taskId,
  requesterId: state.ownerId,
});

/** An upload run always has a source; a cover run (stretch) does not use this graph. */
export function requireSourceId(state: CuratorStateType, node: StepName): string {
  if (!state.sourceId)
    throw new CuratorStepError(node, 'INCONSISTENT_STATE', 'The run has no source');
  return state.sourceId;
}
