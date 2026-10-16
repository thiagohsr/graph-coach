// The `publish` step (plan section 8, reconciliation D10): runs once no draft of the task is left. It publishes the puzzle
// when `minQuestions` are approved, records the step with counts only, and reports the result the task closes with.
import { ZERO_USAGE } from '../llm/usage';
import {
  CuratorStepError,
  type CuratorGraphPort,
  type PuzzleState,
  type StepRecorder,
  type TaskResultName,
} from './ports';

export interface PublishDeps {
  graph: Pick<CuratorGraphPort, 'publishPuzzle'>;
  recorder: StepRecorder;
}

export interface PublishInput {
  taskId: string;
  puzzleId: string;
  /** The current `minQuestions` setting. */
  minQuestions: number;
  /** Rejected drafts of the task, for the log. */
  rejected: number;
}

export interface PublishResult {
  result: Extract<TaskResultName, 'ok' | 'below_minimum'>;
  puzzle: PuzzleState;
  approved: number;
  rejected: number;
  minQuestions: number;
}

/** Idempotent: `publish_puzzle` never reverts, and the recorder reuses the step of a repeated call. */
export async function runPublish(deps: PublishDeps, input: PublishInput): Promise<PublishResult> {
  const handle = await deps.recorder.begin(input.taskId, 'publish');
  try {
    const puzzle = await deps.graph.publishPuzzle(input.puzzleId, input.minQuestions);
    if (!puzzle) throw new Error(`Puzzle ${input.puzzleId} does not exist`);
    const published = puzzle.status === 'published';
    const plural = puzzle.approved === 1 ? '' : 's';
    const log = published
      ? `Published with ${puzzle.approved} approved question${plural} (${input.rejected} rejected).`
      : `Not published: ${puzzle.approved} approved of ${input.minQuestions} needed (${input.rejected} rejected).`;
    await deps.recorder.complete(handle, log, ZERO_USAGE, {
      approved: puzzle.approved,
      rejected: input.rejected,
      minQuestions: input.minQuestions,
    });
    return {
      result: published ? 'ok' : 'below_minimum',
      puzzle,
      approved: puzzle.approved,
      rejected: input.rejected,
      minQuestions: input.minQuestions,
    };
  } catch (error) {
    const stepError =
      error instanceof CuratorStepError
        ? error
        : new CuratorStepError('publish', 'INCONSISTENT_STATE', 'The publish step failed', {
            cause: error,
          });
    await deps.recorder.fail(handle, stepError, ZERO_USAGE).catch(() => undefined);
    throw error;
  }
}
