import type { DecisionDto, DecisionPathDto, RecommendationDto } from '@coach/types';

export const recommendation: RecommendationDto = {
  decisionId: 'dec-1',
  puzzle: { id: 'pz-1', name: 'Databases 101: Storage and B-trees' },
  target: { conceptId: 'c-bt', name: 'B-trees' },
  summary: 'Practise "B-trees" first. You missed "Indexes" 4 times.',
  alternatives: [{ conceptId: 'c-tx', name: 'Transactions' }],
  flags: ['prerequisite_first'],
  reused: false,
};

export const decision: DecisionDto = {
  id: 'dec-1',
  kind: 'recommendation',
  summary: recommendation.summary,
  createdAt: '2026-10-11T14:03:27.000Z',
  puzzle: recommendation.puzzle,
  target: recommendation.target,
  flags: ['prerequisite_first'],
};

export const path: DecisionPathDto = {
  nodes: [
    { id: 'dec-1', label: 'Decision', title: 'Coach decision', props: { kind: 'recommendation', createdAt: '2026-10-11T14:03:27.000Z', flags: ['x'], nested: { a: 1 } } },
    { id: 'Coach', label: 'Agent', title: 'Coach', props: { name: 'Coach' } },
    { id: 'pz-1', label: 'Puzzle', title: 'Databases 101: Storage and B-trees', props: {} },
    { id: 'c-bt', label: 'Concept', title: 'B-trees', props: { slug: 'b-trees' } },
    { id: 'c-ix', label: 'Concept', title: 'Indexes', props: {} },
  ],
  edges: [
    { from: 'Coach', to: 'dec-1', type: 'MADE', reason: 'decided by the Coach' },
    { from: 'dec-1', to: 'pz-1', type: 'RECOMMENDED' },
    { from: 'dec-1', to: 'c-bt', type: 'BECAUSE', role: 'target', reason: 'target: mastery 0.12', weight: 0.72 },
    { from: 'dec-1', to: 'c-ix', type: 'BECAUSE', role: 'driver', reason: 'weak concept', weight: 0.36 },
    { from: 'c-bt', to: 'c-ix', type: 'PREREQUISITE_OF', reason: 'prerequisite of' },
  ],
  steps: [
    'The Coach recommended the puzzle "Databases 101: Storage and B-trees".',
    'B-trees: target, mastery 0.12.',
    'B-trees is a prerequisite of Indexes.',
  ],
};
