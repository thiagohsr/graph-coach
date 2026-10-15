import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  chunkId,
  conceptId,
  ingestTaskId,
  puzzleIdForSource,
  questionId,
  sourceId,
  stepId,
} from '@coach/agents/curator';
import { deterministicId } from '@coach/graph-kit';
import type { GraphKit } from '@coach/graph-kit';
import { TaskReadQueries } from './tasks.queries';

describe('ids of the agents package agree with @coach/graph-kit', () => {
  it('build every id with the same deterministicId', () => {
    expect(sourceId('owner', 'fp')).toBe(deterministicId('source', 'owner', 'fp'));
    expect(ingestTaskId('s1')).toBe(deterministicId('task', 'ingest', 's1'));
    expect(chunkId('s1', 3)).toBe(deterministicId('chunk', 's1', '3'));
    expect(conceptId('b-tree')).toBe(deterministicId('concept', 'b-tree'));
    expect(puzzleIdForSource('s1')).toBe(deterministicId('puzzle', 's1'));
    expect(questionId('c1', '  An ___ Helps ', ['x', 'y'])).toBe(
      deterministicId('question', 'c1', 'an ___ helps', 'x|y'),
    );
    expect(stepId('t1', 'embed', 2)).toBe(deterministicId('step', 't1', 'embed', '2'));
  });
});

describe('request-facing task reads', () => {
  it('refuse a missing, null, or empty caller id before anything is sent', async () => {
    const query = vi.fn(async () => []);
    const reads = new TaskReadQueries({ query } as unknown as GraphKit);
    for (const bad of [undefined, null, '', '  ']) {
      await expect(reads.getTask('t1', bad as never)).rejects.toThrow(/id of the calling user/);
      await expect(reads.taskSteps('t1', bad as never)).rejects.toThrow(/id of the calling user/);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('send only the task id and the caller id', async () => {
    const query = vi.fn(async () => []);
    const reads = new TaskReadQueries({ query } as unknown as GraphKit);
    await reads.getTask('t1', 'u1');
    await reads.taskSteps('t1', 'u1');
    expect(query).toHaveBeenNthCalledWith(1, 'get_task', { id: 't1', userId: 'u1' });
    expect(query).toHaveBeenNthCalledWith(2, 'task_steps', { taskId: 't1', userId: 'u1' });
  });
});

describe("the pipeline's internal reads never serve a request", () => {
  const dir = __dirname;
  const sources = (names: string[]) =>
    names.map((name) => [name, readFileSync(join(dir, name), 'utf8')] as const);
  const all = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'));

  it('no controller references loadTask, source_chunks, or the internal queries', () => {
    const controllers = all.filter((f) => f.endsWith('.controller.ts'));
    expect(controllers.length).toBeGreaterThan(0);
    for (const [name, text] of sources(controllers)) {
      expect(text, name).not.toMatch(
        /loadTask|load_task|source_chunks|sourceChunks|open_tasks|chunk_embeddings/,
      );
    }
  });

  it('the services that controllers call (sources, tasks) do not use loadTask either', () => {
    for (const [name, text] of sources([
      'sources.service.ts',
      'tasks.service.ts',
      'tasks.queries.ts',
    ])) {
      expect(text, name).not.toMatch(/loadTask|load_task/);
    }
  });
});
