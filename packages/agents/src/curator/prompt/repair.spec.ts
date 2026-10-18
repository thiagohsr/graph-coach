import { describe, expect, it } from 'vitest';
import { repairBlanks } from './repair';

describe('repairBlanks', () => {
  it('turns longer underscore runs into exactly three', () => {
    expect(repairBlanks('A node stores _____ and ______.', ['x', 'y'])).toBe(
      'A node stores ___ and ___.',
    );
  });

  it('leaves a correct sentence alone', () => {
    expect(repairBlanks('A node has ___.', ['properties'])).toBe('A node has ___.');
  });

  it('puts the blank where the answer stands when the marker is missing', () => {
    expect(
      repairBlanks('A property graph stores data as nodes and relationships.', ['relationships']),
    ).toBe('A property graph stores data as nodes and ___.');
  });

  it('handles several answers in order, case-insensitively and as whole words only', () => {
    expect(
      repairBlanks('Nodes connect through Relationships, and nodes carry properties.', [
        'nodes',
        'properties',
      ]),
    ).toBe('___ connect through Relationships, and nodes carry ___.');
    expect(repairBlanks('Subnodes are not nodes.', ['nodes'])).toBe('Subnodes are not ___.');
  });

  it('does not change a sentence when an answer cannot be found', () => {
    expect(repairBlanks('A node has properties.', ['edges'])).toBe('A node has properties.');
    expect(repairBlanks('A node has properties.', ['properties', 'edges'])).toBe(
      'A node has properties.',
    );
  });

  it('does nothing without answers or with an empty answer', () => {
    expect(repairBlanks('Plain text.', [])).toBe('Plain text.');
    expect(repairBlanks('Plain text.', [' '])).toBe('Plain text.');
  });
});
