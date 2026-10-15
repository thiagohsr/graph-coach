import type { Origin } from '~/lib/api/gameplay-schemas';

// TEMPORARY LOCAL COPY (reconciliation J3/J16): the label must come from the `PROMPT_ORIGIN_NOTICE` constant
// in `@coach/types`, which does not exist yet. Replace this import when it does (task T092 owns that switch).
export const PROMPT_ORIGIN_NOTICE = 'Generated from a prompt, not checked against a source';

/** `access` is the puzzle list item's value; omit it where the viewer is the owner by construction. */
export function originLabel(origin: Origin, access?: 'owner' | 'shared' | 'public'): string {
  if (origin === 'prompt') return PROMPT_ORIGIN_NOTICE;
  if (origin === 'seed') return 'Seeded puzzle';
  return access === 'owner' ? 'From your material' : 'From uploaded material';
}
