import {
  countBlanks,
  validateDraft,
  type DraftQuestionDto,
  type DraftUpdateRequest,
} from '@coach/types';
import { isApiClientError } from '~/lib/api/errors';

export interface DraftFormValues {
  sentence: string;
  answers: string[];
  distractors: string[];
}

export type DraftField = keyof DraftFormValues;
export const DRAFT_FIELDS: readonly DraftField[] = ['sentence', 'answers', 'distractors'];

/** Messages per editable field, plus the ones that belong to no field (for example the concept links). */
export interface DraftIssues {
  fields: Partial<Record<DraftField, string[]>>;
  form: string[];
}

export const noIssues = (): DraftIssues => ({ fields: {}, form: [] });
export const hasIssues = (issues: DraftIssues): boolean =>
  issues.form.length > 0 || DRAFT_FIELDS.some((f) => (issues.fields[f]?.length ?? 0) > 0);

/** Concepts are displayed, never edited, so they are not a form value. */
export function formDefaults(draft: DraftQuestionDto): DraftFormValues {
  return {
    sentence: draft.sentence,
    answers: [...draft.answers],
    distractors: [...draft.distractors],
  };
}

/** Number of `___` blanks in the sentence. */
export const blankCount = (sentence: string): number => countBlanks(sentence);

function addIssue(issues: DraftIssues, path: string, message: string): void {
  const field = DRAFT_FIELDS.find(
    (f) => path === f || path.startsWith(`${f}.`) || path.startsWith(`${f}[`),
  );
  if (field) (issues.fields[field] ??= []).push(message);
  else if (!issues.form.includes(message)) issues.form.push(message);
}

/**
 * Runs the shared draft validator (no local copy of the rules). The linked concepts are the draft's own, so the
 * "link to a concept" rule is judged on what is stored; the passage rule applies only when the draft has a passage.
 */
export function validateValues(values: DraftFormValues, draft: DraftQuestionDto): DraftIssues {
  const slugs = draft.concepts.map((c) => c.id);
  const result = validateDraft(
    { ...values, conceptSlugs: slugs },
    { chunkText: draft.passage?.text ?? null, allowedSlugs: new Set(slugs) },
  );
  const issues = noIssues();
  if (!result.ok) for (const v of result.violations) addIssue(issues, v.path, v.message);
  return issues;
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Only the keys that differ from the stored draft, for `PATCH`. */
export function changedFields(
  values: DraftFormValues,
  draft: DraftQuestionDto,
): DraftUpdateRequest {
  const diff: DraftUpdateRequest = {};
  if (values.sentence !== draft.sentence) diff.sentence = values.sentence;
  if (!sameList(values.answers, draft.answers)) diff.answers = values.answers;
  if (!sameList(values.distractors, draft.distractors)) diff.distractors = values.distractors;
  return diff;
}

export const isDirty = (values: DraftFormValues, draft: DraftQuestionDto): boolean =>
  Object.keys(changedFields(values, draft)).length > 0;

/**
 * Maps a failed save or approve to field and form messages. A 422 with `details.issues` goes to the fields named
 * by `path`; issues with no mappable path, and any other error, become form-level messages.
 */
export function mapServerError(error: unknown): DraftIssues {
  const issues = noIssues();
  if (isApiClientError(error) && error.status === 422) {
    for (const issue of error.issues) addIssue(issues, issue.path, issue.message);
    if (!hasIssues(issues)) issues.form.push(error.message);
    return issues;
  }
  issues.form.push(isApiClientError(error) ? error.message : 'Service unavailable.');
  return issues;
}
