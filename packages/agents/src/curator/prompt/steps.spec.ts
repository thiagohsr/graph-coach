import { describe, expect, it } from 'vitest';
import { PROMPT_STEP_ORDER, resolvePromptEntry, type StepName } from '../steps';

describe('PROMPT_STEP_ORDER', () => {
  it('is the five graph nodes and publish', () => {
    expect([...PROMPT_STEP_ORDER]).toEqual([
      'outline',
      'draftQuestions',
      'critique',
      'refine',
      'validate',
      'publish',
    ]);
  });
});

describe('resolvePromptEntry', () => {
  const table: Array<[StepName | null, boolean, string]> = [
    [null, false, 'outline'],
    [null, true, 'outline'],
    ['outline', true, 'draftQuestions'],
    ['outline', false, 'outline'],
    ['draftQuestions', true, 'draftQuestions'],
    ['critique', true, 'draftQuestions'],
    ['refine', true, 'draftQuestions'],
    ['draftQuestions', false, 'outline'],
    ['validate', true, 'finalise'],
    ['validate', false, 'finalise'],
    ['publish', true, 'none'],
  ];
  it.each(table)('after %s with outline=%s it enters at %s', (last, hasOutline, expected) => {
    expect(resolvePromptEntry(last, hasOutline)).toBe(expected);
  });
});
