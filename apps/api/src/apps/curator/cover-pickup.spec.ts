// CoverPickupService with in-memory fakes: what it decides (allowance, brief, source, claim, failure tags) and what it
// never does (create a source for a refused or blocked requester, run when the environment says test).
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskPatch, TaskStatusName } from '@coach/agents/curator';
import { AppError } from '../../common/errors/app-error';
import { CoverPickupService } from './cover-pickup.service';

interface Cover {
  id: string;
  status: TaskStatusName;
  error: string | null;
  requesterId: string | null;
  sourceId: string | null;
  conceptIds: string[];
}

const cover = (id: string, patch: Partial<Cover> = {}): Cover => ({
  id,
  status: 'queued',
  error: null,
  requesterId: 'learner-1',
  sourceId: null,
  conceptIds: ['c1', 'c2'],
  ...patch,
});

const CONCEPTS = [
  { id: 'c1', name: 'B-tree indexes', description: 'A balanced tree that keeps keys sorted.' },
  {
    id: 'c2',
    name: 'Write-ahead logging',
    description: 'Changes are logged before pages are written.',
  },
];

function harness(
  initial: Cover[],
  options: { nodeEnv?: 'test' | 'development'; poll?: number } = {},
) {
  const tasks = new Map(initial.map((t) => [t.id, t]));
  const state = {
    blocked: new Set<string>(),
    refusal: null as AppError | null,
    createSourceFails: false,
    retryHook: null as ((id: string) => void) | null,
  };
  const calls = {
    begin: [] as Array<{ user: unknown; kind: string }>,
    confirm: 0,
    refund: 0,
    sources: [] as Array<Record<string, unknown>>,
    links: [] as Array<Record<string, unknown>>,
    started: [] as string[],
  };
  const graph = {
    openCoverTasks: async (statuses: string[]) =>
      [...tasks.values()].filter((t) => statuses.includes(t.status)),
    coverConcepts: async (ids: string[]) => CONCEPTS.filter((c) => ids.includes(c.id)),
    createSource: async (input: Record<string, unknown>) => {
      if (state.createSourceFails) throw new Error('graph down: secret text');
      calls.sources.push(input);
      return true;
    },
    linkCoverTaskToSource: async (
      input: { taskId: string; sourceId: string } & Record<string, unknown>,
    ) => {
      calls.links.push(input);
      tasks.get(input.taskId)!.sourceId = input.sourceId;
      return true;
    },
  };
  const recorder = {
    setTaskStatus: async (id: string, expected: readonly TaskStatusName[], patch: TaskPatch) => {
      const t = tasks.get(id);
      if (!t || !expected.includes(t.status)) return false;
      if (patch.status !== undefined) t.status = patch.status;
      if (patch.error !== undefined) t.error = patch.error;
      return true;
    },
  };
  const orchestrator = {
    start: (id: string) => calls.started.push(id),
    onCoverRetry: (hook: (id: string) => void) => (state.retryHook = hook),
  };
  const accounts = {
    isActive: async (id: string) => !state.blocked.has(id),
    me: async (id: string) => ({ id, role: 'learner' }),
  };
  const allowance = {
    begin: async (user: unknown, kind: string) => {
      calls.begin.push({ user, kind });
      if (state.refusal) throw state.refusal;
      return {
        kind,
        via: 'allowance',
        confirm: () => (calls.confirm += 1),
        refund: async () => {
          calls.refund += 1;
        },
      };
    },
  };
  const service = new CoverPickupService(
    graph as never,
    recorder as never,
    orchestrator as never,
    accounts as never,
    allowance as never,
    { now: () => new Date(5_000) },
    { NODE_ENV: options.nodeEnv ?? 'test', COVER_POLL_SECONDS: options.poll ?? 30 },
  );
  return { service, tasks, state, calls };
}

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('pick-up of a queued cover task', () => {
  it('asks the prompt allowance, stores the brief as a prompt source owned by the requester, claims, and runs', async () => {
    const h = harness([cover('t1')]);
    expect(await h.service.runOnce()).toBe(1);

    expect(h.calls.begin).toEqual([{ user: { id: 'learner-1', role: 'learner' }, kind: 'prompt' }]);
    expect(h.calls.sources).toHaveLength(1);
    const source = h.calls.sources[0]!;
    expect(source).toMatchObject({
      ownerId: 'learner-1',
      kind: 'prompt',
      content: null,
      fingerprint: null,
    });
    const brief = JSON.parse(source.brief as string);
    expect(brief).toMatchObject({ difficulty: 'medium', sentences: 4 });
    expect(brief.subject).toBe('B-tree indexes, Write-ahead logging');
    expect(h.calls.links).toEqual([expect.objectContaining({ taskId: 't1', sourceId: source.id })]);
    expect(h.tasks.get('t1')!.status).toBe('in_progress');
    expect(h.calls.started).toEqual(['t1']);
    expect(h.calls.confirm).toBe(1);
    expect(h.calls.refund).toBe(0);
  });

  it('refunds the grant and fails the task when the source write fails, without leaking the message', async () => {
    const h = harness([cover('t1')]);
    h.state.createSourceFails = true;
    await h.service.runOnce();
    expect(h.calls.confirm).toBe(0);
    expect(h.calls.refund).toBe(1);
    expect(h.tasks.get('t1')!.status).toBe('failed');
    expect(h.tasks.get('t1')!.error).not.toContain('secret');
    expect(h.calls.started).toEqual([]);
    for (const call of vi.mocked(Logger.prototype.error).mock.calls)
      expect(String(call[0])).not.toContain('secret');
  });

  it.each([
    ['CREATION_LIMIT_REACHED', 429],
    ['CREATION_PAUSED', 503],
  ] as const)(
    'marks the task failed with %s and creates no source when begin refuses',
    async (code, status) => {
      const h = harness([cover('t1')]);
      h.state.refusal = new AppError(code, 'refused', status);
      await h.service.runOnce();
      expect(h.tasks.get('t1')).toMatchObject({ status: 'failed' });
      expect(h.tasks.get('t1')!.error).toContain(code);
      expect(h.calls.sources).toEqual([]);
      expect(h.calls.started).toEqual([]);
    },
  );

  it('asks begin again when a refused task is retried through the same path', async () => {
    const h = harness([cover('t1')]);
    h.state.refusal = new AppError('CREATION_LIMIT_REACHED', 'refused', 429);
    await h.service.runOnce();
    expect(h.calls.begin).toHaveLength(1);

    // what RunOrchestrator.retry does for a cover task without a source: back to queued, then the registered hook
    h.state.refusal = null;
    h.tasks.get('t1')!.status = 'queued';
    h.tasks.get('t1')!.error = null;
    expect(h.state.retryHook).toBeTypeOf('function');
    h.state.retryHook!('t1');
    await h.service.whenIdle();
    expect(h.calls.begin).toHaveLength(2);
    expect(h.tasks.get('t1')!.status).toBe('in_progress');
    expect(h.calls.started).toEqual(['t1']);
  });

  it("fails a blocked requester's task with ACCOUNT_BLOCKED and asks nothing", async () => {
    const h = harness([cover('t1')]);
    h.state.blocked.add('learner-1');
    await h.service.runOnce();
    expect(h.tasks.get('t1')!.status).toBe('failed');
    expect(h.tasks.get('t1')!.error).toContain('ACCOUNT_BLOCKED');
    expect(h.calls.begin).toEqual([]);
    expect(h.calls.sources).toEqual([]);
  });

  it('does not ask the allowance again for a task whose source was already linked', async () => {
    const h = harness([cover('t1', { sourceId: 'src-1' })]);
    await h.service.runOnce();
    expect(h.calls.begin).toEqual([]);
    expect(h.calls.sources).toEqual([]);
    expect(h.calls.started).toEqual(['t1']);
  });

  it('fails a task with no concepts as INCONSISTENT_STATE', async () => {
    const h = harness([cover('t1', { conceptIds: [] })]);
    await h.service.runOnce();
    expect(h.tasks.get('t1')!.error).toContain('INCONSISTENT_STATE');
    expect(h.calls.begin).toEqual([]);
  });
});

