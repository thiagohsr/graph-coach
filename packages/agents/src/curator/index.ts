// Public surface of the Curator pipeline (contracts/internal-interfaces.md §1). Later phases add publish, the prompt
// graph, and the cover brief here.
export * from './constants';
// Synthetic sample texts and scripted stub answers, for tests of the API and the web app.
export * as testing from './testing/fixtures';
export { fingerprint } from './fingerprint';
export {
  chunkId,
  conceptId,
  deterministicId,
  generatedQuestionId,
  ingestTaskId,
  normalisedSentence,
  puzzleIdForSource,
  puzzleIdForTask,
  questionId,
  sourceId,
  stepId,
  taskIdFor,
} from './ids';
export { chunkText, type ChunkDraft } from './chunker';
export { isProbableDuplicate, slugify } from './slug';
export { reconcileConcepts, type ReconcileResult, type ReconciledConcept } from './concepts';
export * from './ports';
export {
  PROMPT_STEP_ORDER,
  STEP_ORDER,
  resolveEntry,
  resolvePromptEntry,
  withStep,
  type CuratorNode,
  type Entry,
  type PromptEntry,
  type PromptNode,
  type RunContext,
  type StepName,
  type StepOutput,
} from './steps';
export { callStructured, type StructuredRequest } from './structured';
export { ExtractedConcepts, DraftQuestions, PrerequisiteLinks } from './schemas';
export {
  CuratorState,
  EMPTY_COUNTS,
  type CuratorCounts,
  type CuratorOutcome,
  type CuratorStateType,
  type DraftCandidate,
} from './state';
export {
  buildCuratorGraph,
  runCurator,
  type CuratorRunInput,
  type CuratorRunResult,
} from './graph';
export { buildPromptGraph, runPromptCreation, type PromptRunInput } from './prompt/graph';
export {
  CRITIC_CRITERIA,
  buildCriticPrompt,
  buildPlannerPrompt,
  buildRewritePrompt,
  buildWriterPrompt,
} from './prompt/prompts';
export { Critiques, Outline, PromptDrafts, critiquesFor } from './prompt/schemas';
export {
  PromptState,
  EMPTY_PROMPT_COUNTS,
  type PromptCounts,
  type PromptDraft,
  type PromptOutcome,
  type PromptStateType,
} from './prompt/state';
export {
  buildDraftQuestionsPrompt,
  buildExtractConceptsPrompt,
  buildLinkPrerequisitesPrompt,
  type Prompt,
} from './prompts';
