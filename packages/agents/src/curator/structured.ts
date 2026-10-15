// The only file in the Curator that calls ChatProvider.completeStructured.
import type { z } from 'zod';
import { ProviderError, ProviderOutputError } from '../llm/errors';
import { MAX_OUTPUT_RETRIES } from './constants';
import { CuratorStepError, type CuratorDeps, type StepContext } from './ports';
import type { StepName } from './steps';

export interface StructuredRequest<T> {
  node: StepName;
  /** Call-site name, e.g. 'curator.extractConcepts'. Used by the stub, logs, and traces; never content. */
  label: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  schemaName?: string;
}

/**
 * One validated model answer. The provider validates against the schema and retries with the issues appended; this
 * adds the usage of the call (all attempts, or the attempts made before a failure) to the step's meter and maps the
 * provider's errors to the step error codes. It makes no tracer call of its own: the provider reports the call under
 * `ctx.trace`.
 */
export async function callStructured<T>(
  deps: Pick<CuratorDeps, 'chat'>,
  ctx: Pick<StepContext, 'meter' | 'trace'>,
  req: StructuredRequest<T>,
): Promise<T> {
  try {
    const result = await deps.chat.completeStructured(
      [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
      req.schema,
      {
        label: req.label,
        schemaName: req.schemaName ?? req.label.replace(/\W+/g, '_'),
        maxRetries: MAX_OUTPUT_RETRIES,
        trace: ctx.trace,
      },
    );
    ctx.meter.add(result.usage);
    return result.value;
  } catch (error) {
    if (error instanceof ProviderError) {
      ctx.meter.add(error.usage);
      if (error instanceof ProviderOutputError) {
        // `raw` and the issues' messages may echo model output; only a count goes into the stored error.
        throw new CuratorStepError(
          req.node,
          'INVALID_MODEL_OUTPUT',
          `The model's answer did not match the expected shape (${error.issues.length} issues)`,
          {
            cause: error,
          },
        );
      }
      throw new CuratorStepError(
        req.node,
        'PROVIDER_UNAVAILABLE',
        'The model provider could not answer',
        { cause: error },
      );
    }
    throw error;
  }
}
