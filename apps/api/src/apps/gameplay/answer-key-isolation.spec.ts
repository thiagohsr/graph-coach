// FR-G14: the answer-key query is reachable only from the gameplay module (constitution III).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..');
const GAMEPLAY = join(SRC, 'apps', 'gameplay') + sep;
const NAME = ['puzzle', 'answer', 'key'].join('_');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

describe('answer key isolation', () => {
  it('the puzzle_answer_key query name appears only under apps/gameplay', () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(10);
    const offenders = files
      .filter((file) => !file.startsWith(GAMEPLAY))
      .filter((file) => readFileSync(file, 'utf8').includes(NAME))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it('the gameplay module does use it (the scan is not vacuous)', () => {
    const used = walk(GAMEPLAY).some((file) => readFileSync(file, 'utf8').includes(NAME));
    expect(used).toBe(true);
  });
});
