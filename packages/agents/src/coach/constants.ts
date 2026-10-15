// Everything the Coach tunes that is not one of the five settings (reconciliation A9; contracts/coach-internal.md §1).

/** Literal upper bound written into the traversal Cypher; `traversalDepth` (a parameter) is applied as a filter. */
export const MAX_DEPTH = 8;
export const MAX_ALTERNATIVES = 5;
export const MAX_ANSWER_EVIDENCE = 5;
export const MAX_SESSION_EVIDENCE = 3;
export const EVIDENCE_WEIGHTS = {
  target: 1,
  driver: 0.9,
  answer: 0.7,
  session: 0.5,
  passage: 0.5,
  alternative: 0.4,
} as const;
/** Evidence strength of a never-practised (or cold-start) target. */
export const UNSEEN_STRENGTH = 0.375;
/** Rows asked of the ranked queries. */
export const QUERY_LIMIT = 20;
/** Rows asked of `concept_answer_evidence` (one row per concept, question, and session). */
export const ANSWER_ROWS_LIMIT = 100;
export const PHRASE_WITH_MODEL = false;
export const PHRASE_TIMEOUT_MS = 5000;
export const GOAL_TOP_K = 20;
export const GOAL_MIN_SIMILARITY = 0.5;

export const DAY_MS = 86_400_000;
export const MINUTE_MS = 60_000;
