// Reads and parses the seed/ directory (contracts/internal-interfaces.md §2.9).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  SeedConcept,
  SeedPuzzle,
  SeedScenario,
  SeedSource,
  SeedUser,
  type SeedData,
  type SeedIssue,
} from './schema';

export class SeedReadError extends Error {
  readonly issues: SeedIssue[];

  constructor(issues: SeedIssue[]) {
    super(
      `Seed files could not be read (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((i) => `  ${i.file} ${i.path}: ${i.message}`).join('\n'),
    );
    this.name = 'SeedReadError';
    this.issues = issues;
  }
}

/** The `seed/` directory next to the nearest `pnpm-workspace.yaml` above this file (or the working directory). */
export function defaultSeedDir(): string {
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let dir = start;
    for (let depth = 0; depth < 12; depth += 1) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, 'seed');
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new SeedReadError([
    {
      file: 'seed',
      path: '',
      message: 'cannot locate pnpm-workspace.yaml above this package; pass a directory',
    },
  ]);
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '').length;
}

function zodIssues(file: string, error: z.ZodError): SeedIssue[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Reads and parses seed/ (default: <repo root>/seed). Throws SeedReadError with all issues if parsing fails. */
export async function readSeedDir(dir: string = defaultSeedDir()): Promise<SeedData> {
  const issues: SeedIssue[] = [];

  const readJson = <T>(relative: string, schema: z.ZodType<T>): T | undefined => {
    const path = join(dir, relative);
    if (!existsSync(path)) {
      issues.push({ file: relative, path: '', message: 'file not found' });
      return undefined;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      issues.push({
        file: relative,
        path: '',
        message: `invalid JSON: ${(error as Error).message}`,
      });
      return undefined;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      issues.push(...zodIssues(relative, parsed.error));
      return undefined;
    }
    return parsed.data;
  };

  const concepts = readJson('concepts.json', z.array(SeedConcept));
  const users = readJson('users.json', z.array(SeedUser));
  const scenario = readJson('scenario.json', SeedScenario);
  const sources = readJson('sources/index.json', z.array(SeedSource));

  const puzzles: z.infer<typeof SeedPuzzle>[] = [];
  const puzzleDir = join(dir, 'puzzles');
  if (!existsSync(puzzleDir)) {
    issues.push({ file: 'puzzles', path: '', message: 'directory not found' });
  } else {
    const files = readdirSync(puzzleDir)
      .filter((f) => f.endsWith('.json'))
      .sort();
    for (const file of files) {
      const puzzle = readJson(`puzzles/${file}`, SeedPuzzle);
      if (puzzle) puzzles.push(puzzle);
    }
  }

  if (sources) {
    for (const source of sources) {
      const path = join(dir, 'sources', source.file);
      if (existsSync(path)) source.actualWords = countWords(readFileSync(path, 'utf8'));
    }
  }

  if (issues.length > 0 || !concepts || !users || !scenario || !sources) {
    throw new SeedReadError(issues);
  }
  return { concepts, puzzles, users, scenario, sources };
}
