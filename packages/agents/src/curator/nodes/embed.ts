import { ProviderError } from '../../llm/errors';
import { WRITE_BATCH_CHUNKS } from '../constants';
import { batches } from '../pool';
import { CuratorStepError } from '../ports';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

/** One batched embedding call for the chunks that lack a vector. */
export const embedNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'embed');
  await withStep(deps, runOf(state), 'embed', async (ctx) => {
    const read = await deps.graph.sourceChunks(sourceId);
    if (!read) throw new CuratorStepError('embed', 'INCONSISTENT_STATE', 'The source is missing');
    const ordered = [...read.chunks].sort((a, b) => a.position - b.position);
    const missing = ordered.filter((chunk) => !chunk.hasEmbedding);
    if (missing.length === 0) {
      return { value: 0, log: 'All chunks already embedded', counts: { chunks: 0 } };
    }

    let result;
    try {
      result = await deps.embeddings.embed(
        missing.map((chunk) => chunk.text),
        { label: 'curator.embed', trace: ctx.trace },
      );
    } catch (error) {
      if (error instanceof ProviderError) {
        ctx.meter.add(error.usage);
        throw new CuratorStepError(
          'embed',
          'PROVIDER_UNAVAILABLE',
          'The embedding provider could not answer',
          { cause: error },
        );
      }
      throw error;
    }
    ctx.meter.add(result.usage);
    if (result.vectors.length !== missing.length) {
      throw new CuratorStepError(
        'embed',
        'INCONSISTENT_STATE',
        'The provider returned the wrong number of vectors',
      );
    }

    const previous = new Map(
      ordered.map((chunk, i) => [chunk.id, i > 0 ? ordered[i - 1]!.id : null]),
    );
    const writes = missing.map((chunk, i) => ({
      id: chunk.id,
      position: chunk.position,
      text: chunk.text,
      prevId: previous.get(chunk.id) ?? null,
      embedding: result.vectors[i]!,
    }));
    for (const batch of batches(writes, WRITE_BATCH_CHUNKS))
      await deps.graph.addChunks(sourceId, batch);

    return {
      value: missing.length,
      log: `${missing.length} chunks embedded`,
      counts: { chunks: missing.length },
    };
  });
  return {};
};
