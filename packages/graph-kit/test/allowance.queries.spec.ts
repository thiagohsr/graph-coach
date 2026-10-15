// Named queries owned by 002 for the allowance and the admin: 'creation_counts' and 'usage_totals'.
import { beforeAll, describe, expect, it } from 'vitest';
import { creationCountsQuery, usageTotalsQuery } from '../src/queries/platform';
import { useTestGraph } from '../src/testing/harness';

const graph = useTestGraph();

/** The server does not promise the order of rows after an aggregation: compare by user id. */
const byUser = <T extends { userId: string }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.userId.localeCompare(b.userId));

const MONTH_START = Date.UTC(2026, 9, 1); // 2026-10-01T00:00:00Z
const NOW = Date.UTC(2026, 9, 15, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 3_600_000;

const BUSY = 'user-busy';
const NEARBOUNDARY = 'user-boundary';
const EMPTY = 'user-empty';
const NO_NODE = 'user-without-a-node';

let sequence = 0;
async function addSource(owner: string, kind: string, createdAt: number): Promise<void> {
  sequence += 1;
  await graph().cypher(
    `MATCH (l:Learner {id: $owner})
     CREATE (l)-[:OWNS]->(:Source {id: $id, kind: $kind, title: 'x', createdAt: $createdAt})`,
    { owner, id: `src-${sequence}`, kind, createdAt },
  );
}

async function addLearner(id: string): Promise<void> {
  await graph().cypher('CREATE (:Learner {id: $id, displayName: $id, createdAt: 0})', { id });
}

describe('creation_counts', () => {
  beforeAll(async () => {
    for (const id of [BUSY, NEARBOUNDARY, EMPTY]) await addLearner(id);
    // BUSY: uploads of the three kinds, prompts, and sources outside the windows.
    await addSource(BUSY, 'text', NOW - 10 * MINUTE);
    await addSource(BUSY, 'markdown', NOW - 5 * HOUR);
    await addSource(BUSY, 'url', MONTH_START); // exactly at the month start: counts
    await addSource(BUSY, 'prompt', NOW - 10 * MINUTE);
    await addSource(BUSY, 'prompt', MONTH_START); // counts
    await addSource(BUSY, 'prompt', MONTH_START - 1); // one millisecond earlier: does not count
    await addSource(BUSY, 'text', Date.UTC(2026, 8, 15)); // last month: does not count
    // NEARBOUNDARY: one source ten minutes before the month start.
    await addSource(NEARBOUNDARY, 'text', MONTH_START - 10 * MINUTE);
  });

  const params = (now: number, userIds: string[]) => ({
    userIds,
    monthStart: MONTH_START,
    hourAgo: now - HOUR,
    since: Math.min(MONTH_START, now - HOUR),
  });

  it('counts uploads and prompts this month and both kinds in the last hour', async () => {
    const rows = await graph().graph.run(creationCountsQuery, params(NOW, [BUSY]));
    expect(rows).toEqual([
      { userId: BUSY, uploadsThisMonth: 3, promptsThisMonth: 2, creationsLastHour: 2 },
    ]);
  });

  it('includes a source created exactly at $monthStart and excludes one a millisecond earlier', async () => {
    // BUSY has an upload (url) and a prompt exactly at the boundary, and a prompt one millisecond before it.
    const [row] = await graph().graph.run(creationCountsQuery, params(NOW, [BUSY]));
    expect(row!.uploadsThisMonth).toBe(3); // text 10 min, markdown 5 h, url at the boundary
    expect(row!.promptsThisMonth).toBe(2); // prompt 10 min and prompt at the boundary, not the one at -1 ms
  });

  it('counts a source from last month in creationsLastHour only when the hour crosses the month boundary', async () => {
    const now = MONTH_START + 30 * MINUTE; // the hour window starts 30 minutes before the month
    const [row] = await graph().graph.run(creationCountsQuery, params(now, [NEARBOUNDARY]));
    expect(row).toEqual({ userId: NEARBOUNDARY, uploadsThisMonth: 0, promptsThisMonth: 0, creationsLastHour: 1 });
  });

  it('gives a row of zeros to a learner without sources and to an id with no Learner node', async () => {
    const rows = await graph().graph.run(creationCountsQuery, params(NOW, [EMPTY, NO_NODE]));
    expect(byUser(rows)).toEqual([
      { userId: EMPTY, uploadsThisMonth: 0, promptsThisMonth: 0, creationsLastHour: 0 },
      { userId: NO_NODE, uploadsThisMonth: 0, promptsThisMonth: 0, creationsLastHour: 0 },
    ]);
  });

  it('returns one row per requested id with only the documented columns', async () => {
    const rows = await graph().graph.query<{ userId: string }>('creation_counts', params(NOW, [NO_NODE, BUSY, EMPTY]));
    expect(rows.map((r) => r.userId).sort()).toEqual([BUSY, EMPTY, NO_NODE].sort());
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['creationsLastHour', 'promptsThisMonth', 'uploadsThisMonth', 'userId']);
    }
  });
});

