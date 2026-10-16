import { afterAll, describe, expect, it, vi } from 'vitest';
import { GraphKit, GraphKitError } from '../src/index';
import { falkorConnectionFromEnv } from '../src/testing';

// `GraphKit.execute` treats exactly one server error as "no rows": a read-only query on a graph key that does not exist.
const EMPTY_KEY = 'Invalid graph operation on empty key';

const kits: GraphKit[] = [];

async function kitFailingWith(message: string): Promise<GraphKit> {
  const kit = await GraphKit.create({
    ...falkorConnectionFromEnv(),
    graphName: 'test_empty_key_mock',
  });
  kits.push(kit);
  const fail = () => Promise.reject(new Error(message));
  vi.spyOn(kit as unknown as { selectGraph: () => unknown }, 'selectGraph').mockResolvedValue({
    db: {},
    graph: { roQuery: fail, query: fail },
  });
  return kit;
}

afterAll(async () => {
  await Promise.all(kits.map((k) => k.close()));
});

describe('execute: the empty-key branch', () => {
  it('a real read-only query on a graph that does not exist returns no rows', async () => {
    const kit = await GraphKit.create({
      ...falkorConnectionFromEnv(),
      graphName: `test_empty_key_${process.pid}_missing`,
    });
    kits.push(kit);
    await kit.deleteGraph();
    const result = await kit.execute('MATCH (n) RETURN n', {}, { readOnly: true });
    expect(result.rows).toEqual([]);
  });

  it('read-only + exactly that error returns no rows', async () => {
    const kit = await kitFailingWith(EMPTY_KEY);
    await expect(kit.execute('MATCH (n) RETURN n', {}, { readOnly: true })).resolves.toMatchObject({
      rows: [],
    });
  });

  it('read-only + any other error still surfaces', async () => {
    for (const message of [
      'Query timed out',
      'Type mismatch: expected Integer',
      `${EMPTY_KEY} and then some`,
      `Something else: ${EMPTY_KEY}`,
      'Invalid graph operation',
    ]) {
      const kit = await kitFailingWith(message);
      const error = await kit.execute('MATCH (n) RETURN n', {}, { readOnly: true }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error, message).toBeInstanceOf(GraphKitError);
    }
  });

  it('a write query with that error still surfaces', async () => {
    const kit = await kitFailingWith(EMPTY_KEY);
    const error = await kit.execute('CREATE (:X)', {}, {}).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GraphKitError);
    expect((error as GraphKitError).code).toBe('QUERY_FAILED');
    const explicit = await kit.execute('CREATE (:X)', {}, { readOnly: false }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(explicit).toBeInstanceOf(GraphKitError);
  });
});
