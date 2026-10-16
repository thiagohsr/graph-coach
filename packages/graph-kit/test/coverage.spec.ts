// SC-P02: every named query has a test. For each queries/<name>.cypher the quoted name appears in a test/*.queries.spec.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('query test coverage', () => {
  it('has a *.queries.spec.ts that names every queries/*.cypher', () => {
    const names = readdirSync(join(packageDir, 'queries'))
      .filter((f) => f.endsWith('.cypher'))
      .map((f) => f.replace(/\.cypher$/, ''))
      .sort();
    expect(names.length).toBeGreaterThan(0);

    const specs = readdirSync(join(packageDir, 'test'))
      .filter((f) => f.endsWith('.queries.spec.ts'))
      .map((f) => readFileSync(join(packageDir, 'test', f), 'utf8'));

    const untested = names.filter(
      (name) =>
        !specs.some((text) =>
          [`'${name}'`, `"${name}"`, `\`${name}\``].some((quoted) => text.includes(quoted)),
        ),
    );
    expect(
      untested,
      `Queries without a test (add the quoted name to a test/*.queries.spec.ts): ${untested.join(', ')}`,
    ).toEqual([]);
  });
});