describe('start-up resume', () => {
  it('restarts in_progress cover tasks only when asked to, and fails a blocked requester', async () => {
    const h = harness([
      cover('open', { status: 'in_progress', sourceId: 'src-open' }),
      cover('blocked', { status: 'in_progress', sourceId: 'src-b', requesterId: 'learner-2' }),
    ]);
    h.state.blocked.add('learner-2');
    await h.service.runOnce();
    expect(h.calls.started).toEqual([]);
    await h.service.runOnce({ resume: true });
    expect(h.calls.started).toEqual(['open']);
    expect(h.tasks.get('blocked')).toMatchObject({ status: 'failed' });
    expect(h.tasks.get('blocked')!.error).toContain('ACCOUNT_BLOCKED');
  });
});

describe('the poller', () => {
  it('is inert when NODE_ENV is test, and when COVER_POLL_SECONDS is 0', async () => {
    vi.useFakeTimers();
    try {
      for (const options of [
        { nodeEnv: 'test' as const },
        { nodeEnv: 'development' as const, poll: 0 },
      ]) {
        const h = harness([cover('t1')], options);
        h.service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(120_000);
        expect(h.calls.begin).toEqual([]);
        h.service.onModuleDestroy();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls every COVER_POLL_SECONDS outside tests and stops on module destroy', async () => {
    vi.useFakeTimers();
    try {
      const h = harness([cover('t1')], { nodeEnv: 'development', poll: 30 });
      h.service.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(0);
      expect(h.calls.begin).toHaveLength(1);
      h.tasks.set('t2', cover('t2'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(h.calls.begin).toHaveLength(2);
      h.service.onModuleDestroy();
      h.tasks.set('t3', cover('t3'));
      await vi.advanceTimersByTimeAsync(120_000);
      expect(h.calls.begin).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
