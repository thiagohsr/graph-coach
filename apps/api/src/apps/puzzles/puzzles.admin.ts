// Admin registration of the puzzles feature: puzzle (the design documents section 6).
// Imported by apps/admin/admin.registrations.ts. Metadata only: no distractors, no link to questions, and no link over
// SHARED_WITH. `Question` is never registered.
import { registerAdmin } from '@coach/admin-kit';

export const puzzleAdmin = registerAdmin({
  name: 'puzzle',
  label: 'Puzzles',
  group: 'Puzzles',
  source: 'graph',
  entity: 'Puzzle',
  readOnly: true,
  listDisplay: ['name', 'origin', 'status', 'visibility', 'createdAt'],
  searchFields: ['name'],
  ordering: ['name'],
  fields: {
    id: { readonly: true },
    name: { readonly: true },
    origin: { type: 'enum', choices: ['seed', 'upload', 'prompt'], readonly: true },
    status: { type: 'enum', choices: ['draft', 'published'], readonly: true },
    visibility: { type: 'enum', choices: ['private', 'public'], readonly: true },
    createdAt: { type: 'datetime', label: 'Created at', readonly: true },
  },
  links: [
    {
      kind: 'records',
      name: 'owner',
      label: 'Owner',
      rel: 'OWNS',
      direction: 'in',
      targetLabel: 'Learner',
      titleProperty: 'displayName',
      model: 'user',
    },
    {
      kind: 'records',
      name: 'source',
      label: 'Source',
      rel: 'YIELDED',
      direction: 'in',
      targetLabel: 'Source',
      titleProperty: 'title',
      model: 'source',
    },
  ],
});
