// Vitest globalSetup: deletes leftover graphs whose name starts with 'test_'. Never touches other graphs.
import { GraphKit } from '../client';
import { GraphUnavailableError } from '../errors';
import { TEST_GRAPH_PREFIX, falkorConnectionFromEnv } from './harness';

/** Deletes every graph whose name starts with `prefix` (default `test_`). Returns the deleted names. */
export async function deleteLeftoverGraphs(prefix = TEST_GRAPH_PREFIX): Promise<string[]> {
  const connection = falkorConnectionFromEnv();
  const admin = await GraphKit.create({
    ...connection,
    graphName: `${TEST_GRAPH_PREFIX}global_setup`,
  });
  const deleted: string[] = [];
  try {
    for (const name of await admin.listGraphs()) {
      if (!name.startsWith(prefix)) continue;
      await admin.deleteGraphNamed(name);
      deleted.push(name);
    }
    return deleted;
  } finally {
    await admin.close();
  }
}

export default async function globalSetup(): Promise<void> {
  try {
    await deleteLeftoverGraphs();
  } catch (error) {
    // The first test reports the unreachable server with an actionable message; do not hide it behind this one.
    if (!(error instanceof GraphUnavailableError)) throw error;
  }
}
