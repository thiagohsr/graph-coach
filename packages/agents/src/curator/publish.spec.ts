import { describe, expect, it } from 'vitest';
import { ZERO_USAGE } from '../llm/usage';
import { runPublish } from './publish';
import { FakeCuratorGraph } from './testing/fake-graph-port';

function setup(statuses: Array<'draft' | 'approved' | 'rejected'>) {
  const graph = new FakeCuratorGraph();
  graph.addSource({ id: 's1', ownerId: 'u1', content: 'text' });
  graph.addTask({ id: 't1', sourceId: 's1', requesterId: 'u1', status: 'awaiting_review' });
  graph.puzzles.set('p1', {
    id: 'p1',
    ownerId: 'u1',
    sourceId: 's1',
    name: 'Puzzle',
    origin: 'upload',
    status: 'draft',
    visibility: 'private',
  });
  statuses.forEach((status, i) => {
    graph.questions.set(`q${i}`, {
      id: `q${i}`,
      sentence: 'A ___ B',
      answers: ['x'],
      distractors: ['y'],
      order: i,
      chunkId: 'c',
      conceptSlugs: [],
      puzzleId: 'p1',
      status,
      concepts: [],
    });
    graph.produced.add(`t1|question|q${i}`);
  });
  return graph;
}

const publishSteps = (graph: FakeCuratorGraph) =>
  graph.stepsOf('t1').filter((s) => s.node === 'publish');

describe('runPublish', () => {
  it('publishes at the minimum and records one publish step with counts', async () => {
    const graph = setup(['approved', 'approved', 'approved', 'rejected']);
    const out = await runPublish(
      { graph, recorder: graph },
      { taskId: 't1', puzzleId: 'p1', minQuestions: 3, rejected: 1 },
    );
    expect(out.result).toBe('ok');
    expect(out.puzzle).toMatchObject({ status: 'published', visibility: 'private', approved: 3 });
    const steps = publishSteps(graph);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'complete', usage: ZERO_USAGE });
    expect(steps[0]!.log).toBe('Published with 3 approved questions (1 rejected).');
    expect(graph.tasks.get('t1')!.lastCompletedStep).toBe('publish');
  });

  it('reports below_minimum with approved and minimum counts in the log', async () => {
    const graph = setup(['approved', 'rejected', 'rejected']);
    const out = await runPublish(
      { graph, recorder: graph },
      { taskId: 't1', puzzleId: 'p1', minQuestions: 3, rejected: 2 },
    );
    expect(out.result).toBe('below_minimum');
    expect(graph.puzzles.get('p1')!.status).toBe('draft');
    expect(publishSteps(graph)[0]!.log).toBe('Not published: 1 approved of 3 needed (2 rejected).');
    expect(out).toMatchObject({ approved: 1, minQuestions: 3, rejected: 2 });
  });

  it('is safe to call twice: one step, same result, puzzle still published', async () => {
    const graph = setup(['approved', 'approved', 'approved']);
    const input = { taskId: 't1', puzzleId: 'p1', minQuestions: 3, rejected: 0 };
    const first = await runPublish({ graph, recorder: graph }, input);
    const second = await runPublish({ graph, recorder: graph }, input);
    expect(second.result).toBe(first.result);
    expect(publishSteps(graph)).toHaveLength(1);
    expect(graph.puzzles.get('p1')!.status).toBe('published');
    expect(graph.countWrites('publishPuzzle')).toBe(1);
  });

  it('records an error step and rethrows when the puzzle is missing', async () => {
    const graph = setup([]);
    await expect(
      runPublish(
        { graph, recorder: graph },
        { taskId: 't1', puzzleId: 'nope', minQuestions: 3, rejected: 0 },
      ),
    ).rejects.toThrow(/does not exist/);
    expect(publishSteps(graph)[0]).toMatchObject({ status: 'error' });
  });
});
