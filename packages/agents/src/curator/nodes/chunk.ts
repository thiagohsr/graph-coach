import { toPlainText } from '@coach/types';
import { WRITE_BATCH_CHUNKS } from '../constants';
import { chunkText } from '../chunker';
import { chunkId } from '../ids';
import { batches } from '../pool';
import { CuratorStepError } from '../ports';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

/** Source text to chunks, written without vectors. Pure and cheap, so it never skips work. */
export const chunkNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'chunk');
  const count = await withStep(deps, runOf(state), 'chunk', async () => {
    const read = await deps.graph.sourceChunks(sourceId);
    if (
      !read ||
      read.source.content === null ||
      read.source.kind === 'url' ||
      read.source.kind === 'prompt'
    ) {
      throw new CuratorStepError('chunk', 'INCONSISTENT_STATE', 'The source has no text to read');
    }
    const plain = toPlainText(
      read.source.kind === 'markdown' ? 'markdown' : 'text',
      read.source.content,
    );
    const drafts = chunkText(plain, deps.params);
    if (drafts.length === 0)
      throw new CuratorStepError('chunk', 'INCONSISTENT_STATE', 'The source has no readable text');

    const writes = drafts.map((draft) => ({
      id: chunkId(sourceId, draft.position),
      position: draft.position,
      text: draft.text,
      prevId: draft.position > 0 ? chunkId(sourceId, draft.position - 1) : null,
      embedding: null,
    }));
    for (const batch of batches(writes, WRITE_BATCH_CHUNKS))
      await deps.graph.addChunks(sourceId, batch);

    return {
      value: drafts.length,
      log: `${drafts.length} chunks`,
      counts: { chunks: drafts.length },
    };
  });
  return { counts: { ...state.counts, chunks: count } };
};
