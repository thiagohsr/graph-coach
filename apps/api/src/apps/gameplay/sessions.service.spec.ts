import { describe, expect, it } from 'vitest';
import type { GraphKit } from '@coach/graph-kit';
import { SubmitResult } from '@coach/types';
import { AppError, ConflictError, NotFoundError } from '../../common/errors/app-error';
import { LearnerLock } from './learner-lock';
import { MasteryService } from './mastery.service';
import { SessionsService } from './sessions.service';

const USER = { id: 'u1', role: 'learner' as const };
const NOW = 1_760_000_000_000;

const KEY_ROWS = [
  {
    questionId: 'q1',
    order: 1,
    sentence: 'A ___ and ___',
    answers: ['index', 'writes'],
    concepts: [{ id: 'c-index', name: 'Indexes' }],
  },
  { questionId: 'q2', order: 2, sentence: 'B ___', answers: ['B-tree'], concepts: [] },
];

const SESSION = {
  sessionId: 's1',
  puzzleId: 'P1',
  puzzleName: 'Databases',
  puzzleOrigin: 'seed',
  startedAt: 1,
  submittedAt: null,
  score: null,
  maxScore: null,
  answers: [],
  masteryChanges: [],
};

function make(overrides: Partial<Record<string, unknown[]>> = {}) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const responses: Record<string, unknown[]> = {
    create_session: [{ sessionId: 'new' }],
    get_session: [SESSION],
    puzzle_answer_key: KEY_ROWS,
    learner_mastery: [],
    record_answers: [{ sessionId: 's1', answersWritten: 3, conceptsUpdated: 1 }],
    ...overrides,
  };
  const graph = {
    query: async (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return responses[name] ?? [];
    },
  } as unknown as GraphKit;
  const settings = { get: async () => 0.3 as never };
  const clock = { now: () => new Date(NOW) };
  const mastery = new MasteryService(graph, settings, clock);
  const lock = new LearnerLock();
  return { service: new SessionsService(graph, mastery, lock, clock), calls, lock };
}

