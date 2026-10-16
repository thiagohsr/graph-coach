import { describe, expect, it } from 'vitest';
import { SettingsSchema } from './settings.schema';

describe('SettingsSchema.traversalDepth', () => {
  const depth = SettingsSchema.shape.traversalDepth;

  it('accepts 1 to 8', () => {
    expect(depth.safeParse(1).success).toBe(true);
    expect(depth.safeParse(8).success).toBe(true);
  });

  it('rejects 9 (FalkorDB cannot bind a variable-length bound; the queries use a fixed *1..8)', () => {
    expect(depth.safeParse(9).success).toBe(false);
    expect(depth.safeParse(0).success).toBe(false);
  });
});
