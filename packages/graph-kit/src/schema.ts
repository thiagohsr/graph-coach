import { GraphKitError } from './errors';

export const NODE_LABELS = [
  'Learner',
  'Concept',
  'Source',
  'Chunk',
  'Question',
  'Puzzle',
  'Session',
  'Decision',
  'Goal',
  'Task',
  'Step',
  'Agent',
] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const REL_TYPES = [
  'HAS_MASTERY',
  'PREREQUISITE_OF',
  'TESTS',
  'GROUNDED_IN',
  'OWNS',
  'HAS_CHUNK',
  'NEXT',
  'MENTIONS',
  'YIELDED',
  'CONTAINS',
  'PLAYED',
  'OF',
  'ANSWERED',
  'MADE',
  'FOR',
  'RECOMMENDED',
  'BECAUSE',
  'TOWARD',
  'REQUESTED',
  'HAS_GOAL',
  'TARGETS',
  'ASSIGNED_TO',
  'CONCERNS',
  'HAS_STEP',
  'PRODUCED',
  'REVIEWED',
  'CHANGED_MASTERY',
  'SHARED_WITH',
  'GENERATED_FROM',
] as const;
export type RelType = (typeof REL_TYPES)[number];

/** 'name' for Agent, 'id' for every other label. */
export function keyPropertyOf(label: NodeLabel): 'id' | 'name' {
  return label === 'Agent' ? 'name' : 'id';
}

export function assertNodeLabel(value: string): asserts value is NodeLabel {
  if (!(NODE_LABELS as readonly string[]).includes(value)) {
    throw new GraphKitError('INVALID_IDENTIFIER', `Unknown node label "${value}"`);
  }
}

export function assertRelType(value: string): asserts value is RelType {
  if (!(REL_TYPES as readonly string[]).includes(value)) {
    throw new GraphKitError('INVALID_IDENTIFIER', `Unknown relationship type "${value}"`);
  }
}
