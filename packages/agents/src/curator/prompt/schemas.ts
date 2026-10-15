// What the three prompt agents must return (data-model.md §6). Zod-validated before anything is stored or written.
// The writer's schema has no free-text reasoning field, so there is no writer reasoning to leak to the critic.
import { z } from 'zod';

/** Planner. */
export const Outline = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().min(10).max(200),
      }),
    )
    .min(1)
    .max(6),
  /** One planned sentence each. */
  sentences: z
    .array(
      z.object({
        /** The fact the sentence must state. */
        fact: z.string().trim().min(20).max(300),
        /** Name of one concept above. */
        concept: z.string().max(60),
      }),
    )
    .min(3)
    .max(12),
  /** Brief-specific; added to the fixed criteria, never substituted for them. */
  criteria: z.array(z.string().trim().min(10).max(200)).min(1).max(6),
  prerequisites: z
    .array(
      z.object({
        prerequisite: z.string().max(60),
        dependent: z.string().max(60),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(6),
});
export type Outline = z.infer<typeof Outline>;

/** Writer, first pass and rewrite. */
export const PromptDrafts = z.object({
  drafts: z
    .array(
      z.object({
        /** Index of the planned sentence. */
        index: z.number().int().min(0),
        /** Contains one ___ per answer. */
        sentence: z.string().min(20).max(300),
        answers: z.array(z.string().trim().min(1).max(40)).min(1).max(2),
        distractors: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
        conceptSlug: z.string().max(64),
      }),
    )
    .max(12),
});
export type PromptDrafts = z.infer<typeof PromptDrafts>;

export const CRITERIA_CODES = [
  'one_answer',
  'plausible_fact',
  'answer_not_given_away',
  'difficulty',
  'concept_fit',
  'distractors',
] as const;

export const Verdict = z.enum(['pass', 'rewrite', 'reject']);
export type Verdict = z.infer<typeof Verdict>;

/** Critic, first pass and second judgement. */
export const Critiques = z.object({
  reviews: z
    .array(
      z.object({
        index: z.number().int().min(0),
        verdict: Verdict,
        /** Which criterion fails and why, or why it passes. */
        note: z.string().trim().min(1).max(300),
        failed: z.array(z.enum(CRITERIA_CODES)).max(6),
      }),
    )
    .max(12),
});
export type Critiques = z.infer<typeof Critiques>;

/**
 * The critic's schema for one call: every draft that was sent must have exactly one review and no other index may
 * appear. A miss is schema-invalid output, so the provider retries with the issues appended and then the step fails.
 */
export function critiquesFor(indices: readonly number[]) {
  const wanted = new Set(indices);
  return Critiques.superRefine((value, ctx) => {
    const seen = new Set<number>();
    value.reviews.forEach((review, position) => {
      if (!wanted.has(review.index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reviews', position, 'index'],
          message: `index ${review.index} was not sent for review`,
        });
      } else if (seen.has(review.index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reviews', position, 'index'],
          message: `index ${review.index} is reviewed twice`,
        });
      }
      seen.add(review.index);
    });
    for (const index of wanted) {
      if (!seen.has(index)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reviews'],
          message: `draft ${index} has no review`,
        });
      }
    }
  });
}
