// Result assembly. Pure: no access decision here (the passages map already reflects canReadSource).
import { SubmitResult } from '@coach/types';
import { toIso } from '@coach/graph-kit';
import type { AnswerKey, GradedBlank, MasteryChange } from './gameplay.dto';
import { excerpt } from './excerpt';

export interface ResultInput {
  session: {
    sessionId: string;
    puzzleId: string;
    puzzleName: string;
    puzzleOrigin: 'seed' | 'upload' | 'prompt';
    submittedAt: number;
    score: number;
    maxScore: number;
  };
  key: AnswerKey;
  blanks: GradedBlank[];
  changes: Pick<MasteryChange, 'conceptId' | 'name' | 'before' | 'after'>[];
  /** By questionId; only passages the caller may read. */
  passages: Map<string, { chunkId: string; sourceId: string; text: string }>;
}

export function buildResult(input: ResultInput): SubmitResult {
  const { session, key, blanks, changes, passages } = input;
  return SubmitResult.parse({
    sessionId: session.sessionId,
    puzzle: { id: session.puzzleId, name: session.puzzleName, origin: session.puzzleOrigin },
    submittedAt: toIso(session.submittedAt),
    score: session.score,
    maxScore: session.maxScore,
    questions: [...key]
      .sort((a, b) => a.order - b.order)
      .map(({ questionId, order, sentence }) => ({ id: questionId, order, sentence })),
    review: blanks.map((blank) => {
      const passage = passages.get(blank.questionId);
      return {
        questionId: blank.questionId,
        blank: blank.blank,
        submitted: blank.word === '' ? null : blank.word,
        expected: blank.expected,
        correct: blank.correct,
        ...(passage
          ? { passage: { chunkId: passage.chunkId, sourceId: passage.sourceId, excerpt: excerpt(passage.text) } }
          : {}),
      };
    }),
    mastery: [...changes]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(({ conceptId, name, before, after }) => ({ conceptId, name, before, after })),
  });
}
