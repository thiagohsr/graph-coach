import { MODEL_CONCURRENCY, NEIGHBOURHOOD_FETCH_K, NEIGHBOURHOOD_MAX_DISTANCE } from '../constants';
import { reconcileConcepts } from '../concepts';
import { batches, mapPool } from '../pool';
import { CuratorStepError, type KnownConcept } from '../ports';
import { buildExtractConceptsPrompt } from '../prompts';
import { ExtractedConcepts } from '../schemas';
import { callStructured } from '../structured';
import { withStep } from '../steps';
import { requireSourceId, runOf, type NodeFactory } from './common';

const UPSERT_BATCH = 20;
const MAX_LOGGED_MERGES = 5;

/**
 * Per chunk: the concepts already known near it (the only vector search, concept fields only), then one model call.
 * The results are reconciled across the run and written once.
 */
export const extractConceptsNode: NodeFactory = (deps) => async (state) => {
  const sourceId = requireSourceId(state, 'extractConcepts');
  const summary = await withStep(deps, runOf(state), 'extractConcepts', async (ctx) => {
    const read = await deps.graph.sourceChunks(sourceId);
    if (!read)
      throw new CuratorStepError('extractConcepts', 'INCONSISTENT_STATE', 'The source is missing');
    const chunks = [...read.chunks].sort((a, b) => a.position - b.position);
    const vectors = new Map(
      (await deps.graph.chunkEmbeddings(sourceId)).map((row) => [row.id, row.embedding]),
    );

    let done = 0;
    const results = await mapPool(chunks, MODEL_CONCURRENCY, async (chunk) => {
      const embedding = vectors.get(chunk.id);
      const neighbours: KnownConcept[] = embedding
        ? await deps.graph.conceptNeighbourhood(embedding, {
            fetchK: NEIGHBOURHOOD_FETCH_K,
            maxDistance: NEIGHBOURHOOD_MAX_DISTANCE,
          })
        : [];
      const prompt = buildExtractConceptsPrompt({
        passage: chunk.text,
        known: neighbours.map((n) => ({ slug: n.slug, name: n.name, description: n.description })),
      });
      const extracted = await callStructured(deps, ctx, {
        node: 'extractConcepts',
        label: 'curator.extractConcepts',
        schema: ExtractedConcepts,
        ...prompt,
      });
      done += 1;
      ctx.progress(`${done} of ${chunks.length} chunks`);
      return { chunkId: chunk.id, concepts: extracted.concepts, neighbours };
    });

    const known = results.flatMap((r) => r.neighbours);
    const { concepts, merged } = reconcileConcepts({
      perChunk: results.map((r) => ({ chunkId: r.chunkId, concepts: r.concepts })),
      known,
    });

    for (const batch of batches(concepts, UPSERT_BATCH)) {
      await deps.graph.upsertConcepts(
        state.taskId,
        batch.map(({ id, slug, name, description, chunkIds }) => ({
          id,
          slug,
          name,
          description,
          chunkIds,
        })),
        deps.now(),
      );
    }

    const matched = concepts.filter((c) => c.known).length;
    const created = concepts.length - matched;
    const mergeText = merged
      .slice(0, MAX_LOGGED_MERGES)
      .map((m) => `"${m.name}" → ${m.into}`)
      .join('; ');
    const extra =
      merged.length > MAX_LOGGED_MERGES ? ` (+${merged.length - MAX_LOGGED_MERGES} more)` : '';
    const log =
      concepts.length === 0
        ? 'No concepts found'
        : `${created} created, ${matched} matched, ${merged.length} merged` +
          (merged.length > 0 ? `: ${mergeText}${extra}` : '');
    return {
      value: { concepts: concepts.length, merged: merged.length },
      log,
      counts: { concepts: concepts.length, created, matched, merged: merged.length },
    };
  });
  return { counts: { ...state.counts, concepts: summary.concepts, merged: summary.merged } };
};