describe('SessionsService.start', () => {
  it('passes callerParams and returns the session id', async () => {
    const { service, calls } = make();
    const r = await service.start(USER, 'P1', NOW);
    expect(r.sessionId).toEqual(expect.any(String));
    expect(calls[0]!.name).toBe('create_session');
    expect(calls[0]!.params).toMatchObject({ userId: 'u1', puzzleId: 'P1', now: NOW });
    expect(Object.keys(calls[0]!.params).sort()).toEqual([
      'now',
      'puzzleId',
      'sessionId',
      'userId',
    ]);
  });

  it('throws NotFoundError on zero rows', async () => {
    const { service } = make({ create_session: [] });
    await expect(service.start(USER, 'P1')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('SessionsService.submit', () => {
  const body = { answers: [{ questionId: 'q1', blank: 0, word: ' Index ' }] };

  it('calls get_session, puzzle_answer_key, learner_mastery, record_answers in order with every blank', async () => {
    const { service, calls } = make();
    const result = await service.submit(USER, 's1', body, NOW);
    expect(calls.map((c) => c.name)).toEqual([
      'get_session',
      'puzzle_answer_key',
      'learner_mastery',
      'record_answers',
      'question_grounding',
    ]);
    expect(calls[0]!.params).toEqual({ sessionId: 's1', learnerId: 'u1' });
    const write = calls[3]!.params;
    expect((write.answers as unknown[]).length).toBe(3);
    expect(write).toMatchObject({ score: 10, maxScore: 30, learnerId: 'u1', now: NOW });
    expect(result.score).toBe(10);
    expect(SubmitResult.safeParse(result).success).toBe(true);
  });

  it('throws NotFoundError on zero rows from get_session', async () => {
    const { service } = make({ get_session: [] });
    await expect(service.submit(USER, 's1', body)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws SESSION_ALREADY_SUBMITTED from the pre-check', async () => {
    const { service, calls } = make({ get_session: [{ ...SESSION, submittedAt: 5 }] });
    await expect(service.submit(USER, 's1', body)).rejects.toMatchObject({
      code: 'SESSION_ALREADY_SUBMITTED',
      status: 409,
    });
    expect(calls.map((c) => c.name)).toEqual(['get_session']);
  });

  it('throws SESSION_ALREADY_SUBMITTED when record_answers returns zero rows', async () => {
    const { service } = make({ record_answers: [] });
    const error = await service.submit(USER, 's1', body).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.code).toBe('SESSION_ALREADY_SUBMITTED');
  });

  it('throws 422 VALIDATION_FAILED with details.issues and does not write', async () => {
    const { service, calls } = make();
    const error = await service
      .submit(USER, 's1', { answers: [{ questionId: 'nope', blank: 0, word: 'x' }] })
      .catch((e) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(422);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details.issues[0].path).toBe('answers.0.questionId');
    expect(calls.map((c) => c.name)).not.toContain('record_answers');
  });

  it('runs inside the learner lock', async () => {
    const { service, lock } = make();
    const seen: string[] = [];
    const original = lock.run.bind(lock);
    lock.run = ((id: string, fn: () => Promise<unknown>) => {
      seen.push(id);
      return original(id, fn);
    }) as typeof lock.run;
    await service.submit(USER, 's1', body, NOW);
    expect(seen).toEqual(['u1']);
  });
});

describe('SessionsService.getResult', () => {
  const submitted = {
    ...SESSION,
    submittedAt: NOW,
    score: 10,
    maxScore: 30,
    answers: [
      { questionId: 'q1', order: 1, blank: 0, word: 'index', correct: true },
      { questionId: 'q1', order: 1, blank: 1, word: '', correct: false },
      { questionId: 'q2', order: 2, blank: 0, word: '', correct: false },
    ],
    masteryChanges: [{ conceptId: 'c-index', name: 'Indexes', before: 0.5, after: 0.455 }],
  };

  it('throws NotFoundError on zero rows and SESSION_NOT_SUBMITTED when unsubmitted', async () => {
    await expect(make({ get_session: [] }).service.getResult(USER, 's1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(make().service.getResult(USER, 's1')).rejects.toMatchObject({
      code: 'SESSION_NOT_SUBMITTED',
    });
  });

  it('rebuilds blanks with expected from the key and uses the stored mastery changes', async () => {
    const { service, calls } = make({ get_session: [submitted] });
    const r = await service.getResult(USER, 's1');
    expect(
      r.review.map((i) => [i.questionId, i.blank, i.submitted, i.expected, i.correct]),
    ).toEqual([
      ['q1', 0, 'index', 'index', true],
      ['q1', 1, null, 'writes', false],
      ['q2', 0, null, 'B-tree', false],
    ]);
    expect(r.mastery).toEqual([
      { conceptId: 'c-index', name: 'Indexes', before: 0.5, after: 0.455 },
    ]);
    expect(calls.map((c) => c.name)).toEqual([
      'get_session',
      'puzzle_answer_key',
      'question_grounding',
    ]);
  });

  it('attaches an excerpt, never the full chunk text, and passes the caller id to question_grounding', async () => {
    const long = 'word '.repeat(200);
    const { service, calls } = make({
      get_session: [submitted],
      question_grounding: [{ questionId: 'q1', chunkId: 'ch-1', sourceId: 'S1', text: long }],
    });
    const r = await service.getResult(USER, 's1');
    expect(calls.at(-1)).toEqual({
      name: 'question_grounding',
      params: { sessionId: 's1', userId: 'u1' },
    });
    const withPassage = r.review.filter((i) => i.passage);
    expect(withPassage.map((i) => i.questionId)).toEqual(['q1', 'q1']);
    const passage = withPassage[0]!.passage!;
    expect(passage).toMatchObject({ chunkId: 'ch-1', sourceId: 'S1' });
    expect(passage.excerpt.length).toBeLessThanOrEqual(281);
    expect(passage.excerpt.endsWith('…')).toBe(true);
    expect(r.review.find((i) => i.questionId === 'q2')!.passage).toBeUndefined();
  });

  it('still returns the result without passages when question_grounding fails (submit and read)', async () => {
    const failing = (rows: unknown[]) => {
      const made = make({ get_session: rows });
      const original = (
        made.service as unknown as {
          graph: { query: (n: string, p: unknown) => Promise<unknown[]> };
        }
      ).graph;
      const query = original.query.bind(original);
      original.query = async (name, params) => {
        if (name === 'question_grounding') throw new Error('boom');
        return query(name, params);
      };
      return made.service;
    };
    const read = await failing([submitted]).getResult(USER, 's1');
    expect(read.review.some((i) => i.passage)).toBe(false);
    const posted = await failing([SESSION]).submit(USER, 's1', { answers: [] }, NOW);
    expect(posted.review.some((i) => i.passage)).toBe(false);
  });
});
