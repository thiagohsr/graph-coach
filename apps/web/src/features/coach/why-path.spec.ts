import type { DecisionPathDto } from '@coach/types';
import { describe, expect, it } from 'vitest';
import { path } from './fixtures';
import { buildWhyPath } from './why-path';

const node = (vm: ReturnType<typeof buildWhyPath>, id: string) =>
  vm.nodes.find((n) => n.id === id)!;

describe('buildWhyPath', () => {
  it('passes steps through unchanged', () => {
    expect(buildWhyPath(path).steps).toEqual(path.steps);
  });

  it('selects the Decision node as root, then a node without incoming edges, then the first node', () => {
    expect(buildWhyPath(path).rootId).toBe('dec-1');
    const noDecision: DecisionPathDto = {
      nodes: [
        { id: 'b', label: 'Concept', title: 'B', props: {} },
        { id: 'a', label: 'Concept', title: 'A', props: {} },
      ],
      edges: [{ from: 'a', to: 'b', type: 'TESTS' }],
      steps: ['x'],
    };
    expect(buildWhyPath(noDecision).rootId).toBe('a');
    const cycle: DecisionPathDto = {
      nodes: [
        { id: 'a', label: 'Concept', title: 'A', props: {} },
        { id: 'b', label: 'Concept', title: 'B', props: {} },
      ],
      edges: [
        { from: 'a', to: 'b', type: 'TESTS' },
        { from: 'b', to: 'a', type: 'TESTS' },
      ],
      steps: ['x'],
    };
    expect(buildWhyPath(cycle).rootId).toBe('a');
  });

  it('computes depths by breadth-first distance over undirected edges', () => {
    const vm = buildWhyPath(path);
    expect(node(vm, 'dec-1').depth).toBe(0);
    expect(node(vm, 'Coach').depth).toBe(1);
    expect(node(vm, 'c-ix').depth).toBe(1);
  });

  it('places unreachable nodes at maxDepth + 1', () => {
    const vm = buildWhyPath({
      ...path,
      nodes: [...path.nodes, { id: 'lone', label: 'Concept', title: 'Lone', props: {} }],
    });
    expect(node(vm, 'lone').depth).toBe(2 - 1 + 1);
  });

  it('labels an edge with its reason, else with a phrase for its type', () => {
    const vm = buildWhyPath(path);
    expect(vm.edges.find((e) => e.target === 'pz-1')!.label).toBe('recommends');
    expect(vm.edges.find((e) => e.target === 'c-bt' && e.source === 'dec-1')!.label).toBe(
      'target: mastery 0.12',
    );
    const odd = buildWhyPath({
      ...path,
      edges: [{ from: 'dec-1', to: 'c-bt', type: 'SOME_NEW_TYPE' }],
    });
    expect(odd.edges[0]!.label).toBe('some new type');
  });

  it('takes roleLabel from the incoming BECAUSE edge: absent without one, raw when unknown', () => {
    const vm = buildWhyPath(path);
    expect(node(vm, 'c-bt').roleLabel).toBe('Target');
    expect(node(vm, 'c-ix').roleLabel).toBe('Weak concept');
    expect(node(vm, 'pz-1').roleLabel).toBeUndefined();
    const unknown = buildWhyPath({
      ...path,
      edges: [{ from: 'dec-1', to: 'c-bt', type: 'BECAUSE', role: 'passage' }],
    });
    expect(node(unknown, 'c-bt').roleLabel).toBe('Passage');
    const raw = buildWhyPath({
      ...path,
      edges: [{ from: 'dec-1', to: 'c-bt', type: 'BECAUSE', role: 'mystery' as never }],
    });
    expect(node(raw, 'c-bt').roleLabel).toBe('mystery');
  });

  it('keeps parallel edges distinct and counts edges to missing nodes', () => {
    const vm = buildWhyPath({
      ...path,
      edges: [
        { from: 'dec-1', to: 'c-bt', type: 'BECAUSE' },
        { from: 'dec-1', to: 'c-bt', type: 'BECAUSE' },
        { from: 'dec-1', to: 'ghost', type: 'BECAUSE' },
      ],
    });
    expect(vm.edges).toHaveLength(2);
    expect(new Set(vm.edges.map((e) => e.id)).size).toBe(2);
    expect(vm.droppedEdges).toBe(1);
  });

  it('is empty without nodes or without steps', () => {
    expect(buildWhyPath({ nodes: [], edges: [], steps: ['x'] }).isEmpty).toBe(true);
    expect(buildWhyPath({ ...path, steps: [] }).isEmpty).toBe(true);
    expect(buildWhyPath(path).isEmpty).toBe(false);
  });

  it('keeps only scalar props in details and formats keys ending in At as dates', () => {
    const vm = buildWhyPath(path);
    const details = Object.fromEntries(node(vm, 'dec-1').details);
    expect(details).toEqual({ kind: 'recommendation', createdAt: '2026-10-11 14:03 UTC' });
    const epoch = buildWhyPath({
      ...path,
      nodes: [
        {
          id: 's',
          label: 'Session',
          title: 'S',
          props: { submittedAt: Date.UTC(2026, 9, 10, 9, 0), score: 5 },
        },
      ],
    });
    expect(Object.fromEntries(node(epoch, 's').details)).toEqual({
      submittedAt: '2026-10-10 09:00 UTC',
      score: '5',
    });
  });

  it('builds normally when there are no passage nodes, and shows an unknown label raw', () => {
    const vm = buildWhyPath({
      ...path,
      nodes: [...path.nodes, { id: 'x', label: 'Chunk', title: 'Excerpt', props: {} }],
    });
    expect(node(vm, 'x').kindLabel).toBe('Passage');
    expect(buildWhyPath(path).nodes.some((n) => n.kind === 'Chunk')).toBe(false);
    const odd = buildWhyPath({
      ...path,
      nodes: [
        { id: 'z', label: 'Concept', title: 'Z', props: {} },
        { id: 'y', label: 'Widget' as never, title: 'Y', props: {} },
      ],
    });
    expect(node(odd, 'y')).toMatchObject({ kind: 'other', kindLabel: 'Widget' });
  });
});
