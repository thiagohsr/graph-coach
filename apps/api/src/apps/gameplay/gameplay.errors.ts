import { AppError, ConflictError, NotFoundError } from '../../common/errors/app-error';
import type { SubmissionIssue } from './gameplay.dto';

// There is no 403 factory: ownership never produces 403 (reconciliation section B).
export const puzzleNotFound = (): NotFoundError => new NotFoundError('Puzzle');
export const sessionNotFound = (): NotFoundError => new NotFoundError('Session');
export const sessionAlreadySubmitted = (): ConflictError =>
  new ConflictError('This session was already submitted', { code: 'SESSION_ALREADY_SUBMITTED' });
export const sessionNotSubmitted = (): ConflictError =>
  new ConflictError('This session has not been submitted yet', { code: 'SESSION_NOT_SUBMITTED' });
export const invalidAnswers = (issues: SubmissionIssue[]): AppError =>
  new AppError('VALIDATION_FAILED', 'Answers do not match the puzzle', 422, { issues });
