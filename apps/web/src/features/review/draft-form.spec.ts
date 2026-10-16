import { describe, expect, it } from 'vitest';
import { ApiClientError } from '~/lib/api/errors';
import {
  changedFields,
  formDefaults,
  hasIssues,
  isDirty,
  mapServerError,
  validateValues,
  blankCount,
} from './draft-form';
import { draft } from './fixtures';

describe('draft-form', () => {
  it('builds defaults with sentence, answers, distractors and no concept field', () => {
    const values = formDefaults(draft());
    expect(Object.keys(values).sort()).toEqual(['answers', 'distractors', 'sentence']);
    expect(values.answers).toEqual(['index', 'writes']);
  });

  it('does not share arrays with the draft', () => {
    const d = draft();
    const values = formDefaults(d);
    values.answers.push('x');
    expect(d.answers).toEqual(['index', 'writes']);
  });

  it('counts blanks', () => {
    expect(blankCount('A ___ and a ___ and ____')).toBe(2);
  });

  it('accepts a valid draft', () => {
    const d = draft();
    expect(hasIssues(validateValues(formDefaults(d), d))).toBe(false);
  });

  it('maps validator issues to fields by path', () => {
    const d = draft();
    const issues = validateValues({ ...formDefaults(d), answers: ['index'] }, d);
    expect(issues.fields.answers?.[0]).toMatch(/2 blanks but 1 answer/);
    expect(issues.fields.sentence).toBeUndefined();

    const noBlank = validateValues(
      { ...formDefaults(d), sentence: 'A database index speeds up lookups a lot.' },
      d,
    );
    expect(noBlank.fields.sentence?.join(' ')).toMatch(/three underscores/);

    const fewDistractors = validateValues({ ...formDefaults(d), distractors: ['cache'] }, d);
    expect(fewDistractors.fields.distractors?.[0]).toMatch(/at least 2/);
  });

  it('reports an answer that is not in the passage, but not for a draft with no passage', () => {
    const d = draft();
    const values = { ...formDefaults(d), answers: ['index', 'planner'] };
    expect(validateValues(values, d).fields.answers?.join(' ')).toMatch(
      /Answer 2 does not appear in the passage/,
    );
    const prompt = draft({ passage: null, origin: 'prompt' });
    expect(hasIssues(validateValues(values, prompt))).toBe(false);
  });

  it('puts a rule that belongs to no field (no linked concept) in the form messages', () => {
    const d = draft({ concepts: [] });
    const issues = validateValues(formDefaults(d), d);
    expect(issues.form.join(' ')).toMatch(/concept/);
  });

  it('sends only the changed keys among the three fields', () => {
    const d = draft();
    const values = formDefaults(d);
    expect(changedFields(values, d)).toEqual({});
    expect(isDirty(values, d)).toBe(false);
    expect(
      changedFields(
        { ...values, sentence: 'A database ___ speeds up lookups at the cost of slower ___!' },
        d,
      ),
    ).toEqual({
      sentence: 'A database ___ speeds up lookups at the cost of slower ___!',
    });
    expect(changedFields({ ...values, distractors: ['cache', 'view'] }, d)).toEqual({
      distractors: ['cache', 'view'],
    });
    expect(changedFields({ ...values, answers: ['index', 'writes', 'x'] }, d)).toEqual({
      answers: ['index', 'writes', 'x'],
    });
  });

  it('maps a 422 DRAFT_INVALID with details.issues to fields', () => {
    const error = new ApiClientError({
      status: 422,
      code: 'DRAFT_INVALID',
      message: 'The draft does not meet the rules',
      issues: [
        { path: 'sentence', message: 'The sentence must be 20 to 300 characters long.' },
        { path: 'distractors', message: 'Give at least 2 different distractors.' },
      ],
    });
    const issues = mapServerError(error);
    expect(issues.fields.sentence).toEqual(['The sentence must be 20 to 300 characters long.']);
    expect(issues.fields.distractors).toEqual(['Give at least 2 different distractors.']);
    expect(issues.form).toEqual([]);
  });

  it('maps a 422 without mappable paths to a form-level message', () => {
    const none = new ApiClientError({
      status: 422,
      code: 'DRAFT_INVALID',
      message: 'The draft does not meet the rules',
    });
    expect(mapServerError(none)).toEqual({
      fields: {},
      form: ['The draft does not meet the rules'],
    });
    const odd = new ApiClientError({
      status: 422,
      code: 'DRAFT_INVALID',
      message: 'bad',
      issues: [{ path: 'concepts', message: 'Link the question to at least one known concept.' }],
    });
    expect(mapServerError(odd).form).toEqual(['Link the question to at least one known concept.']);
  });

  it('maps any other failure to a form-level message', () => {
    expect(mapServerError(new Error('boom')).form).toEqual(['Service unavailable.']);
  });
});
