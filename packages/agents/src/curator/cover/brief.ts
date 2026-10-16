import type { PromptBrief } from '@coach/types';

const SUBJECT_MAX = 120;
const FOCUS_MAX = 300;
const SENTENCES_MIN = 3;
const SENTENCES_MAX = 10;
/** Two sentences per missing concept, within the brief's bounds. */
const SENTENCES_PER_CONCEPT = 2;

function clip(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('').trimEnd();
}

/**
 * The brief a `cover` task runs the prompt graph with (spec 005 US7, reconciliation J14): the subject names the missing
 * concepts, the focus carries their descriptions. Pure; the result is valid for `PromptBrief` and passes `guardBrief`.
 */
export function briefForConcepts(concepts: { name: string; description: string }[]): PromptBrief {
  const names = concepts.map((concept) => concept.name.trim()).filter((name) => name !== '');
  let subject = clip(names.join(', '), SUBJECT_MAX);
  // A very short name (such as "Go") is below the subject minimum; give it some context.
  if (Array.from(subject).length < 3 || !/\p{L}{3,}/u.test(subject))
    subject = clip(`About ${subject}`.trim(), SUBJECT_MAX);
  if (!/\p{L}{3,}/u.test(subject)) subject = 'Missing concepts';

  const focus = clip(
    concepts
      .map((concept) => concept.description.trim())
      .filter((description) => description !== '')
      .join(' '),
    FOCUS_MAX,
  );
  const sentences = Math.min(
    SENTENCES_MAX,
    Math.max(SENTENCES_MIN, concepts.length * SENTENCES_PER_CONCEPT),
  );
  return { subject, ...(focus !== '' ? { focus } : {}), difficulty: 'medium', sentences };
}
