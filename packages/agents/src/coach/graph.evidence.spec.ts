import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_EVIDENCE, MAX_SESSION_EVIDENCE } from './constants';
import { runCoach } from './graph';
import { DEFAULT_COACH_SETTINGS } from './settings';
import { T, WORKED_IDS, createStubCoachQueries, workedExampleRows } from './testing/stubs';

const input = { learnerId: WORKED_IDS.learner, goalText: null, now: T };
const run = async (queries = createStubCoachQueries()) => {
  await runCoach({ queries, settings: DEFAULT_COACH_SETTINGS, newId: () => 'run-1' }, input);
  return queries.recorded[0]!.evidence;
};

describe('evidence passed to record_decision', () => {
  it('includes answer and session items with "missed N times" reasons', async () => {
    const evidence = await run();
    const answers = evidence.filter((e) => e.role === 'answer');
    const sessions = evidence.filter((e) => e.role === 'session');
    expect(answers.map((e) => e.reason)).toEqual(['missed 2 times', 'missed 2 times', 'missed 1 time', 'missed 1 time', 'missed 1 time']);
    expect(answers.every((e) => e.label === 'Question')).toBe(true);
    expect(sessions.map((e) => e.nodeId)).toEqual([WORKED_IDS.sessionC, WORKED_IDS.sessionB, WORKED_IDS.sessionA]);
    expect(sessions.every((e) => e.label === 'Session')).toBe(true);
  });

  it('is limited by MAX_ANSWER_EVIDENCE and MAX_SESSION_EVIDENCE', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      conceptId: WORKED_IDS.btrees,
      questionId: `q-${String(i).padStart(2, '0')}`,
      sessionId: `s-${i}`,
      submittedAt: T - (i + 1) * 3_600_000,
      misses: 1,
    }));
    const evidence = await run(createStubCoachQueries({ conceptAnswerEvidence: async () => many }));
    expect(evidence.filter((e) => e.role === 'answer')).toHaveLength(MAX_ANSWER_EVIDENCE);
    expect(evidence.filter((e) => e.role === 'session')).toHaveLength(MAX_SESSION_EVIDENCE);
  });

  it('is ordered deterministically whatever the order of the rows', async () => {
    const rows = workedExampleRows().answers;
    const a = await run(createStubCoachQueries({ conceptAnswerEvidence: async () => rows }));
    const b = await run(createStubCoachQueries({ conceptAnswerEvidence: async () => [...rows].reverse() }));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('asks for the wrong answers on the target and its drivers only', async () => {
    const queries = createStubCoachQueries();
    await run(queries);
    expect(queries.callsTo('conceptAnswerEvidence')[0]!.params).toMatchObject({
      learnerId: WORKED_IDS.learner,
      conceptIds: [WORKED_IDS.btrees, WORKED_IDS.indexes],
    });
  });
});
