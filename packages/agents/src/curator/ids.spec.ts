import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chunkId,
  conceptId,
  deterministicId,
  generatedQuestionId,
  ingestTaskId,
  puzzleIdForSource,
  puzzleIdForTask,
  questionId,
  sourceId,
  stepId,
  taskIdFor,
} from './ids';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('deterministicId', () => {
  it('joins the parts with ":" and formats like a UUID', () => {
    expect(deterministicId('a', 'b')).toMatch(UUID_SHAPE);
    expect(deterministicId('a', 'b')).toBe(deterministicId('a', 'b'));
    expect(deterministicId('a', 'b')).not.toBe(deterministicId('a', 'c'));
  });

  it('is SHA-256 of the parts joined with ":", first 32 hex characters, formatted 8-4-4-4-12 (as in @coach/graph-kit)', () => {
    const hex = createHash('sha256').update('source:owner:fp').digest('hex').slice(0, 32);
    const expected = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    expect(deterministicId('source', 'owner', 'fp')).toBe(expected);
  });
});

describe('id functions', () => {
  it('give UUID-shaped, deterministic values that differ when any input differs', () => {
    const cases: Array<[string, () => string, () => string]> = [
      ['sourceId owner', () => sourceId('o1', 'f'), () => sourceId('o2', 'f')],
      ['sourceId fingerprint', () => sourceId('o', 'f1'), () => sourceId('o', 'f2')],
      ['ingestTaskId', () => ingestTaskId('s1'), () => ingestTaskId('s2')],
      ['taskIdFor kind', () => taskIdFor('ingest', 's'), () => taskIdFor('generate', 's')],
      ['chunkId source', () => chunkId('s1', 0), () => chunkId('s2', 0)],
      ['chunkId position', () => chunkId('s', 0), () => chunkId('s', 1)],
      ['conceptId', () => conceptId('a'), () => conceptId('b')],
      ['puzzleIdForSource', () => puzzleIdForSource('s1'), () => puzzleIdForSource('s2')],
      ['puzzleIdForTask', () => puzzleIdForTask('t1'), () => puzzleIdForTask('t2')],
      [
        'questionId chunk',
        () => questionId('c1', 'A ___ b', ['x']),
        () => questionId('c2', 'A ___ b', ['x']),
      ],
      [
        'questionId sentence',
        () => questionId('c', 'A ___ b', ['x']),
        () => questionId('c', 'A ___ c', ['x']),
      ],
      [
        'questionId answers',
        () => questionId('c', 'A ___ b', ['x']),
        () => questionId('c', 'A ___ b', ['y']),
      ],
      [
        'generatedQuestionId',
        () => generatedQuestionId('s1', 'A ___ b', ['x']),
        () => generatedQuestionId('s2', 'A ___ b', ['x']),
      ],
      ['stepId task', () => stepId('t1', 'chunk', 1), () => stepId('t2', 'chunk', 1)],
      ['stepId node', () => stepId('t', 'chunk', 1), () => stepId('t', 'embed', 1)],
      ['stepId attempt', () => stepId('t', 'chunk', 1), () => stepId('t', 'chunk', 2)],
    ];
    for (const [name, a, b] of cases) {
      expect(a(), name).toMatch(UUID_SHAPE);
      expect(a(), `${name} deterministic`).toBe(a());
      expect(a(), `${name} differs`).not.toBe(b());
    }
  });

  it('puzzle ids follow the source, so a source yields one puzzle', () => {
    expect(puzzleIdForSource('s')).toBe(deterministicId('puzzle', 's'));
  });

  it('question ids ignore case and spacing of the sentence', () => {
    expect(questionId('c', '  An  ___ HELPS  here. ', ['x'])).toBe(
      questionId('c', 'an ___ helps here.', ['x']),
    );
  });
});

describe('stepId with a round (reconciliation N)', () => {
  it('keeps the first-pass id and gives each top-up round its own', () => {
    expect(stepId('t', 'critique', 1, 0)).toBe(stepId('t', 'critique', 1));
    expect(stepId('t', 'critique', 1, 1)).not.toBe(stepId('t', 'critique', 1));
    expect(stepId('t', 'critique', 1, 1)).not.toBe(stepId('t', 'critique', 1, 2));
    expect(stepId('t', 'critique', 1, 1)).toBe(stepId('t', 'critique', 1, 1));
  });
});
