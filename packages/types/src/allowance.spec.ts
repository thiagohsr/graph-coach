import { describe, expect, it } from 'vitest';
import { AllowanceDto, CreationLimitDetails, RedeemRequest, RedeemResult } from './index';

const kind = { used: 1, allowance: 3, bonus: 0, resetsAt: '2026-11-01T00:00:00.000Z' };

describe('AllowanceDto', () => {
  it('accepts a limited learner', () => {
    const dto = { upload: kind, prompt: kind, hourly: { used: 0, limit: 5 }, creationEnabled: true };
    expect(AllowanceDto.parse(dto)).toEqual(dto);
  });

  it('accepts allowance null and limit null for unlimited roles', () => {
    const dto = {
      upload: { ...kind, allowance: null },
      prompt: { ...kind, allowance: null },
      hourly: { used: 2, limit: null },
      creationEnabled: false,
    };
    expect(AllowanceDto.safeParse(dto).success).toBe(true);
  });

  it('allows liftedUntil only as a date-time', () => {
    const base = { upload: kind, prompt: kind, creationEnabled: true };
    expect(
      AllowanceDto.safeParse({ ...base, hourly: { used: 0, limit: 5, liftedUntil: 'tomorrow' } }).success,
    ).toBe(false);
    expect(
      AllowanceDto.safeParse({
        ...base,
        hourly: { used: 0, limit: 5, liftedUntil: '2026-11-01T00:00:00.000Z' },
      }).success,
    ).toBe(true);
  });
});

describe('RedeemRequest', () => {
  it('trims the code', () => {
    expect(RedeemRequest.parse({ code: '  gc-abc  ' })).toEqual({ code: 'gc-abc' });
  });

  it('rejects an empty or over-long code', () => {
    expect(RedeemRequest.safeParse({ code: '   ' }).success).toBe(false);
    expect(RedeemRequest.safeParse({ code: 'x'.repeat(65) }).success).toBe(false);
    expect(RedeemRequest.safeParse({}).success).toBe(false);
  });
});

describe('RedeemResult', () => {
  it('makes limitsLiftedUntil optional', () => {
    expect(RedeemResult.safeParse({ sourceRuns: 0, promptRuns: 2 }).success).toBe(true);
  });
});

describe('CreationLimitDetails', () => {
  const full = {
    retryAfterSeconds: 10,
    resetAt: '2026-11-01T00:00:00.000Z',
    window: 'month',
    kind: 'upload',
    canRedeemCode: true,
  };

  it('accepts the full shape', () => {
    expect(CreationLimitDetails.parse(full)).toEqual(full);
  });

  it.each(['window', 'kind', 'resetAt', 'canRedeemCode'])('requires %s', (key) => {
    const copy: Record<string, unknown> = { ...full };
    delete copy[key];
    expect(CreationLimitDetails.safeParse(copy).success).toBe(false);
  });
});
