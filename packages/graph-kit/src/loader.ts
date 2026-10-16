// Reads the named-query files (contracts/internal-interfaces.md §2.4). No server access here.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphKitError } from './errors';

export interface LoadedQuery {
  name: string;
  owner: string;
  mode: 'read' | 'write';
  /** Parameter names (without `$`), in order of first use. */
  params: string[];
  source: 'file' | 'generated';
  file?: string;
  /** The statement sent to the server: header lines and a trailing `;` removed, nothing else changed. */
  text: string;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const HEADER_LINE = /^\/\/\s*([a-z]+)\s*:\s*(.*?)\s*$/;
const KNOWN_HEADERS = new Set(['name', 'owner', 'mode', 'params', 'returns']);

interface Scan {
  params: string[];
  /** Offsets of `;` outside strings and comments. */
  semicolons: number[];
  /** True when something other than whitespace and comments is present. */
  hasCode: boolean;
}

/** Finds `$identifier` tokens and `;` outside comments, string literals, and backtick-quoted names. */
export function scanStatement(text: string): Scan {
  const params: string[] = [];
  const semicolons: number[] = [];
  let hasCode = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      hasCode = true;
      i += 1;
      while (i < text.length && text[i] !== ch) i += text[i] === '\\' && ch !== '`' ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === '$') {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i + 1));
      if (match) {
        hasCode = true;
        if (!params.includes(match[0])) params.push(match[0]);
        i += 1 + match[0].length;
        continue;
      }
    }
    if (ch === ';') semicolons.push(i);
    else if (!/\s/.test(ch)) hasCode = true;
    i += 1;
  }
  return { params, semicolons, hasCode };
}

/**
 * Checks one statement and returns it without a trailing `;`.
 * `where` names the file (or the generated query) in error messages.
 */
export function prepareStatement(
  text: string,
  where: string,
  name: string,
): { text: string; params: string[] } {
  const scan = scanStatement(text);
  if (!scan.hasCode) {
    throw new GraphKitError('INVALID_QUERY_FILE', `${where}: the statement is empty`, {
      queryName: name,
    });
  }
  let body = text.trim();
  const last = scan.semicolons[scan.semicolons.length - 1];
  if (
    last !== undefined &&
    text
      .slice(last + 1)
      .replace(/\/\/[^\n]*/g, '')
      .trim() === ''
  ) {
    body = text.slice(0, last).trim();
    scan.semicolons.pop();
  }
  if (scan.semicolons.length > 0) {
    throw new GraphKitError(
      'INVALID_QUERY_FILE',
      `${where}: more than one statement (one statement per file)`,
      {
        queryName: name,
      },
    );
  }
  return { text: body, params: scan.params };
}

/** Parses one query file's text. Throws INVALID_QUERY_FILE naming the file and the rule. */
export function parseQueryFile(fileName: string, content: string): LoadedQuery {
  const fileStem = basename(fileName).replace(/\.cypher$/, '');
  const fail = (rule: string): never => {
    throw new GraphKitError('INVALID_QUERY_FILE', `${fileName}: ${rule}`, { queryName: fileStem });
  };

  const lines = content.replace(/^﻿/, '').split(/\r?\n/);
  const headers = new Map<string, string>();
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line === '') continue;
    if (!line.startsWith('//')) break;
    const match = HEADER_LINE.exec(line);
    if (match && KNOWN_HEADERS.has(match[1]!)) headers.set(match[1]!, match[2]!);
  }

  const name = headers.get('name');
  if (!name) fail('missing header "// name:"');
  if (name !== fileStem) fail(`header name "${name}" does not match the file name`);
  if (!NAME_PATTERN.test(fileStem)) fail('the name must be lower snake case');
  const owner = headers.get('owner');
  if (!owner) fail('missing header "// owner:"');
  const mode = headers.get('mode');
  if (!mode) fail('missing header "// mode:"');
  if (mode !== 'read' && mode !== 'write') fail('mode must be "read" or "write"');

  const statement = lines.slice(index).join('\n');
  const prepared = prepareStatement(statement, fileName, fileStem);
  return {
    name: fileStem,
    owner: owner!,
    mode: mode as 'read' | 'write',
    params: prepared.params,
    source: 'file',
    file: fileName,
    text: prepared.text,
  };
}

/** Loads every `*.cypher` directly under `dir` (subfolders such as `setup/` are not read). */
export function loadQueryDir(dir: string): Map<string, LoadedQuery> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new GraphKitError('INVALID_QUERY_FILE', `Queries directory not found: ${dir}`);
  }
  const queries = new Map<string, LoadedQuery>();
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isFile() || !entry.name.endsWith('.cypher')) continue;
    const query = parseQueryFile(entry.name, readFileSync(join(dir, entry.name), 'utf8'));
    queries.set(query.name, query);
  }
  return queries;
}

/** The package's own `queries/` directory: the nearest package.json upwards from this file, then `queries/`. */
export function defaultQueriesDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return join(dir, 'queries');
    dir = dirname(dir);
  }
  throw new GraphKitError(
    'INVALID_QUERY_FILE',
    'Cannot locate the queries directory of @coach/graph-kit',
  );
}
