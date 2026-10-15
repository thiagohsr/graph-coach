import { describe, expect, it } from 'vitest';
import type { AdminHookContext } from '@coach/admin-kit';
import { SETTING_KEYS } from '../../common/settings/settings.schema';
import { validateSetting } from './accounts.admin';

const ctx = (key: string, value: unknown): AdminHookContext => ({
  model: 'admin-setting',
  id: key,
  current: {},
  changes: { value: value as never },
  actor: { id: 'a', role: 'admin' },
});

describe('admin-setting hook', () => {
  it.each([
    ['minQuestions', 4],
    ['creationEnabled', false],
    ['monthlySourceAllowance', 1],
    ['monthlyPromptAllowance', 0],
    ['hourlyCreationLimit', 2],
    ['masteryAlpha', 0.5],
  ])('accepts %s = %j (the platform schema decides)', (key, value) => {
    expect(validateSetting(ctx(key, value))).toBeUndefined();
  });

  it.each([
    ['minQuestions', 'many'],
    ['masteryAlpha', 1.5],
    ['creationEnabled', 'no'],
    ['hourlyCreationLimit', -1],
    ['monthlySourceAllowance', 1001],
  ])('rejects %s = %j with a message on value', (key, value) => {
    const result = validateSetting(ctx(key, value));
    expect(result).toEqual({ fields: { value: expect.any(String) } });
  });

  it('rejects any edit of embeddingDim', () => {
    for (const value of [64, null, 'x']) {
      expect(validateSetting(ctx('embeddingDim', value))).toEqual({ fields: { value: expect.stringContaining('embeddingDim') } });
    }
  });

  it('rejects an unknown key, including prototype names', () => {
    for (const key of ['nope', 'constructor', '__proto__', '']) {
      expect(validateSetting(ctx(key, 1))).toEqual({ fields: { value: expect.any(String) } });
    }
  });

  it('knows the fifteen canonical keys', () => {
    expect(SETTING_KEYS).toHaveLength(15);
  });
});
