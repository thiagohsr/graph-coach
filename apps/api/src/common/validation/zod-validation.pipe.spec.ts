import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationFailedError } from '../errors/app-error';
import { ZodValidationPipe } from './zod-validation.pipe';

const Schema = z.object({
  name: z.string().trim().min(1),
  answers: z.array(z.object({ word: z.string(), blank: z.number().int() })),
});

describe('ZodValidationPipe', () => {
  it('returns the parsed, transformed value and strips unknown fields', () => {
    const pipe = new ZodValidationPipe(Schema);
    expect(pipe.transform({ name: '  Ada ', answers: [], extra: true })).toEqual({
      name: 'Ada',
      answers: [],
    });
  });

  it('throws ValidationFailedError (422), not a 400', () => {
    const pipe = new ZodValidationPipe(Schema);
    try {
      pipe.transform({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).status).toBe(422);
      expect((error as ValidationFailedError).code).toBe('VALIDATION_FAILED');
    }
  });

  it('returns all Zod issues with dotted paths', () => {
    const pipe = new ZodValidationPipe(Schema);
    try {
      pipe.transform({ name: '', answers: [{ word: 'a', blank: 0 }, { word: 1 }, { blank: 'x' }] });
      expect.unreachable();
    } catch (error) {
      const issues = (
        (error as ValidationFailedError).details as {
          issues: Array<{ path: string; message: string; code?: string }>;
        }
      ).issues;
      expect(issues.map((issue) => issue.path)).toEqual([
        'name',
        'answers.1.word',
        'answers.1.blank',
        'answers.2.word',
        'answers.2.blank',
      ]);
      expect(
        issues.every((issue) => issue.message.length > 0 && typeof issue.code === 'string'),
      ).toBe(true);
    }
  });

  it('works for query and path values (schemas that coerce)', () => {
    const pipe = new ZodValidationPipe(z.object({ limit: z.coerce.number().int().min(1).max(50) }));
    expect(pipe.transform({ limit: '10' })).toEqual({ limit: 10 });
    expect(() => pipe.transform({ limit: '500' })).toThrow(ValidationFailedError);
  });
});
