import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GUARD_DEFAULTS,
  PROMPT_ORIGIN_NOTICE,
  UPLOAD_NOTICE,
  countWords,
  guard,
  measureText,
  normaliseWhitespace,
  splitSentences,
  toPlainText,
  type GuardReasonCode,
} from './curator';

const seedText = (name: string) =>
  readFileSync(new URL(`../../../seed/sources/${name}`, import.meta.url), 'utf8');

// ─── Text helpers ────────────────────────────────────────────────────────────

describe('normaliseWhitespace', () => {
  it('turns CRLF, CR, tabs, runs of spaces, and non-breaking spaces into single spaces', () => {
    expect(normaliseWhitespace('a\r\nb\rc\td  e f g')).toBe('a b c d e f g');
  });

  it('trims both ends', () => {
    expect(normaliseWhitespace('  \n hello world \t\n')).toBe('hello world');
  });

  it('changes nothing else: case and punctuation stay', () => {
    expect(normaliseWhitespace('Hello,   WORLD!')).toBe('Hello, WORLD!');
  });

  it('gives an empty string for whitespace only', () => {
    expect(normaliseWhitespace(' \n\t ')).toBe('');
  });
});

describe('toPlainText', () => {
  it('returns text kinds untouched', () => {
    const text = '# not a heading\n* not a bullet\n';
    expect(toPlainText('text', text)).toBe(text);
  });

  it('strips Markdown markers but keeps the words', () => {
    const markdown = [
      '# Title here',
      '',
      '## Sub heading',
      '- first **bold** item',
      '1. second *italic* item',
      '> quoted words',
      'A [link text](https://example.com/x) and ![alt text](img.png) and `code`.',
      '```js',
      'const x = 1;',
      '```',
    ].join('\n');
    const plain = toPlainText('markdown', markdown);
    expect(plain).not.toMatch(/[#*`>]|\]\(|https:\/\//);
    for (const word of [
      'Title here',
      'Sub heading',
      'first bold item',
      'second italic item',
      'quoted words',
      'link text',
      'alt text',
      'code',
      'const x = 1;',
    ]) {
      expect(plain).toContain(word);
    }
    expect(plain).not.toContain('```');
  });

  it('keeps the blank marker of a sentence', () => {
    expect(toPlainText('markdown', 'An ___ speeds up reads.')).toContain('___');
  });
});

describe('splitSentences', () => {
  it('splits on full stops, exclamation marks, and question marks followed by a capital', () => {
    expect(splitSentences('One is here. Two is here! Three is here? Four is here.')).toEqual([
      'One is here.',
      'Two is here!',
      'Three is here?',
      'Four is here.',
    ]);
  });

  it('does not split on a decimal point or a lower-case continuation', () => {
    expect(splitSentences('Pi is 3.14 roughly. e.g. this stays together.')).toEqual([
      'Pi is 3.14 roughly. e.g. this stays together.',
    ]);
    expect(splitSentences('Version 2.5 is out. Version 3 follows.')).toEqual([
      'Version 2.5 is out.',
      'Version 3 follows.',
    ]);
  });

  it('always splits on a blank line', () => {
    expect(splitSentences('a heading without a stop\n\nthe body follows here')).toEqual([
      'a heading without a stop',
      'the body follows here',
    ]);
  });

  it('joins lines inside a paragraph and drops empties', () => {
    expect(splitSentences('first line\nsecond line.\n\n\n')).toEqual(['first line second line.']);
    expect(splitSentences('   ')).toEqual([]);
  });
});

describe('notices', () => {
  it('exports the single wording of the notices', () => {
    expect(UPLOAD_NOTICE).toBe(
      'Only upload material you have the right to use. This site is a demonstration: content may be removed and the site may be reset at any time.',
    );
    expect(PROMPT_ORIGIN_NOTICE).toBe('Generated from a prompt, not checked against a source');
  });
});

// ─── Guard ───────────────────────────────────────────────────────────────────

/** Deterministic pseudo-random pseudo-words, so that long varied prose needs no fixture file. */
function prose(words: number, sentenceLength = 12, offset = 0): string {
  const out: string[] = [];
  for (let i = 0; i < words; i += 1) {
    let n = ((i + offset) * 7919 + 13) % 456_976;
    let word = '';
    for (let k = 0; k < 4; k += 1) {
      word += String.fromCharCode(97 + (n % 26));
      n = Math.floor(n / 26);
    }
    word = `${word}${i % 3 === 0 ? 'ing' : i % 3 === 1 ? 'ed' : 's'}`;
    if (i % sentenceLength === 0) word = word[0]!.toUpperCase() + word.slice(1);
    out.push(i % sentenceLength === sentenceLength - 1 ? `${word}.` : word);
  }
  return out.join(' ');
}

const TWENTY_WORDS =
  'A relational database stores rows in tables and uses keys to find rows quickly when a query asks for them by value.';

function paragraph150(): string {
  return Array.from({ length: 10 }, (_, s) => prose(15, 15, s * 15)).join(' ');
}

function base64Block(length: number): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let state = 12345;
  let out = '';
  for (let i = 0; i < length; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out += alphabet[state % alphabet.length];
  }
  return out;
}

interface JunkCase {
  id: string;
  kind: 'text' | 'markdown';
  content: string;
  expected: GuardReasonCode[];
}

const JUNK: JunkCase[] = [
  { id: 'J1 empty', kind: 'text', content: '', expected: ['too_short'] },
  {
    id: 'J2 whitespace only',
    kind: 'text',
    content: ' \t\n  '.repeat(30),
    expected: ['too_short'],
  },
  { id: 'J3 one 20-word sentence', kind: 'text', content: TWENTY_WORDS, expected: ['too_short'] },
  {
    id: 'J4 "a" x 5000',
    kind: 'text',
    content: 'a'.repeat(5000),
    expected: ['too_short', 'low_diversity'],
  },
  {
    id: 'J5 "abc " x 2000',
    kind: 'text',
    content: 'abc '.repeat(2000),
    expected: ['low_diversity', 'repeated_content'],
  },
  {
    id: 'J6 one 8-word sentence x 200',
    kind: 'text',
    content: 'The quick brown fox jumps over lazy dogs. '.repeat(200),
    expected: ['repeated_content'],
  },
  {
    id: 'J7 one 150-word paragraph x 30',
    kind: 'text',
    content: Array.from({ length: 30 }, () => paragraph150()).join('\n\n'),
    expected: ['repeated_content'],
  },
  {
    id: 'J8 html page',
    kind: 'text',
    content: Array.from(
      { length: 100 },
      (_, i) => `<div class="row"><span>${prose(1).toLowerCase()}${i}</span></div>`,
    ).join('\n'),
    expected: ['mostly_markup'],
  },
  {
    id: 'J9 150 lines of one URL',
    kind: 'text',
    content: Array.from({ length: 150 }, (_, i) => `https://example.com/articles/${i}`).join('\n'),
    expected: ['mostly_markup'],
  },
  {
    id: 'J10 digits',
    kind: 'text',
    content: '1234567890 '.repeat(1000),
    expected: ['low_diversity'],
  },
  {
    id: 'J11 punctuation words',
    kind: 'text',
    content: '!!! ??? ### $$$ '.repeat(125),
    expected: ['low_diversity'],
  },
  { id: 'J12 base64 block', kind: 'text', content: base64Block(8000), expected: ['too_short'] },
  { id: 'J13 10,001 words', kind: 'text', content: prose(10_001), expected: ['too_long'] },
  {
    id: 'J14 empty markdown table',
    kind: 'markdown',
    content: '| | | |\n|---|---|---|\n'.repeat(100),
    expected: ['low_diversity'],
  },
];

describe('guard: junk cases J1-J14', () => {
  for (const junk of JUNK) {
    it(`${junk.id} is refused with ${junk.expected.join(', ')}`, () => {
      const result = guard({ kind: junk.kind, content: junk.content });
      expect(result.ok).toBe(false);
      const codes = result.reasons.map((r) => r.code);
      for (const code of junk.expected) expect(codes).toContain(code);
    });
  }

  it('reports every failed rule together, each with what was measured and the threshold', () => {
    const result = guard({ kind: 'text', content: 'a'.repeat(5000) });
    const codes = result.reasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['too_short', 'low_diversity']));
    for (const reason of result.reasons) {
      expect(typeof reason.message).toBe('string');
      expect(reason.measured).toBeTypeOf('number');
      expect(reason.threshold).toBeTypeOf('number');
    }
    const short = result.reasons.find((r) => r.code === 'too_short')!;
    expect(short).toMatchObject({ measured: 1, threshold: GUARD_DEFAULTS.minWords });
    expect(short.message).toBe('Add more text: at least 80 words are needed.');
  });

  it('uses the messages of the HTTP contract', () => {
    const long = guard({ kind: 'text', content: prose(10_001) }).reasons.find(
      (r) => r.code === 'too_long',
    )!;
    expect(long.message).toBe('Shorten the text to 10,000 words or split it into several sources.');
    const low = guard({ kind: 'text', content: '1234567890 '.repeat(1000) }).reasons.find(
      (r) => r.code === 'low_diversity',
    )!;
    expect(low.message).toBe('The text looks like repeated or non-text characters.');
    const markup = guard({
      kind: 'text',
      content: 'https://example.com/a '.repeat(150),
    }).reasons.find((r) => r.code === 'mostly_markup')!;
    expect(markup.message).toBe(
      'The text is mostly markup or links. Paste the readable content only.',
    );
    const repeated = guard({ kind: 'text', content: 'abc '.repeat(2000) }).reasons.find(
      (r) => r.code === 'repeated_content',
    )!;
    expect(repeated.message).toBe('The same content is repeated many times. Paste it once.');
  });

  it('refuses kind url with unsupported_kind', () => {
    const result = guard({ kind: 'url', content: 'https://example.com/some/page' });
    expect(result.ok).toBe(false);
    expect(result.reasons.map((r) => r.code)).toContain('unsupported_kind');
    expect(result.reasons.find((r) => r.code === 'unsupported_kind')!.message).toBe(
      'URL sources are not supported yet. Paste the text instead.',
    );
  });

  it('honours overridden thresholds', () => {
    const text = prose(300);
    expect(guard({ kind: 'text', content: text }).ok).toBe(true);
    const tooLong = guard({ kind: 'text', content: text }, { maxWords: 200 });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.reasons.map((r) => r.code)).toContain('too_long');
    expect(tooLong.reasons.find((r) => r.code === 'too_long')!.message).toBe(
      'Shorten the text to 200 words or split it into several sources.',
    );
    expect(
      guard({ kind: 'text', content: text }, { minWords: 500 }).reasons.map((r) => r.code),
    ).toContain('too_short');
  });

  it('never throws on odd input', () => {
    expect(() => guard({ kind: 'text', content: undefined as unknown as string })).not.toThrow();
    expect(() => guard({ kind: 'markdown', content: '\u0000\uD800' })).not.toThrow();
  });
});

