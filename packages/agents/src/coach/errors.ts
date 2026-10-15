/** Errors thrown by the Coach package (contracts/coach-internal.md §1). Graph errors are never caught here. */
export class EvidenceMissingError extends Error {
  constructor(message = 'A decision needs at least one evidence item') {
    super(message);
    this.name = 'EvidenceMissingError';
  }
}

export class DecisionNotRecordedError extends Error {
  constructor(message = 'The decision could not be recorded') {
    super(message);
    this.name = 'DecisionNotRecordedError';
  }
}

export class LearnerNotFoundError extends Error {
  constructor(message = 'The learner node does not exist') {
    super(message);
    this.name = 'LearnerNotFoundError';
  }
}
