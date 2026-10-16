import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Spec problem 6 (docs/review-feedback.md): the built API is CommonJS and loads @coach/graph-kit,
// @coach/agents, @coach/types, and @coach/admin-kit with require(). Those packages are ESM-only, so
// every entry point shares one module instance. This test loads the BUILT packages from apps/api in a
// plain node process (as `node dist/main.js` would) and checks identity across entry points.
// Needs `pnpm --filter "./packages/*" run build` first.

const apiRoot = resolve(__dirname, '..');
const script = resolve(apiRoot, 'test/support/module-identity.cjs');
const built = existsSync(resolve(apiRoot, '../../packages/agents/dist/llm/index.js'));

describe.skipIf(!built)('built workspace packages resolve to a single module format', () => {
  const output = built
    ? execFileSync(process.execPath, [script], { cwd: apiRoot, encoding: 'utf8' })
    : '{}';
  const result = JSON.parse(output) as {
    resolved: Record<string, string>;
    shared: { name: string; entries: string[]; identical: boolean }[];
    crossEntry: Record<string, boolean>;
  };

  it('resolves every entry to the ESM build', () => {
    for (const [entry, file] of Object.entries(result.resolved)) {
      expect(file, entry).toMatch(/\/dist\/.*\.js$/);
    }
  });

  it('shares every class exported by more than one entry point', () => {
    expect(result.shared.length).toBeGreaterThan(0);
    expect(result.shared.filter((item) => !item.identical)).toEqual([]);
  });

  it('keeps instanceof working across entry points', () => {
    expect(result.crossEntry).toEqual({
      providerErrorChain: true,
      stubChatSameClass: true,
      graphErrorChain: true,
    });
  });
});

describe('build prerequisite', () => {
  it('reports when the packages are not built (the checks above are then skipped)', () => {
    if (!built)
      console.warn('module-format.spec.ts skipped: run `pnpm --filter "./packages/*" run build`');
    expect(true).toBe(true);
  });
});
