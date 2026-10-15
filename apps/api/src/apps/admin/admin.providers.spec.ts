import { describe, expect, it, vi } from 'vitest';
import { GraphUnavailableError } from '@coach/graph-kit';
import { createRecordingGraphPort, createRecordingSqlPort } from '@coach/admin-kit/testing';
import type { AdminHookContext } from '@coach/admin-kit';
import { ConflictError, NotFoundError, ValidationFailedError } from '../../common/errors/app-error';
import type { AccountsService } from '../accounts/accounts.service';
import type { CodesService } from '../allowance/codes.service';
import type { CreationCounts } from '../allowance/creation-counts';
import type { UsageTotals } from '../allowance/usage-totals';
import { AdminProviders } from './admin.providers';
import { AdminService } from './admin.service';

const ID = '11111111-1111-4111-8111-111111111111';
const ADMIN = { id: '22222222-2222-4222-8222-222222222222', role: 'admin' as const };

function fakes(overrides: {
  counts?: Partial<CreationCounts>;
  usage?: Partial<UsageTotals>;
  accounts?: Partial<Record<keyof AccountsService, unknown>>;
  codes?: Partial<Record<keyof CodesService, unknown>>;
} = {}) {
  const counts = {
    creationCountsFor: vi.fn(async () => new Map([[ID, { uploadsThisMonth: 2, promptsThisMonth: 1, creationsLastHour: 3 }]])),
    ...overrides.counts,
  };
  const usage = {
    usageTotalsFor: vi.fn(
      async () => new Map([[ID, { modelCalls: 4, inputTokens: 100, outputTokens: 20, embeddingTokens: 5 }]]),
    ),
    ...overrides.usage,
  };
  const accounts = {
    assertCanChangeStatus: vi.fn(async () => undefined),
    assertCanChangeRole: vi.fn(async () => undefined),
    setStatus: vi.fn(async () => ({})),
    setRole: vi.fn(async () => ({})),
    setBonusRuns: vi.fn(async () => ({})),
    ...overrides.accounts,
  };
  const codes = { disable: vi.fn(async () => ({})), ...overrides.codes };
  const providers = new AdminProviders(
    counts as unknown as CreationCounts,
    usage as unknown as UsageTotals,
    accounts as unknown as AccountsService,
    codes as unknown as CodesService,
  );
  return { counts, usage, accounts, codes, providers };
}

const ctx = (changes: Record<string, unknown>, current: Record<string, unknown> = {}): AdminHookContext => ({
  model: 'user',
  id: ID,
  current: current as never,
  changes: changes as never,
  actor: ADMIN,
});

describe('user.creations (compute)', () => {
  it('returns the three creation counts and tokens as the sum of input, output, and embedding', async () => {
    const { providers, counts, usage } = fakes();
    const values = await providers.compute['user.creations']!({ id: ID, values: {} });
    expect(counts.creationCountsFor).toHaveBeenCalledWith([ID]);
    expect(usage.usageTotalsFor).toHaveBeenCalledWith([ID]);
    expect(values).toEqual({ uploadsThisMonth: 2, promptsThisMonth: 1, creationsLastHour: 3, tokensThisMonth: 125 });
  });

  it('a user without data has zeros, not null', async () => {
    const { providers } = fakes({
      counts: { creationCountsFor: vi.fn(async () => new Map()) },
      usage: { usageTotalsFor: vi.fn(async () => new Map()) },
    });
    expect(await providers.compute['user.creations']!({ id: ID, values: {} })).toEqual({
      uploadsThisMonth: 0,
      promptsThisMonth: 0,
      creationsLastHour: 0,
      tokensThisMonth: 0,
    });
  });

  it('when only one service throws, the other fields are still filled', async () => {
    const down = vi.fn(async () => {
      throw new GraphUnavailableError('down');
    });
    const a = fakes({ counts: { creationCountsFor: down } });
    expect(await a.providers.compute['user.creations']!({ id: ID, values: {} })).toEqual({
      uploadsThisMonth: null,
      promptsThisMonth: null,
      creationsLastHour: null,
      tokensThisMonth: 125,
    });
    const b = fakes({ usage: { usageTotalsFor: down } });
    expect(await b.providers.compute['user.creations']!({ id: ID, values: {} })).toEqual({
      uploadsThisMonth: 2,
      promptsThisMonth: 1,
      creationsLastHour: 3,
      tokensThisMonth: null,
    });
  });
});

