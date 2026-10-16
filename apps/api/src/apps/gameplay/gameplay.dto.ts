export {
  MasteryChangeDto,
  MasteryDto,
  ResultQuestionDto,
  ReviewItemDto,
  StartSessionResponse,
  SubmitAnswer,
  SubmitRequest,
  SubmitResult,
} from '@coach/types';

// Internal value types (data-model.md section 6). Not shared with the web client.
export type AnswerKeyEntry = {
  questionId: string;
  order: number;
  sentence: string;
  answers: string[];
  concepts: { id: string; name: string }[];
};
export type AnswerKey = AnswerKeyEntry[];
export type GradedBlank = {
  questionId: string;
  order: number;
  blank: number;
  word: string;
  expected: string;
  correct: boolean;
};
export type GradeResult = { score: number; maxScore: number; blanks: GradedBlank[] };
export type MasteryState = { score: number; attempts: number };
export type MasteryChange = {
  conceptId: string;
  name: string;
  before: number;
  after: number;
  attempts: number;
};
export type SubmissionIssue = { path: string; message: string };
