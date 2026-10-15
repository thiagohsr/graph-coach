import { describe, expect, it } from 'vitest';
import type { GraphKit } from '@coach/graph-kit';
import { PlayPuzzleDto, PlayQuestionDto, PuzzleSummaryDto } from '@coach/types';
import { NotFoundError } from '../../common/errors/app-error';
import { PuzzlesService } from './puzzles.service';

const FORBIDDEN = /answer|expected|correct|solution|distractor|key/i;

const SENTINEL = '__x';
function arrayPaths(schema: unknown, prefix = ''): string[] {
  // Collect "leaf or array-of-leaf" key paths, listing an array of objects as `name[].child`.
  const s = schema as { _def: { typeName: string; shape?: () => Record<string, unknown>; type?: unknown } };
  if (s._def.typeName === 'ZodObject') {
    return Object.entries(s._def.shape!()).flatMap(([k, v]) => {
      const inner = v as { _def: { typeName: string; type?: unknown } };
      if (inner._def.typeName === 'ZodArray') {
        const el = inner._def.type as { _def: { typeName: string } };
        if (el._def.typeName === 'ZodObject') return arrayPaths(el, `${prefix}${k}[].`);
      }
      return [`${prefix}${k}`];
    });
  }
  return [SENTINEL];
}

describe('PlayPuzzleDto', () => {
  it('has exactly the allowed key paths and no answer-like key', () => {
    const keys = arrayPaths(PlayPuzzleDto).sort();
    expect(keys).toEqual(
      ['id', 'name', 'origin', 'questions[].blanks', 'questions[].id', 'questions[].order', 'questions[].sentence', 'wordBank'].sort(),
    );
    for (const key of keys) expect(key).not.toMatch(FORBIDDEN);
  });

  it('throws when a question carries answers', () => {
    const body = {
      id: 'p',
      name: 'n',
      origin: 'seed',
      questions: [{ id: 'q', order: 1, sentence: 's ___', blanks: 1, answers: ['a'] }],
      wordBank: [],
    };
    expect(() => PlayPuzzleDto.parse(body)).toThrow();
    expect(() => PlayQuestionDto.parse(body.questions[0])).toThrow();
  });
});

function fakeGraph(rows: unknown[], calls: Array<{ name: string; params: unknown }> = []) {
  return {
    calls,
    graph: {
      query: async (name: string, params: unknown) => {
        calls.push({ name, params });
        return rows;
      },
    } as unknown as GraphKit,
  };
}

const USER = { id: 'u1', role: 'admin' as const };

describe('PuzzlesService.play', () => {
  const row = {
    id: 'P1',
    name: 'Databases 101',
    origin: 'seed',
    questions: [{ id: 'q1', order: 1, sentence: 'A ___ is ___.', blanks: 2 }],
    words: ['index', 'index', 'writes', 'cache', 'Index'],
  };

  it('returns a strictly parsed body with a deduplicated word bank and passes only { puzzleId, userId }', async () => {
    const { graph, calls } = fakeGraph([row]);
    const body = await new PuzzlesService(graph).play(USER, 'P1');
    expect(PlayPuzzleDto.safeParse(body).success).toBe(true);
    expect(new Set(body.wordBank)).toEqual(new Set(['Index', 'cache', 'writes']));
    expect(body.wordBank).toHaveLength(3);
    expect(calls).toEqual([{ name: 'play_puzzle', params: { puzzleId: 'P1', userId: 'u1' } }]);
    expect(Object.keys(body).sort()).toEqual(['id', 'name', 'origin', 'questions', 'wordBank']);
  });

  it('throws NotFoundError on zero rows', async () => {
    const { graph } = fakeGraph([]);
    await expect(new PuzzlesService(graph).play(USER, 'nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('PuzzlesService.list', () => {
  const base = {
    id: 'P1',
    name: 'n',
    visibility: 'public',
    origin: 'seed',
    access: 'public',
    ownerName: 'Max',
    sourceShared: false,
    sourceId: null,
    questionCount: 3,
    concepts: [{ id: 'c', name: 'C' }],
  };

  it('items parse with PuzzleSummaryDto; sourceId omitted when null, present when sourceShared', async () => {
    const { graph } = fakeGraph([base, { ...base, id: 'P2', access: 'shared', sourceShared: true, sourceId: 'S2' }]);
    const items = await new PuzzlesService(graph).list(USER);
    for (const item of items) expect(PuzzleSummaryDto.safeParse(item).success).toBe(true);
    expect('sourceId' in items[0]!).toBe(false);
    expect(items[1]!.sourceId).toBe('S2');
  });

  it('calls list_puzzles with the caller id only', async () => {
    const { graph, calls } = fakeGraph([]);
    await new PuzzlesService(graph).list(USER);
    expect(calls).toEqual([{ name: 'list_puzzles', params: { userId: 'u1' } }]);
  });
});