describe('AdminService and providers', () => {
  const userRow = {
    id: ID,
    email: 'a@example.test',
    display_name: 'A',
    role: 'learner',
    status: 'active',
    created_at: new Date(0),
    last_seen_at: null,
    bonus_source_runs: 0,
    bonus_prompt_runs: 0,
    limits_lifted_until: null,
  };

  function service(providers: AdminProviders, sqlRows: Record<string, unknown>[][]) {
    const sql = createRecordingSqlPort(sqlRows);
    const graph = createRecordingGraphPort();
    const settings = { invalidate: vi.fn() };
    const admin = new AdminService({ graph, sql }, providers, settings as never);
    admin.onModuleInit();
    return { admin, sql, graph, settings };
  }

  it('merges provider values into the detail record for the computed keys only', async () => {
    const { providers } = fakes();
    (providers.compute as Record<string, unknown>)['user.creations'] = async () => ({ uploadsThisMonth: 9, role: 'admin', extra: 'x' });
    const { admin } = service(providers, [[userRow]]);
    const detail = await admin.get('user', ID);
    expect(detail.record.values.uploadsThisMonth).toBe(9);
    expect(detail.record.values.promptsThisMonth).toBeNull();
    expect(detail.record.values.role).toBe('learner');
    expect(detail.record.values).not.toHaveProperty('extra');
  });

  it('when creationCountsFor throws GraphUnavailableError the record still loads with null counts', async () => {
    const { providers } = fakes({
      counts: {
        creationCountsFor: vi.fn(async () => {
          throw new GraphUnavailableError('down');
        }),
      },
    });
    const { admin } = service(providers, [[userRow]]);
    const detail = await admin.get('user', ID);
    expect(detail.record.values).toMatchObject({
      email: 'a@example.test',
      uploadsThisMonth: null,
      promptsThisMonth: null,
      creationsLastHour: null,
      tokensThisMonth: 125,
    });
    expect(detail.actions).toEqual([{ field: 'status', value: 'blocked', label: 'Block' }]);
  });

  it('list responses never call a provider', async () => {
    const { providers, counts, usage } = fakes();
    const { admin } = service(providers, [[userRow], [{ total: 1 }]]);
    const list = await admin.list('user', {});
    expect(list.items[0]!.values).not.toHaveProperty('uploadsThisMonth');
    expect(counts.creationCountsFor).not.toHaveBeenCalled();
    expect(usage.usageTotalsFor).not.toHaveBeenCalled();
  });

  it('start-up fails with a readable message when a declared provider is not bound', () => {
    const { providers } = fakes();
    const unbound = Object.assign(Object.create(providers), { compute: {}, update: { 'user.account': providers.update['user.account'] } });
    const admin = new AdminService(
      { graph: createRecordingGraphPort(), sql: createRecordingSqlPort() },
      unbound,
      { invalidate: vi.fn() } as never,
    );
    expect(() => admin.onModuleInit()).toThrow(/user: compute provider "user.creations".*code\.disable|user: compute provider "user.creations"/s);
  });
});

