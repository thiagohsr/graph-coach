import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PROMPT_ORIGIN_NOTICE,
  PromptBrief,
  SourceCreateRequest,
  SourceDetailDto,
  guardBrief,
  type GuardReasonCode,
} from './curator';

const ok = { subject: 'B-tree indexes', difficulty: 'medium', sentences: 5 } as const;

describe('PromptBrief and the request union', () => {
  it('accepts the bounds of data-model §5', () => {
    expect(PromptBrief.safeParse(ok).success).toBe(true);
    expect(
      PromptBrief.safeParse({ subject: 'abc', difficulty: 'easy', sentences: 3 }).success,
    ).toBe(true);
    expect(
      PromptBrief.safeParse({
        subject: 'x'.repeat(120),
        focus: 'y'.repeat(300),
        difficulty: 'hard',
        sentences: 10,
      }).success,
    ).toBe(true);
  });

  it('rejects values outside the bounds', () => {
    for (const bad of [
      { ...ok, subject: 'ab' },
      { ...ok, subject: 'x'.repeat(121) },
      { ...ok, focus: 'y'.repeat(301) },
      { ...ok, sentences: 2 },
      { ...ok, sentences: 11 },
      { ...ok, sentences: 4.5 },
      { ...ok, difficulty: 'impossible' },
      { ...ok, extra: 1 },
    ]) {
      expect(PromptBrief.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('accepts a prompt body and an upload body, and refuses the mixed ones', () => {
    expect(SourceCreateRequest.safeParse({ title: 'T', kind: 'prompt', brief: ok }).success).toBe(
      true,
    );
    expect(
      SourceCreateRequest.safeParse({ title: 'T', kind: 'markdown', content: 'some text' })
        .success,
    ).toBe(true);
    expect(
      SourceCreateRequest.safeParse({ title: 'T', kind: 'prompt', brief: ok, content: 'text' })
        .success,
    ).toBe(false);
    expect(
      SourceCreateRequest.safeParse({ title: 'T', kind: 'text', content: 'text', brief: ok })
        .success,
    ).toBe(false);
    expect(SourceCreateRequest.safeParse({ title: 'T', kind: 'prompt' }).success).toBe(false);
    expect(SourceCreateRequest.safeParse({ title: 'T', kind: 'video', content: 'x' }).success).toBe(
      false,
    );
  });

  it('puts the brief on the source detail, optional', () => {
    const base = {
      id: 's',
      title: 't',
      kind: 'prompt',
      origin: 'prompt',
      createdAt: '2026-10-15T10:00:00.000Z',
      access: 'owner',
      ownerName: 'o',
    };
    expect(SourceDetailDto.safeParse({ ...base, brief: ok }).success).toBe(true);
    expect(SourceDetailDto.safeParse(base).success).toBe(true);
  });

  it('exports the notice', () => {
    expect(PROMPT_ORIGIN_NOTICE).toBe('Generated from a prompt, not checked against a source');
  });

  it('imports nothing Node-only', () => {
    const text = readFileSync(new URL('./curator.ts', import.meta.url), 'utf8');
    expect(text).not.toMatch(/from 'node:|require\(/);
  });
});

describe('guardBrief', () => {
  const codes = (input: Parameters<typeof guardBrief>[0]) =>
    guardBrief(input).reasons.map((r) => r.code);
  const sentences = 5;

  it.each<[string, Parameters<typeof guardBrief>[0], GuardReasonCode]>([
    ['empty subject', { subject: '', sentences }, 'brief_too_short'],
    ['"ab"', { subject: 'ab', sentences }, 'brief_too_short'],
    ['digits only', { subject: '12345 67890', sentences }, 'brief_no_letters'],
    ['punctuation only', { subject: '!!!???', sentences }, 'brief_no_letters'],
    ['one letter repeated', { subject: 'aaaaaaaaaaaa', sentences }, 'brief_not_a_topic'],
    ['one word repeated', { subject: 'test test test test', sentences }, 'brief_not_a_topic'],
    ['a URL', { subject: 'https://example.com/page', sentences }, 'brief_not_a_topic'],
    ['an e-mail address', { subject: 'someone@example.com', sentences }, 'brief_not_a_topic'],
    ['a control character', { subject: 'SQL\u0007 joins', sentences }, 'brief_not_a_topic'],
    ['subject over 120', { subject: 'database '.repeat(14).trim() + 'x', sentences }, 'brief_too_long'],
    ['focus over 300', { subject: 'SQL joins', focus: 'inner joins '.repeat(30), sentences }, 'brief_too_long'],
    ['focus a URL', { subject: 'SQL joins', focus: 'www.example.com/x', sentences }, 'brief_not_a_topic'],
    ['sentences 2', { subject: 'SQL joins', sentences: 2 }, 'brief_sentences_out_of_range'],
    ['sentences 11', { subject: 'SQL joins', sentences: 11 }, 'brief_sentences_out_of_range'],
  ])('refuses %s', (_name, input, code) => {
    const result = guardBrief(input);
    expect(result.ok).toBe(false);
    expect(codes(input)).toContain(code);
  });

  it('puts each reason on the right field', () => {
    const result = guardBrief({ subject: 'ab', focus: 'https://x.test/a', sentences: 12 });
    const paths = Object.fromEntries(result.reasons.map((r) => [r.code, r.path]));
    expect(paths.brief_too_short).toBe('brief.subject');
    expect(paths.brief_sentences_out_of_range).toBe('brief.sentences');
    expect(result.reasons.find((r) => r.code === 'brief_not_a_topic')?.path).toBe('brief.focus');
  });

  it('reports every failed rule together', () => {
    const found = codes({ subject: '!!', sentences: 99 });
    expect(found).toEqual(
      expect.arrayContaining(['brief_too_short', 'brief_no_letters', 'brief_sentences_out_of_range']),
    );
  });

  it.each([
    [{ subject: 'B-tree indexes', sentences }],
    [{ subject: 'HTTP caching', focus: 'Cache-Control and ETag headers', sentences }],
    [{ subject: 'SQL joins', sentences: 3 }],
    [
      {
        subject:
          'The history of relational database design from the first normal forms to modern columnar engines and query planners',
        sentences: 10,
      },
    ],
  ])('accepts %j', (input) => {
    const result = guardBrief(input);
    expect(result.reasons).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('accepts a subject of exactly 120 characters', () => {
    const subject = `${'database '.repeat(13)}design`.slice(0, 120);
    expect(subject).toHaveLength(120);
    expect(guardBrief({ subject, sentences }).ok).toBe(true);
  });
});
