import { describe, expect, it } from 'vitest';
import { mapRow, mapValue } from './mapping';

// Hand-built objects in the shape recorded by spike S1 (the design documents, Spike Notes).
const clientNode = (id: number, props: Record<string, unknown>, labels = ['Skill']) => ({
  id,
  labels,
  properties: props,
});
const clientEdge = (id: number, from: number, to: number, props: Record<string, unknown> = {}) => ({
  id,
  sourceId: from,
  destinationId: to,
  relationshipType: 'PREREQUISITE_OF',
  properties: props,
});

describe('mapRow', () => {
  it('keeps scalars and keys by column alias', () => {
    expect(mapRow({ id: 's1', score: 0.5, count: 3, ok: true, none: null })).toEqual({
      id: 's1',
      score: 0.5,
      count: 3,
      ok: true,
      none: null,
    });
  });

  it('maps lists recursively', () => {
    expect(mapRow({ tags: ['x', 'y'], nested: [[1, 2], [3]] })).toEqual({
      tags: ['x', 'y'],
      nested: [[1, 2], [3]],
    });
  });

  it('maps maps to plain objects recursively', () => {
    expect(mapRow({ m: { k: 1, inner: { z: [1, { q: 2 }] } } })).toEqual({
      m: { k: 1, inner: { z: [1, { q: 2 }] } },
    });
  });

  it('maps a node to GraphNode', () => {
    const row = mapRow({ a: clientNode(7, { id: 's1', tags: ['x'] }) });
    expect(row.a).toEqual({ internalId: 7, labels: ['Skill'], props: { id: 's1', tags: ['x'] } });
  });

  it('maps a relationship to GraphEdge', () => {
    const row = mapRow({ r: clientEdge(3, 7, 8, { w: 1.5 }) });
    expect(row.r).toEqual({
      internalId: 3,
      type: 'PREREQUISITE_OF',
      fromInternalId: 7,
      toInternalId: 8,
      props: { w: 1.5 },
    });
  });

  it('maps a path to GraphPath', () => {
    const path = {
      nodes: [clientNode(1, { id: 'a' }), clientNode(2, { id: 'b' })],
      edges: [clientEdge(9, 1, 2)],
    };
    const row = mapRow({ p: path });
    expect(row.p).toEqual({
      nodes: [
        { internalId: 1, labels: ['Skill'], props: { id: 'a' } },
        { internalId: 2, labels: ['Skill'], props: { id: 'b' } },
      ],
      edges: [
        { internalId: 9, type: 'PREREQUISITE_OF', fromInternalId: 1, toInternalId: 2, props: {} },
      ],
    });
  });

  it('maps nodes found inside lists and maps', () => {
    const row = mapRow({
      list: [clientNode(1, { id: 'a' })],
      map: { n: clientNode(2, { id: 'b' }) },
    });
    expect((row.list as unknown[])[0]).toMatchObject({ internalId: 1 });
    expect((row.map as Record<string, unknown>).n).toMatchObject({ internalId: 2 });
  });

  it('maps a vector (typed array) to number[]', () => {
    const row = mapRow({ v: new Float32Array([0.5, 0.25]) });
    expect(row.v).toEqual([0.5, 0.25]);
    expect(Array.isArray(row.v)).toBe(true);
  });

  it('maps undefined to null and bigint to number', () => {
    expect(mapValue(undefined)).toBeNull();
    expect(mapValue(10n)).toBe(10);
  });

  it('does not mistake an ordinary map with an id key for a node', () => {
    expect(mapRow({ m: { id: 1, name: 'x' } }).m).toEqual({ id: 1, name: 'x' });
  });
});