describe('user.account (update provider)', () => {
  it('checks status and role before any write, then writes', async () => {
    const order: string[] = [];
    const { providers, accounts } = fakes({
      accounts: {
        assertCanChangeStatus: vi.fn(async () => void order.push('assertStatus')),
        assertCanChangeRole: vi.fn(async () => void order.push('assertRole')),
        setStatus: vi.fn(async () => void order.push('setStatus')),
        setRole: vi.fn(async () => void order.push('setRole')),
      },
    });
    const result = await providers.update['user.account']!(ctx({ status: 'blocked', role: 'reviewer' }));
    expect(result).toBeUndefined();
    expect(order).toEqual(['assertStatus', 'assertRole', 'setStatus', 'setRole']);
    expect(accounts.assertCanChangeStatus).toHaveBeenCalledWith(ADMIN, ID, 'blocked');
    expect(accounts.assertCanChangeRole).toHaveBeenCalledWith(ADMIN, ID, 'reviewer');
  });

  it('a refused status check is a field error on status, and nothing is written', async () => {
    const { providers, accounts } = fakes({
      accounts: {
        assertCanChangeStatus: vi.fn(async () => {
          throw new ConflictError('You cannot block your own account');
        }),
      },
    });
    const result = await providers.update['user.account']!(ctx({ status: 'blocked', role: 'reviewer', bonusSourceRuns: 5 }));
    expect(result).toEqual({ fields: { status: 'You cannot block your own account' } });
    expect(accounts.setStatus).not.toHaveBeenCalled();
    expect(accounts.setRole).not.toHaveBeenCalled();
    expect(accounts.setBonusRuns).not.toHaveBeenCalled();
  });

  it('a refused role check is a field error on role, and neither setter is called', async () => {
    const { providers, accounts } = fakes({
      accounts: {
        assertCanChangeRole: vi.fn(async () => {
          throw new ConflictError('At least one active admin must remain');
        }),
      },
    });
    const result = await providers.update['user.account']!(ctx({ status: 'active', role: 'learner' }));
    expect(result).toEqual({ fields: { role: 'At least one active admin must remain' } });
    expect(accounts.setStatus).not.toHaveBeenCalled();
    expect(accounts.setRole).not.toHaveBeenCalled();
  });

  it('both refusals are reported together', async () => {
    const refuse = (message: string) =>
      vi.fn(async () => {
        throw new ConflictError(message);
      });
    const { providers } = fakes({ accounts: { assertCanChangeStatus: refuse('s'), assertCanChangeRole: refuse('r') } });
    expect(await providers.update['user.account']!(ctx({ status: 'blocked', role: 'learner' }))).toEqual({
      fields: { status: 's', role: 'r' },
    });
  });

  it('calls only the checks for the fields present', async () => {
    const { providers, accounts } = fakes();
    await providers.update['user.account']!(ctx({ role: 'admin' }));
    expect(accounts.assertCanChangeStatus).not.toHaveBeenCalled();
    expect(accounts.setStatus).not.toHaveBeenCalled();
    expect(accounts.setRole).toHaveBeenCalledWith(ADMIN, ID, 'admin');
  });

  it('bonus runs go to setBonusRuns with only the kinds present', async () => {
    const { providers, accounts } = fakes();
    await providers.update['user.account']!(ctx({ bonusSourceRuns: 5 }));
    expect(accounts.setBonusRuns).toHaveBeenLastCalledWith(ADMIN, ID, { source: 5 });
    await providers.update['user.account']!(ctx({ bonusPromptRuns: 2 }));
    expect(accounts.setBonusRuns).toHaveBeenLastCalledWith(ADMIN, ID, { prompt: 2 });
    await providers.update['user.account']!(ctx({ bonusSourceRuns: 1, bonusPromptRuns: 0 }));
    expect(accounts.setBonusRuns).toHaveBeenLastCalledWith(ADMIN, ID, { source: 1, prompt: 0 });
    expect(accounts.assertCanChangeStatus).not.toHaveBeenCalled();
  });

  it('a refusal from setBonusRuns becomes a field error on that field', async () => {
    const { providers } = fakes({
      accounts: {
        setBonusRuns: vi.fn(async () => {
          throw new ValidationFailedError([{ path: 'prompt', message: 'must be an integer from 0 to 1000' }]);
        }),
      },
    });
    expect(await providers.update['user.account']!(ctx({ bonusPromptRuns: 2 }))).toEqual({
      fields: { bonusPromptRuns: 'must be an integer from 0 to 1000' },
    });
  });

  it('NotFoundError passes through', async () => {
    const { providers } = fakes({
      accounts: {
        assertCanChangeStatus: vi.fn(async () => {
          throw new NotFoundError('User');
        }),
      },
    });
    await expect(providers.update['user.account']!(ctx({ status: 'blocked' }))).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('code.disable (update provider)', () => {
  it('disabled: true calls disable(id)', async () => {
    const { providers, codes } = fakes();
    expect(await providers.update['code.disable']!(ctx({ disabled: true }, { disabled: false }))).toBeUndefined();
    expect(codes.disable).toHaveBeenCalledWith(ID);
  });

  it('disabled: false on a disabled code is a field error and calls nothing', async () => {
    const { providers, codes } = fakes();
    const result = await providers.update['code.disable']!(ctx({ disabled: false }, { disabled: true }));
    expect(result).toEqual({ fields: { disabled: expect.stringContaining('cannot be re-enabled') } });
    expect(codes.disable).not.toHaveBeenCalled();
  });

  it('disabled: false on a code that is not disabled calls nothing and is accepted', async () => {
    const { providers, codes } = fakes();
    expect(await providers.update['code.disable']!(ctx({ disabled: false }, { disabled: false }))).toBeUndefined();
    expect(codes.disable).not.toHaveBeenCalled();
  });
});
