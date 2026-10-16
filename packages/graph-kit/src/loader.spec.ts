import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GraphKitError } from './errors';
import { loadQueryDir } from './loader';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graph-kit-loader-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const write = (file: string, text: string) => writeFileSync(join(dir, file), text);

const header = (name: string, extra = '') =>
  `// name: ${name}\n// owner: 002\n// mode: read\n${extra}`;

function loadError(): GraphKitError {
  try {
    loadQueryDir(dir);
  } catch (error) {
    expect(error).toBeInstanceOf(GraphKitError);
    return error as GraphKitError;
  }
  throw new Error('expected loadQueryDir to throw');
}

describe('loadQueryDir', () => {
  it('yields name, owner, mode, and parameter names for a valid file', () => {
    write(
      'demo_concepts.cypher',
      `${header('demo_concepts', '// params: $max (integer)\n// returns: id, score\n')}` +
        'MATCH (c:Concept) WHERE c.score < $max AND c.id <> $skip\nRETURN c.id AS id, c.score AS score',
    );
    const queries = loadQueryDir(dir);
    expect([...queries.keys()]).toEqual(['demo_concepts']);
    const q = queries.get('demo_concepts')!;
    expect(q.name).toBe('demo_concepts');
    expect(q.owner).toBe('002');
    expect(q.mode).toBe('read');
    expect(q.params).toEqual(['max', 'skip']);
    expect(q.file).toBe('demo_concepts.cypher');
    expect(q.text.startsWith('MATCH (c:Concept)')).toBe(true);
  });

  it('does not count $x inside a comment or a quoted string as a parameter', () => {
    write(
      'demo_strings.cypher',
      header('demo_strings') +
        '// a note about $hidden\nMATCH (n) // trailing $alsoHidden\nWHERE n.a = \'cost is $5 and $x\' AND n.b = "say $y" AND n.c = $real\nRETURN n',
    );
    expect(loadQueryDir(dir).get('demo_strings')!.params).toEqual(['real']);
  });

  it('lists each parameter once', () => {
    write('demo_dup.cypher', header('demo_dup') + 'RETURN $a AS x, $a AS y, $b AS z');
    expect(loadQueryDir(dir).get('demo_dup')!.params).toEqual(['a', 'b']);
  });

  it('ignores files under setup/ and files that are not .cypher', () => {
    mkdirSync(join(dir, 'setup'));
    writeFileSync(join(dir, 'setup', '010_broken.cypher'), 'this is not a query');
    write('notes.txt', 'nothing');
    expect(loadQueryDir(dir).size).toBe(0);
  });

  it('rejects a header name that differs from the file name, naming the file', () => {
    write('demo_a.cypher', header('demo_b') + 'RETURN 1 AS one');
    const error = loadError();
    expect(error.code).toBe('INVALID_QUERY_FILE');
    expect(error.message).toContain('demo_a.cypher');
  });

  it('rejects a file without mode', () => {
    write('demo_nomode.cypher', '// name: demo_nomode\n// owner: 002\nRETURN 1 AS one');
    const error = loadError();
    expect(error.code).toBe('INVALID_QUERY_FILE');
    expect(error.message).toContain('demo_nomode.cypher');
    expect(error.message).toContain('mode');
  });

  it('rejects a file without owner', () => {
    write('demo_noowner.cypher', '// name: demo_noowner\n// mode: read\nRETURN 1 AS one');
    expect(loadError().code).toBe('INVALID_QUERY_FILE');
  });

  it('rejects a mode other than read or write', () => {
    write('demo_badmode.cypher', '// name: demo_badmode\n// owner: 002\n// mode: rw\nRETURN 1');
    expect(loadError().code).toBe('INVALID_QUERY_FILE');
  });

  it('rejects an empty statement', () => {
    write('demo_empty.cypher', header('demo_empty') + '// only comments follow\n   \n');
    const error = loadError();
    expect(error.code).toBe('INVALID_QUERY_FILE');
    expect(error.message).toContain('demo_empty.cypher');
  });

  it('rejects more than one statement in a file', () => {
    write('demo_two.cypher', header('demo_two') + 'RETURN 1 AS a; RETURN 2 AS b');
    expect(loadError().code).toBe('INVALID_QUERY_FILE');
  });

  it('accepts one trailing semicolon and does not send it', () => {
    write('demo_semi.cypher', header('demo_semi') + 'RETURN 1 AS a;\n');
    expect(loadQueryDir(dir).get('demo_semi')!.text).toBe('RETURN 1 AS a');
  });

  it('treats a semicolon inside a string as text', () => {
    write('demo_semi_text.cypher', header('demo_semi_text') + "RETURN 'a;b' AS a");
    expect(loadQueryDir(dir).get('demo_semi_text')!.text).toBe("RETURN 'a;b' AS a");
  });

  it('returns an empty map for a directory with no queries and throws for a missing directory', () => {
    expect(loadQueryDir(dir).size).toBe(0);
    expect(() => loadQueryDir(join(dir, 'nope'))).toThrowError(GraphKitError);
  });
});