describe('guard: positive cases', () => {
  for (const name of [
    'b-trees-and-indexes.md',
    'replication-and-sharding.md',
    'message-queues.txt',
  ]) {
    it(`accepts the seed source ${name}`, () => {
      const result = guard({
        kind: name.endsWith('.md') ? 'markdown' : 'text',
        content: seedText(name),
      });
      expect(result.reasons).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }

  it('accepts a 100-word plain paragraph', () => {
    const words = seedText('message-queues.txt').split(/\s+/).slice(0, 100).join(' ');
    expect(guard({ kind: 'text', content: words }).ok).toBe(true);
  });

  it('accepts a 600-word Markdown document with headings, a list, and one fenced code block', () => {
    const body = seedText('replication-and-sharding.md')
      .split(/\n\n/)
      .filter((p) => !p.startsWith('#'));
    const content = [
      '# Replication notes',
      '',
      body[0],
      '',
      '## A list',
      '',
      '- the leader accepts writes',
      '- followers apply the log',
      '',
      body[1],
      '',
      '```sql',
      'SELECT * FROM accounts WHERE id = 1;',
      '```',
      '',
      ...body.slice(2),
    ].join('\n');
    expect(countWords(toPlainText('markdown', content))).toBeGreaterThan(500);
    const result = guard({ kind: 'markdown', content });
    expect(result.reasons).toEqual([]);
  });
});

describe('browser safety', () => {
  it('curator.ts and review.ts import nothing Node-only', () => {
    for (const file of ['curator.ts', 'review.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]);
      for (const specifier of imports)
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^(zod|\.\/.*)$/);
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code).not.toMatch(/\brequire\(|\bprocess\.|\bBuffer\b|['"]node:/);
    }
  });
});

describe('countWords and measureText', () => {
  it('counts only tokens that contain a letter or a digit', () => {
    expect(countWords('one two  three\n four')).toBe(4);
    expect(countWords('--- !!! ... ok')).toBe(1);
    expect(countWords('')).toBe(0);
  });

  it('measures an empty text without dividing by zero', () => {
    const m = measureText('text', '');
    expect(m).toMatchObject({
      words: 0,
      distinctChars: 0,
      dominantCharShare: 0,
      markupRatio: 0,
      uniqueWordRatio: 1,
    });
  });

  it('measures the dominant character and the markup share', () => {
    const m = measureText('text', 'aaaa bbbb');
    expect(m.dominantCharShare).toBeCloseTo(0.5);
    const markup = measureText('text', '<b>hi</b>');
    expect(markup.markupRatio).toBeGreaterThan(0.7);
  });
});
