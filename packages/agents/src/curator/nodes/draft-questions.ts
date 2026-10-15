import { MODEL_CONCURRENCY } from '../constants';
import { mapPool } from '../pool';
import { CuratorStepError } from '../ports';
import { buildDraftQuestionsPrompt } from '../prompts';
import { DraftQuestions } from '../schemas';
import type { DraftCandidate } from '../state';
import { callStructured } from '../structured';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

/**
 * One model call per chunk that has a concept. The drafts stay in memory (`state.candidates`); nothing is written here.
 * When the task already produced questions (a re-run after a crash), no call is made.
 */
export const draftQuestionsNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'draftQuestions');
  const candidates = await withStep<DraftCandidate[]>(
    deps,
    runOf(state),
    'draftQuestions',
    async (ctx) => {
      const task = await deps.graph.loadTask(state.taskId);
      if (task && task.questions > 0) {
        return { value: [], log: 'Drafts already stored', counts: { drafts: 0, chunks: 0 } };
      }
      const read = await deps.graph.sourceChunks(sourceId);
      if (!read)
        throw new CuratorStepError('draftQuestions', 'INCONSISTENT_STATE', 'The source is missing');
      const targets = [...read.chunks]
        .sort((a, b) => a.position - b.position)
        .filter((c) => c.concepts.length > 0);

      let done = 0;
      const perChunk = await mapPool(targets, MODEL_CONCURRENCY, async (chunk) => {
        const prompt = buildDraftQuestionsPrompt({
          passage: chunk.text,
          concepts: chunk.concepts.map((c) => ({
            slug: c.slug,
            name: c.name,
            description: c.description,
          })),
        });
        const answer = await callStructured(deps, ctx, {
          node: 'draftQuestions',
          label: 'curator.draftQuestions',
          schema: DraftQuestions,
          ...prompt,
        });
        done += 1;
        ctx.progress(`${done} of ${targets.length} chunks`);
        return answer.questions.map((q): DraftCandidate => ({ ...q, chunkId: chunk.id }));
      });

      const all = perChunk.flat();
      return {
        value: all,
        log:
          targets.length === 0
            ? 'No chunk has a concept to ask about'
            : `${all.length} drafts from ${targets.length} chunks`,
        counts: { drafts: all.length, chunks: targets.length },
      };
    },
  );
  return { candidates };
};
