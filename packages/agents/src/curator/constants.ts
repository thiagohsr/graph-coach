// Named constants of the Curator (data-model.md §6). Not settings and not environment variables.

/** Passed to completeStructured as maxRetries. */
export const MAX_OUTPUT_RETRIES = 2;
/** Model calls in flight inside one step. */
export const MODEL_CONCURRENCY = 3;
export const STEP_TIMEOUT_MS = 180_000;
/** Runs started at once by start-up resume. */
export const MAX_CONCURRENT_RUNS = 2;
export const CHUNK_MIN_CHARS = 200;
export const NEIGHBOURHOOD_FETCH_K = 8;
/** Cosine distance; tune after spikes S2 and S5. */
export const NEIGHBOURHOOD_MAX_DISTANCE = 0.35;
export const MIN_LINK_CONFIDENCE = 0.6;
export const MAX_CONCEPT_DESCRIPTION_CHARS = 200;
/** The planner plans brief.sentences + 2 (at most 12) so drops do not sink the run. */
export const PROMPT_EXTRA_SENTENCES = 2;
/** Planner-proposed prerequisite links; stricter than the upload path. */
export const PROMPT_MIN_LINK_CONFIDENCE = 0.7;
/** FR-U33 */
export const PROMPT_MAX_REWRITE_PASSES = 1;
/** Reconciliation N5: extra writer rounds when validate keeps fewer drafts than the learner asked for. */
export const MAX_TOPUP_ROUNDS = 2;
/** Token overlap (Jaccard) from which two sentences count as the same one. */
export const NEAR_DUPLICATE_SIMILARITY = 0.8;
/** PUT /puzzles/:id/shares, per owner, every attempt counted. */
export const SHARE_ATTEMPTS_PER_HOUR = 20;
/** Stretch. */
export const COVER_POLL_SECONDS = 30;
export const COVER_TOP_K = 5;

/** Batch sizes for writes, so that no single query runs into the graph's default timeout. */
export const WRITE_BATCH_CHUNKS = 20;
export const WRITE_BATCH_QUESTIONS = 25;
