import type { PlayPuzzle, PuzzleSummary, SubmitResult } from '~/lib/api/gameplay-schemas';

/** Test fixtures for the play feature (shapes of the design documents). */
export const playPuzzle: PlayPuzzle = {
  id: 'pz-db-101',
  name: 'Databases 101',
  origin: 'seed',
  questions: [
    { id: 'q-1', order: 1, sentence: 'A ___ speeds up lookups at the cost of slower ___.', blanks: 2 },
    { id: 'q-2', order: 2, sentence: 'A ___ stores rows.', blanks: 1 },
  ],
  wordBank: ['writes', 'cache', 'index', 'table'],
};

export const summaries: PuzzleSummary[] = [
  {
    id: 'pz-db-101',
    name: 'Databases 101',
    visibility: 'public',
    origin: 'seed',
    access: 'public',
    ownerName: 'Demo Admin',
    sourceShared: false,
    questionCount: 6,
    concepts: [
      { id: 'c-index', name: 'Indexes' },
      { id: 'c-btree', name: 'B-trees' },
    ],
  },
  {
    id: 'pz-9f2',
    name: 'My interview notes',
    visibility: 'private',
    origin: 'upload',
    access: 'shared',
    ownerName: 'Bea Souza',
    sourceShared: true,
    sourceId: 'src-3',
    questionCount: 4,
    concepts: [],
  },
];

export const submitResult: SubmitResult = {
  sessionId: 's-1',
  puzzle: { id: 'pz-db-101', name: 'Databases 101', origin: 'upload' },
  submittedAt: '2026-10-11T14:03:22.000Z',
  score: 10,
  maxScore: 20,
  questions: [{ id: 'q-1', order: 1, sentence: 'A ___ speeds up lookups at the cost of slower ___.' }],
  review: [
    { questionId: 'q-1', blank: 0, submitted: 'Index', expected: 'index', correct: true },
    {
      questionId: 'q-1',
      blank: 1,
      submitted: null,
      expected: 'writes',
      correct: false,
      passage: { chunkId: 'ch-7', sourceId: 'src-3', excerpt: 'Every index must be updated on insert, so writes become slower…' },
    },
  ],
  mastery: [{ conceptId: 'c-index', name: 'Indexes', before: 0.5, after: 0.455 }],
};