describe('usage_totals', () => {
  const A = 'usage-both';
  const ONLY_DECISIONS = 'usage-decisions';
  const ONLY_TASKS = 'usage-tasks';
  const NONE = 'usage-none';
  let n = 0;

  async function addTask(owner: string, createdAt: number, usage?: [number, number, number, number]): Promise<void> {
    n += 1;
    await graph().cypher(
      `MATCH (l:Learner {id: $owner}) CREATE (l)-[:REQUESTED]->(:Task {id: $id, createdAt: $createdAt})`,
      { owner, id: `task-${n}`, createdAt },
    );
    if (usage) await setUsage(`task-${n}`, 'Task', usage);
  }

  async function addDecision(owner: string, createdAt: number, usage?: [number, number, number, number]): Promise<void> {
    n += 1;
    await graph().cypher(
      `MATCH (l:Learner {id: $owner}) CREATE (:Decision {id: $id, createdAt: $createdAt})-[:FOR]->(l)`,
      { owner, id: `decision-${n}`, createdAt },
    );
    if (usage) await setUsage(`decision-${n}`, 'Decision', usage);
  }

  async function setUsage(id: string, label: 'Task' | 'Decision', [calls, input, output, embedding]: [number, number, number, number]) {
    await graph().cypher(
      `MATCH (n:${label} {id: $id}) SET n.modelCalls = $calls, n.inputTokens = $input, n.outputTokens = $output, n.embeddingTokens = $embedding`,
      { id, calls, input, output, embedding },
    );
  }

  beforeAll(async () => {
    for (const id of [A, ONLY_DECISIONS, ONLY_TASKS, NONE]) await addLearner(id);
    // A: three tasks this month (one exactly at the boundary), one last month, one without usage;
    // three decisions this month, one last month, one without usage.
    await addTask(A, NOW - 2 * HOUR, [2, 100, 50, 10]);
    await addTask(A, NOW - 3 * HOUR, [1, 20, 10, 0]);
    await addTask(A, MONTH_START, [1, 1, 1, 1]);
    await addTask(A, MONTH_START - 1, [50, 5000, 5000, 5000]);
    await addTask(A, NOW - HOUR); // no usage properties
    await addDecision(A, NOW - HOUR, [1, 10, 5, 0]);
    await addDecision(A, NOW - 2 * HOUR, [1, 10, 5, 0]);
    await addDecision(A, NOW - 3 * HOUR, [1, 10, 5, 0]);
    await addDecision(A, MONTH_START - 1, [40, 4000, 4000, 4000]);
    await addDecision(A, NOW - 4 * HOUR); // no usage properties
    await addDecision(ONLY_DECISIONS, NOW - HOUR, [2, 5, 6, 7]);
    await addTask(ONLY_TASKS, NOW - HOUR, [3, 30, 20, 10]);
  });

  const call = (ids: string[]) => graph().graph.run(usageTotalsQuery, { userIds: ids, monthStart: MONTH_START });

  it('sums this month over tasks and decisions without double counting', async () => {
    const [row] = await call([A]);
    // tasks: (2+1+1, 100+20+1, 50+10+1, 10+0+1) = (4, 121, 61, 11); decisions: 3 x (1, 10, 5, 0)
    expect(row).toEqual({ userId: A, modelCalls: 7, inputTokens: 151, outputTokens: 76, embeddingTokens: 11 });
  });

  it('handles a user with only decisions and a user with only tasks', async () => {
    const rows = await call([ONLY_DECISIONS, ONLY_TASKS]);
    expect(byUser(rows)).toEqual([
      { userId: ONLY_DECISIONS, modelCalls: 2, inputTokens: 5, outputTokens: 6, embeddingTokens: 7 },
      { userId: ONLY_TASKS, modelCalls: 3, inputTokens: 30, outputTokens: 20, embeddingTokens: 10 },
    ]);
  });

  it('gives zeros to a user with neither and to an id with no Learner node', async () => {
    const rows = await call([NONE, NO_NODE]);
    const zero = { modelCalls: 0, inputTokens: 0, outputTokens: 0, embeddingTokens: 0 };
    expect(byUser(rows)).toEqual([
      { userId: NONE, ...zero },
      { userId: NO_NODE, ...zero },
    ]);
  });

  it('returns only the documented columns', async () => {
    const rows = await graph().graph.query('usage_totals', { userIds: [A, NONE], monthStart: MONTH_START });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['embeddingTokens', 'inputTokens', 'modelCalls', 'outputTokens', 'userId']);
    }
  });
});
