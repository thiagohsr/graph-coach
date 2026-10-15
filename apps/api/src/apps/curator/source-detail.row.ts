import { z } from 'zod';

const nullableString = z
  .string()
  .nullish()
  .transform((s) => s ?? null);

/** One row of get_source: the only place a source's text or brief is read for a request. */
export const SourceDetailRow = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['text', 'markdown', 'url', 'prompt']),
  createdAt: z.number(),
  content: nullableString,
  /** JSON string of the submitted brief (prompt sources). */
  brief: nullableString,
  access: z.enum(['owner', 'shared']),
  ownerName: z
    .string()
    .nullish()
    .transform((s) => s ?? ''),
  puzzleId: nullableString,
});
export type SourceDetailRow = z.infer<typeof SourceDetailRow>;
