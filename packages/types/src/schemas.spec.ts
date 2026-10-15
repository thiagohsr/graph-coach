import { describe, expect, it } from 'vitest';
import {
  AgentEvent,
  ApiError,
  DevLoginRequest,
  DevUserDto,
  ErrorCode,
  HealthDto,
  MeDto,
  RateLimitDetails,
  UserRef,
  ValidationDetails,
} from './index';

const uuid = '2f1f6a52-8c1e-4d6e-9d5f-0a6f6d9c1b11';

describe('MeDto', () => {
  const valid = {
    id: uuid,
    name: 'Ada',
    email: 'ada@example.test',
    role: 'learner',
    status: 'active',
  };

  it('accepts a complete record', () => {
    expect(MeDto.parse(valid)).toEqual(valid);
  });

  it.each(['id', 'name', 'email', 'role', 'status'])('requires %s', (key) => {
    const { [key]: _omitted, ...rest } = valid as Record<string, unknown>;
    expect(MeDto.safeParse(rest).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(MeDto.safeParse({ ...valid, status: 'suspended' }).success).toBe(false);
  });
});

describe('UserRef', () => {
  it('has no e-mail field: an extra email is stripped', () => {
    const parsed = UserRef.parse({ id: uuid, name: 'Ada', email: 'ada@example.test' });
    expect(parsed).toEqual({ id: uuid, name: 'Ada' });
    expect('email' in parsed).toBe(false);
  });
});

describe('DevUserDto', () => {
  it('has exactly email, name, role', () => {
    expect(Object.keys(DevUserDto.shape).sort()).toEqual(['email', 'name', 'role']);
  });
});

describe('DevLoginRequest', () => {
  it('trims and lower-cases the address', () => {
    expect(DevLoginRequest.parse({ email: '  Ada@Example.TEST ' })).toEqual({
      email: 'ada@example.test',
    });
  });

  it('rejects a non-address', () => {
    expect(DevLoginRequest.safeParse({ email: 'not-an-address' }).success).toBe(false);
  });
});

describe('ApiError', () => {
  it('accepts the envelope without details', () => {
    expect(ApiError.safeParse({ error: { code: 'NOT_FOUND', message: 'Not found' } }).success).toBe(
      true,
    );
  });

  it('accepts the envelope with details', () => {
    const body = {
      error: { code: 'VALIDATION_FAILED', message: 'Invalid', details: { issues: [] } },
    };
    expect(ApiError.safeParse(body).success).toBe(true);
  });

  it('rejects a code outside the list', () => {
    expect(ApiError.safeParse({ error: { code: 'TEAPOT', message: 'x' } }).success).toBe(false);
  });
});

describe('HealthDto', () => {
  it('accepts api ok with both stores reported', () => {
    expect(HealthDto.safeParse({ api: 'ok', graph: 'ok', sql: 'down' }).success).toBe(true);
  });

  it('rejects api "down"', () => {
    expect(HealthDto.safeParse({ api: 'down', graph: 'ok', sql: 'ok' }).success).toBe(false);
  });
});

describe('ErrorCode', () => {
  it('has exactly the 24 codes of the canonical contract', () => {
    expect([...ErrorCode.options].sort()).toEqual(
      [
        'VALIDATION_FAILED',
        'UNAUTHENTICATED',
        'INVALID_CREDENTIALS',
        'FORBIDDEN',
        'ACCOUNT_BLOCKED',
        'NOT_FOUND',
        'ADMIN_MODEL_READ_ONLY',
        'CONFLICT',
        'SESSION_ALREADY_SUBMITTED',
        'SESSION_NOT_SUBMITTED',
        'NO_PLAYABLE_CONTENT',
        'TASK_NOT_FAILED',
        'ALREADY_DECIDED',
        'SOURCE_REJECTED',
        'DRAFT_INVALID',
        'CODE_INVALID',
        'RATE_LIMITED',
        'CREATION_LIMIT_REACHED',
        'INTERNAL',
        'GRAPH_UNAVAILABLE',
        'SQL_UNAVAILABLE',
        'PROVIDER_UNAVAILABLE',
        'DECISION_NOT_RECORDED',
        'CREATION_PAUSED',
      ].sort(),
    );
    expect(ErrorCode.options).toHaveLength(24);
  });

  it.each(['ACCOUNT_BLOCKED', 'CREATION_LIMIT_REACHED', 'CREATION_PAUSED', 'CODE_INVALID'])(
    'includes %s',
    (code) => {
      expect(ErrorCode.safeParse(code).success).toBe(true);
    },
  );

  it.each(['UNPROCESSABLE', 'TOO_MANY_REQUESTS', '', 'not_found'])('rejects %j', (code) => {
    expect(ErrorCode.safeParse(code).success).toBe(false);
  });
});

describe('ValidationDetails', () => {
  it('accepts issues[].code and reasons', () => {
    const details = {
      issues: [
        { path: 'answers.2.word', message: 'Required', code: 'required' },
        { path: 'name', message: 'Too long' },
      ],
      reasons: ['too_few_questions'],
    };
    expect(ValidationDetails.parse(details)).toEqual(details);
  });
});

describe('RateLimitDetails', () => {
  it('accepts optional window, kind, canRedeemCode', () => {
    const full = {
      retryAfterSeconds: 30,
      resetAt: '2026-10-15T12:00:00.000Z',
      window: 'month',
      kind: 'prompt',
      canRedeemCode: true,
    };
    expect(RateLimitDetails.parse(full)).toEqual(full);
    expect(
      RateLimitDetails.safeParse({ retryAfterSeconds: 0, resetAt: full.resetAt }).success,
    ).toBe(true);
  });
});

describe('AgentEvent', () => {
  it('accepts a step event with payload.stepId and payload.order', () => {
    const event = { node: 'extract', status: 'active', payload: { stepId: uuid, order: 2 } };
    expect(AgentEvent.parse(event)).toEqual(event);
  });

  it('accepts the terminal event', () => {
    const event = { node: 'task', status: 'complete', payload: { taskStatus: 'awaiting_review' } };
    expect(AgentEvent.safeParse(event).success).toBe(true);
  });

  it('rejects status awaiting_review', () => {
    expect(AgentEvent.safeParse({ node: 'task', status: 'awaiting_review' }).success).toBe(false);
  });
});
