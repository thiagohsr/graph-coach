import { Inject, Injectable } from '@nestjs/common';
import { runPublish } from '@coach/agents/curator';
import type { ReviewOutcome } from '@coach/types';
import { SettingsService } from '../../common/settings/settings.service';
import { KeyedLock } from '../curator/keyed-lock';
import { TaskRecorder } from '../curator/task-recorder';
import { ReviewGraph, type DraftRow, type PuzzleState } from './review.graph';

/**
 * What follows a review decision (plan section 8, reconciliation D10): on approval the puzzle is published as soon as
 * `minQuestions` are approved; when no draft of the task is left, the `publish` step is recorded and the task is
 * closed as `done` with `result` `ok` or `below_minimum`. Decisions of one task are handled one at a time so the
 * closing happens once.
 */
@Injectable()
export class PublishService {
  private readonly lock = new KeyedLock();

  constructor(
    @Inject(ReviewGraph) private readonly graph: ReviewGraph,
    @Inject(TaskRecorder) private readonly recorder: TaskRecorder,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async onDecision(draft: DraftRow, decision: 'approved' | 'rejected'): Promise<ReviewOutcome> {
    return this.lock.run(draft.taskId ?? draft.puzzleId, () => this.afterDecision(draft, decision));
  }

  private async afterDecision(
    draft: DraftRow,
    decision: 'approved' | 'rejected',
  ): Promise<ReviewOutcome> {
    const minQuestions = await this.settings.get('minQuestions');
    // A rejection never publishes; only an approval applies the current minimum.
    let puzzle = await this.requirePuzzle(
      draft.puzzleId,
      decision === 'approved' ? minQuestions : null,
    );

    const remaining = draft.taskId ? await this.graph.remainingDrafts(draft.taskId) : null;
    const outcome: ReviewOutcome = {
      puzzle: toPuzzle(puzzle),
      remainingDrafts: remaining?.remaining ?? 0,
    };
    if (!draft.taskId || remaining === null || remaining.remaining > 0) return outcome;

    // No draft left: the publish step, then the task is closed.
    const taskId = draft.taskId;
    puzzle = await this.requirePuzzle(draft.puzzleId, minQuestions);
    const published = puzzle.status === 'published';
    const { result } = await runPublish(
      { graph: this.graph, recorder: this.recorder },
      { taskId, puzzleId: draft.puzzleId, minQuestions, rejected: remaining.rejected },
    );
    const closed = await this.recorder.setTaskStatus(taskId, ['awaiting_review'], {
      status: 'done',
      result,
    });
    return {
      puzzle: toPuzzle(puzzle),
      remainingDrafts: 0,
      ...(closed ? { task: { id: taskId, status: 'done' as const, result } } : {}),
      ...(!published
        ? {
            notPublishedReason: {
              code: 'below_minimum' as const,
              approved: puzzle.approved,
              minQuestions,
            },
          }
        : {}),
    };
  }

  private async requirePuzzle(puzzleId: string, minQuestions: number | null): Promise<PuzzleState> {
    const puzzle = await this.graph.publishPuzzle(puzzleId, minQuestions);
    if (!puzzle) throw new Error(`Puzzle ${puzzleId} does not exist`);
    return puzzle;
  }

}

function toPuzzle(puzzle: PuzzleState): ReviewOutcome['puzzle'] {
  return {
    id: puzzle.id,
    status: puzzle.status,
    visibility: puzzle.visibility,
    origin: puzzle.origin,
  };
}
