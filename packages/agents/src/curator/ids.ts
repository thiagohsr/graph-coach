// Deterministic ids (data-model.md §2). Every write is a MERGE on these ids, so repeating a step changes nothing.
import { createHash } from 'node:crypto';
import type { StepName } from './steps';

/**
 * The same function as `deterministicId` in @coach/graph-kit (SHA-256 of the parts joined with ':', first 32 hex
 * characters, formatted 8-4-4-4-12). It is repeated here because the agents package does not depend on the graph
 * client; an API test asserts that both give the same ids.
 */
export function deterministicId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Trimmed, inner whitespace collapsed, lower-cased. */
export function normalisedSentence(sentence: string): string {
  return sentence.replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** Same owner and same text always give the same source. */
export function sourceId(ownerId: string, fingerprintValue: string): string {
  return deterministicId('source', ownerId, fingerprintValue);
}

/** One task per source and kind; a retry reuses it. */
export function taskIdFor(kind: 'ingest' | 'generate', sourceIdValue: string): string {
  return deterministicId('task', kind, sourceIdValue);
}

export function ingestTaskId(sourceIdValue: string): string {
  return taskIdFor('ingest', sourceIdValue);
}

/** Position is zero-based. */
export function chunkId(sourceIdValue: string, position: number): string {
  return deterministicId('chunk', sourceIdValue, String(position));
}

/** Used ON CREATE only: the MERGE key of a concept is its slug, and seeded concepts keep the id the seed gave them. */
export function conceptId(slug: string): string {
  return deterministicId('concept', slug);
}

/** One puzzle per source, upload or prompt. */
export function puzzleIdForSource(sourceIdValue: string): string {
  return deterministicId('puzzle', sourceIdValue);
}

/** For a run that has a task but no source of its own to derive from. */
export function puzzleIdForTask(taskId: string): string {
  return deterministicId('puzzle', 'task', taskId);
}

/** Upload questions: the same draft from the same chunk is never stored twice. */
export function questionId(chunkIdValue: string, sentence: string, answers: string[]): string {
  return deterministicId('question', chunkIdValue, normalisedSentence(sentence), answers.join('|'));
}

/** Prompt questions: the same draft for the same brief source is never stored twice. */
export function generatedQuestionId(
  sourceIdValue: string,
  sentence: string,
  answers: string[],
): string {
  return deterministicId(
    'question',
    sourceIdValue,
    normalisedSentence(sentence),
    answers.join('|'),
  );
}

/** `attempt` starts at 1 and grows only when the previous step for that node ended in `error`. */
export function stepId(taskId: string, node: StepName, attempt: number): string {
  return deterministicId('step', taskId, node, String(attempt));
}
