import { describe, expect, it } from 'vitest';
import { GraphKitError } from './errors';
import { NODE_LABELS, REL_TYPES, assertNodeLabel, assertRelType, keyPropertyOf } from './schema';

describe('schema enums', () => {
  it('has 12 node labels', () => {
    expect(NODE_LABELS).toHaveLength(12);
    expect(new Set(NODE_LABELS).size).toBe(12);
  });

  it('has 29 relationship types including the late additions', () => {
    expect(REL_TYPES).toHaveLength(29);
    expect(new Set(REL_TYPES).size).toBe(29);
    for (const type of ['CHANGED_MASTERY', 'SHARED_WITH', 'GENERATED_FROM']) {
      expect(REL_TYPES).toContain(type);
    }
  });

  it('uses name as the key of Agent and id for every other label', () => {
    expect(keyPropertyOf('Agent')).toBe('name');
    for (const label of NODE_LABELS.filter((l) => l !== 'Agent')) {
      expect(keyPropertyOf(label)).toBe('id');
    }
  });

  it('throws INVALID_IDENTIFIER for an unknown label or type', () => {
    expect(() => assertNodeLabel('Robot')).toThrow(GraphKitError);
    try {
      assertNodeLabel('Learner) DETACH DELETE (n');
    } catch (error) {
      expect((error as GraphKitError).code).toBe('INVALID_IDENTIFIER');
    }
    expect(() => assertRelType('LIKES')).toThrow(/INVALID_IDENTIFIER|Unknown relationship type/);
    expect(() => assertNodeLabel('Learner')).not.toThrow();
    expect(() => assertRelType('SHARED_WITH')).not.toThrow();
  });
});
