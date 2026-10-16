// SC-P03: only packages/graph-kit touches the FalkorDB client.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageDir, '..', '..');
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.output',
  'coverage',
  '.turbo',
  '.vinxi',
]);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
// import ... from 'falkordb', import 'falkordb', require('falkordb'), import('falkordb'), also 'falkordb/...' subpaths.
const FALKORDB_IMPORT = /(?:from|import|require)\s*\(?\s*['"`]falkordb(?:\/[^'"`]*)?['"`]/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (SOURCE_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
}

describe('falkordb import boundary', () => {
  it('has no import or require of falkordb outside packages/graph-kit', () => {
    const files: string[] = [];
    for (const top of ['apps', 'packages']) {
      try {
        walk(join(repoRoot, top), files);
      } catch {
        // the folder does not exist yet
      }
    }
    const offenders = files
      .filter((file) => !file.startsWith(packageDir + '/'))
      .filter((file) => FALKORDB_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file));
    expect(
      offenders,
      `Files importing falkordb outside packages/graph-kit: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('recognises the import forms it is meant to catch', () => {
    for (const line of [
      "import { FalkorDB } from 'falkordb';",
      'import x from "falkordb"',
      "const f = require('falkordb')",
      "await import('falkordb')",
      "import 'falkordb/dist/x'",
    ]) {
      expect(FALKORDB_IMPORT.test(line)).toBe(true);
    }
    expect(FALKORDB_IMPORT.test("import { x } from './falkordb-helper'")).toBe(false);
    expect(FALKORDB_IMPORT.test("import { x } from '@coach/graph-kit'")).toBe(false);
  });
});
