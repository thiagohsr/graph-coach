import { Injectable, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';
import { ValidationFailedError } from '../errors/app-error';

/**
 * Parses with the schema and returns the parsed (transformed) value. A failure throws ValidationFailedError, answered
 * as 422 VALIDATION_FAILED (never 400) with every issue in `details.issues[]` as `{ path, message, code }`.
 * Used for `@Body()`, `@Query()`, and `@Param()`.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new ValidationFailedError(
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }
}
