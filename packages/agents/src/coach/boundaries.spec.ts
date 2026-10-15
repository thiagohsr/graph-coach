// Boundary tests (T066): the Coach folder stays independent of the Curator and the database driver, its queries are
// named files with the 004 header and no string building, and it reads only its five settings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CoachSettingsSchema } from './settings';

const COACH_DIR = fileURLToPath(new URL('.', import.meta.url));
const QUERIES_DIR = fileURLToPath(new URL('../../../graph-kit/queries/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const production = sourceFiles(COACH_DIR).filter((f) => !f.endsWith('.spec.ts') && !f.includes('/testing/'));
const everything = sourceFiles(COACH_DIR).filter((f) => !f.endsWith('boundaries.spec.ts'));

describe('coach folder imports', () => {
  it('has files to check', () => {
    expect(production.length).toBeGreaterThan(10);
  });

  it('never imports from the curator or from falkordb (production and test files)', () => {
    const offenders = everything.filter((file) => {
      const specifiers = [...readFileSync(file, 'utf8').matchAll(/(?:from|import|require\()\s*['"]([^'"]+)['"]/g)].map(
        (m) => m[1] ?? '',
      );
      return specifiers.some((s) => /(^|\/)curator(\/|$)/.test(s) || s === 'falkordb' || s.startsWith('falkordb/'));
    });
    expect(offenders).toEqual([]);
  });
});

describe('coach query files', () => {
  const queriesSource = readFileSync(join(COACH_DIR, 'queries.ts'), 'utf8');
  const names = [...new Set([...queriesSource.matchAll(/query\(\s*'([a-z_]+)'/g)].map((m) => m[1] as string))];

  it('finds the nine queries of CoachQueries', () => {
    expect(names.sort()).toEqual(
      [
        'concept_answer_evidence',
        'decayed_or_unseen_concepts',
        'decision_path',
        'get_decision',
        'intro_puzzles',
        'playable_puzzles_covering',
        'recent_decision',
        'record_decision',
        'weak_concepts_with_weak_prereqs',
      ].sort(),
    );
  });

  it.each(names)('%s.cypher has name, owner 004, and a mode header', (name) => {
    const text = readFileSync(join(QUERIES_DIR, `${name}.cypher`), 'utf8');
    expect(text).toMatch(new RegExp(`^// name: ${name}$`, 'm'));
    expect(text).toMatch(/^\/\/ owner: 004$/m);
    expect(text).toMatch(/^\/\/ mode: (read|write)$/m);
  });

  it.each(names)('%s.cypher builds no text from values', (name) => {
    const body = readFileSync(join(QUERIES_DIR, `${name}.cypher`), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//'))
      .join('\n');
    expect(body).not.toContain('${');
    // No parameter is ever joined into text with `+` (decision_path builds a display reason from row values, which is fine).
    expect(body).not.toMatch(/\$\w+\s*\+|\+\s*\$\w+/);
  });
});

describe('coach settings', () => {
  const FIVE = ['traversalDepth', 'decayDays', 'riskThreshold', 'recentPlayDays', 'coachReuseMinutes'];

  it('the schema has exactly the five keys', () => {
    expect(Object.keys(CoachSettingsSchema.shape).sort()).toEqual([...FIVE].sort());
  });

  it('no production file reads another key from settings', () => {
    const read = new Set<string>();
    for (const file of production) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bsettings\.(\w+)/g)) read.add(m[1] as string);
      for (const m of text.matchAll(/\{([^{}]*)\}\s*=\s*(?:deps\.)?settings\b/g)) {
        for (const part of (m[1] ?? '').split(',')) {
          const key = part.split(':')[0]?.trim();
          if (key) read.add(key);
        }
      }
    }
    expect([...read].filter((key) => !FIVE.includes(key))).toEqual([]);
  });
});
