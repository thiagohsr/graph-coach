// What the model must return (data-model.md §6). Zod-validated before anything is written.
import { z } from 'zod';

export const ExtractedConcept = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().min(10).max(200),
  /** One of the "known concepts" given in the prompt, or null. */
  existingSlug: z.string().max(64).nullish(),
});
export type ExtractedConcept = z.infer<typeof ExtractedConcept>;

export const ExtractedConcepts = z.object({
  concepts: z.array(ExtractedConcept).max(6),
});
export type ExtractedConcepts = z.infer<typeof ExtractedConcepts>;

export const PrerequisiteLinks = z.object({
  links: z
    .array(
      z.object({
        /** Slug from the list in the prompt. */
        prerequisite: z.string().max(64),
        /** Slug from the list in the prompt. */
        dependent: z.string().max(64),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(30),
});
export type PrerequisiteLinks = z.infer<typeof PrerequisiteLinks>;

export const DraftQuestions = z.object({
  questions: z
    .array(
      z.object({
        /** Contains one ___ per answer. */
        sentence: z.string().min(20).max(300),
        answers: z.array(z.string().trim().min(1).max(40)).min(1).max(3),
        distractors: z.array(z.string().trim().min(1).max(40)).min(2).max(6),
        conceptSlugs: z.array(z.string().max(64)).min(1).max(3),
      }),
    )
    .max(3),
});
export type DraftQuestions = z.infer<typeof DraftQuestions>;
