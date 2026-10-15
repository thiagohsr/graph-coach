import {
  MasteryChangeDto,
  MasteryDto,
  PlayPuzzleDto,
  PlayQuestionDto,
  PuzzleOrigin,
  PuzzleSummaryDto,
  ReviewItemDto,
  StartSessionResponse,
  SubmitAnswer as SubmitAnswerSchema,
  SubmitRequest as SubmitRequestSchema,
  SubmitResult as SubmitResultSchema,
} from '@coach/types';
import { z } from 'zod';

// Gameplay view types: the schemas and types of `@coach/types` (the design documents), under the names
// the play feature uses. Only the play payload differs: the server schema is strict (a leaked key fails the
// server's own parse), while the client drops unknown keys when it parses, so it can never hold or render one.

export const Origin = PuzzleOrigin;
export type Origin = PuzzleOrigin;

export const PuzzleSummary = PuzzleSummaryDto;
export type PuzzleSummary = PuzzleSummaryDto;
export const PuzzleSummaryList = z.array(PuzzleSummaryDto);

export const PlayQuestion = PlayQuestionDto.strip();
export type PlayQuestion = z.infer<typeof PlayQuestion>;

// No `.min(1)` on the questions: an empty puzzle gets its own "no questions" state instead of a contract error.
export const PlayPuzzle = PlayPuzzleDto.extend({ questions: z.array(PlayQuestion) }).strip();
export type PlayPuzzle = z.infer<typeof PlayPuzzle>;

export const SessionCreated = StartSessionResponse;
export type SessionCreated = StartSessionResponse;

export const SubmitAnswer = SubmitAnswerSchema;
export type SubmitAnswer = z.infer<typeof SubmitAnswerSchema>;
export const SubmitRequest = SubmitRequestSchema;
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

export const ReviewItem = ReviewItemDto;
export type ReviewItem = ReviewItemDto;
export const MasteryChange = MasteryChangeDto;
export type MasteryChange = MasteryChangeDto;

export const SubmitResult = SubmitResultSchema;
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

export const MasteryItem = MasteryDto;
export type MasteryItem = MasteryDto;
export const MasteryList = z.array(MasteryDto);
