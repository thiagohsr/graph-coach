import { PROMPT_ORIGIN_NOTICE } from '@coach/types';
import type { Origin } from '~/lib/api/gameplay-schemas';

/** `access` is the puzzle list item's value; omit it where the viewer is the owner by construction. */
export function originLabel(origin: Origin, access?: 'owner' | 'shared' | 'public'): string {
  if (origin === 'prompt') return PROMPT_ORIGIN_NOTICE;
  if (origin === 'seed') return 'Seeded puzzle';
  return access === 'owner' ? 'From your material' : 'From uploaded material';
}
