// Admin registration of the coach feature: decision (the design documents section 6).
// Imported by apps/admin/admin.registrations.ts. Evidence over questions, sessions, and chunks is not linked; "Why this?"
// is a route link, and the Coach API decides what an admin may see there.
import { registerAdmin } from '@coach/admin-kit';

export const decisionAdmin = registerAdmin({
  name: 'decision',
  label: 'Decisions',
  group: 'Agents',
  source: 'graph',
  entity: 'Decision',
  readOnly: true,
  titleField: 'summary',
  listDisplay: ['kind', 'summary', 'inputTokens', 'outputTokens', 'createdAt'],
  searchFields: ['summary'],
  ordering: ['-createdAt'],
  fields: {
    id: { readonly: true },
    kind: { type: 'enum', choices: ['recommendation', 'coverage_request'], readonly: true },
    summary: { type: 'text', readonly: true },
    flags: { type: 'list', readonly: true },
    modelCalls: { type: 'integer', label: 'Model calls', readonly: true },
    inputTokens: { type: 'integer', label: 'Input tokens', readonly: true },
    outputTokens: { type: 'integer', label: 'Output tokens', readonly: true },
    embeddingTokens: { type: 'integer', label: 'Embedding tokens', readonly: true },
    llmProvider: { type: 'string', label: 'Chat provider', readonly: true },
    llmModel: { type: 'string', label: 'Chat model', readonly: true },
    createdAt: { type: 'datetime', label: 'Created at', readonly: true },
  },
  links: [
    {
      kind: 'records',
      name: 'learner',
      label: 'Learner',
      rel: 'FOR',
      direction: 'out',
      targetLabel: 'Learner',
      titleProperty: 'displayName',
      model: 'user',
    },
    {
      kind: 'records',
      name: 'puzzle',
      label: 'Recommended puzzle',
      rel: 'RECOMMENDED',
      direction: 'out',
      targetLabel: 'Puzzle',
      titleProperty: 'name',
      model: 'puzzle',
    },
    {
      kind: 'records',
      name: 'evidenceConcepts',
      label: 'Evidence concepts',
      rel: 'BECAUSE',
      direction: 'out',
      targetLabel: 'Concept',
      titleProperty: 'name',
      model: 'concept',
    },
    { kind: 'route', name: 'why', label: 'Why this?', href: '/decisions/:id' },
  ],
});
