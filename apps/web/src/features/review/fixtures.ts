import type { DraftQuestionDto, ReviewOutcome } from '@coach/types';

/** Test fixtures for the review feature (shapes of packages/types/src/review.ts). */
export const PASSAGE =
  'A database index speeds up lookups on a column. Writes become slower because every index must be updated. A balanced tree keeps its leaves at the same depth.';

export function draft(over: Partial<DraftQuestionDto> = {}): DraftQuestionDto {
  return {
    id: 'd-1',
    sentence: 'A database ___ speeds up lookups at the cost of slower ___.',
    answers: ['index', 'writes'],
    distractors: ['cache', 'table'],
    concepts: [
      { id: 'c-index', name: 'Indexes' },
      { id: 'c-btree', name: 'B-trees' },
    ],
    passage: { chunkId: 'ch-1', text: PASSAGE },
    critique: null,
    origin: 'upload',
    puzzleId: 'pz-1',
    taskId: 't-1',
    ...over,
  };
}

export const drafts: DraftQuestionDto[] = [
  draft(),
  draft({
    id: 'd-2',
    sentence: 'A balanced ___ keeps its leaves at the same depth.',
    answers: ['tree'],
    distractors: ['list', 'queue'],
  }),
];

export function outcome(over: Partial<ReviewOutcome> = {}): ReviewOutcome {
  return {
    puzzle: { id: 'pz-1', status: 'draft', visibility: 'private', origin: 'upload' },
    remainingDrafts: 1,
    ...over,
  };
}
