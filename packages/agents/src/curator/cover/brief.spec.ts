import { describe, expect, it } from 'vitest';
import { PromptBrief, guardBrief } from '@coach/types';
import { briefForConcepts } from './brief';

const two = [
  {
    name: 'B-tree indexes',
    description: 'A balanced tree that keeps keys sorted for fast range lookups.',
  },
  {
    name: 'Write-ahead logging',
    description: 'Changes are appended to a log before the data pages are updated.',
  },
];

describe('briefForConcepts', () => {
  it('builds a valid brief from the concept names and descriptions that passes the guard', () => {
    const brief = briefForConcepts(two);
    expect(PromptBrief.safeParse(brief).success).toBe(true);
    expect(guardBrief(brief).ok).toBe(true);
    expect(brief.difficulty).toBe('medium');
    expect(brief.subject).toBe('B-tree indexes, Write-ahead logging');
    expect(brief.focus).toContain('balanced tree');
    expect(brief.focus).toContain('appended to a log');
  });

  it('keeps the subject within 120 characters and the focus within 300', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `Concept number ${i} with a long name`,
      description: `Description ${i} `.repeat(12),
    }));
    const brief = briefForConcepts(many);
    expect(Array.from(brief.subject).length).toBeLessThanOrEqual(120);
    expect(Array.from(brief.focus ?? '').length).toBeLessThanOrEqual(300);
    expect(guardBrief(brief).ok).toBe(true);
  });

  it('asks for between 3 and 10 sentences whatever the number of concepts', () => {
    for (const n of [1, 2, 3, 5, 20]) {
      const list = Array.from({ length: n }, (_, i) => ({
        name: `Concept ${i}`,
        description: 'Something true.',
      }));
      const { sentences } = briefForConcepts(list);
      expect(sentences).toBeGreaterThanOrEqual(3);
      expect(sentences).toBeLessThanOrEqual(10);
      expect(Number.isInteger(sentences)).toBe(true);
    }
  });

  it('leaves the focus out when no concept has a description, and pads a very short name', () => {
    const brief = briefForConcepts([{ name: 'ACID', description: '' }]);
    expect('focus' in brief).toBe(false);
    expect(guardBrief(brief).ok).toBe(true);
    const short = briefForConcepts([{ name: 'Go', description: 'A programming language.' }]);
    expect(PromptBrief.safeParse(short).success).toBe(true);
    expect(guardBrief(short).ok).toBe(true);
  });
});
