// Grading. Pure: no framework imports. The only implementation of scoring (constitution Principle III).
import { POINTS_PER_BLANK, normaliseWord, type SubmitAnswer } from '@coach/types';
import type { AnswerKey, GradeResult, GradedBlank, SubmissionIssue } from './gameplay.dto';

/**
 * [] when every entry names a question of the key, has 0 <= blank < answers.length, and no (questionId, blank) repeats.
 * Submitting the same word for several blanks is valid. Never throws.
 */
export function validateSubmission(key: AnswerKey, answers: SubmitAnswer[]): SubmissionIssue[] {
  const byId = new Map(key.map((entry) => [entry.questionId, entry]));
  const issues: SubmissionIssue[] = [];
  const seen = new Set<string>();
  answers.forEach((answer, index) => {
    const entry = byId.get(answer.questionId);
    if (!entry) {
      issues.push({ path: `answers.${index}.questionId`, message: 'Unknown question for this puzzle' });
      return;
    }
    if (answer.blank < 0 || answer.blank >= entry.answers.length) {
      issues.push({
        path: `answers.${index}.blank`,
        message: `Blank index out of range (question has ${entry.answers.length} blanks)`,
      });
      return;
    }
    const id = `${answer.questionId}\u0000${answer.blank}`;
    if (seen.has(id)) {
      issues.push({
        path: `answers.${index}`,
        message: `Duplicate answer for question ${answer.questionId} blank ${answer.blank}`,
      });
      return;
    }
    seen.add(id);
  });
  return issues;
}

/**
 * Total over the key: one GradedBlank per blank of the key, sorted by order then blank. Precondition: validateSubmission
 * returned []. Each blank is graded on its own, so one word can be correct in several blanks.
 */
export function grade(key: AnswerKey, answers: SubmitAnswer[]): GradeResult {
  const submitted = new Map<string, string>();
  for (const answer of answers) {
    const id = `${answer.questionId}\u0000${answer.blank}`;
    if (!submitted.has(id)) submitted.set(id, (answer.word ?? '').trim());
  }
  const blanks: GradedBlank[] = [];
  for (const entry of [...key].sort((a, b) => a.order - b.order)) {
    entry.answers.forEach((expected, blank) => {
      const word = submitted.get(`${entry.questionId}\u0000${blank}`) ?? '';
      blanks.push({
        questionId: entry.questionId,
        order: entry.order,
        blank,
        word,
        expected,
        correct: word !== '' && normaliseWord(word) === normaliseWord(expected),
      });
    });
  }
  const correct = blanks.filter((b) => b.correct).length;
  return { score: POINTS_PER_BLANK * correct, maxScore: POINTS_PER_BLANK * blanks.length, blanks };
}
