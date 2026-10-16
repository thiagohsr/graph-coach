import { beforeAll, describe, expect, it } from 'vitest';
import { readSeedDir } from './read';
import type { SeedData } from './schema';
import { validateSeed } from './validate';

let seed: SeedData;
beforeAll(async () => {
  seed = await readSeedDir();
});

/** Validates a mutated deep copy and returns the messages. */
function messagesAfter(mutate: (copy: SeedData) => void): string[] {
  const copy = structuredClone(seed);
  mutate(copy);
  return validateSeed(copy).map((i) => `${i.file} ${i.path} ${i.message}`);
}

const puzzle = (data: SeedData, key: string) => data.puzzles.find((p) => p.key === key)!;
const session = (data: SeedData, key: string) => data.scenario.sessions.find((s) => s.key === key)!;

describe('validateSeed', () => {
  it('finds no issue in the real seed directory', () => {
    expect(validateSeed(seed)).toEqual([]);
  });

  it('requires exactly 25 concepts', () => {
    expect(messagesAfter((d) => d.concepts.pop())).toContainEqual(
      expect.stringContaining('exactly 25 concepts'),
    );
  });

  it('requires unique, lower-case, hyphenated slugs', () => {
    expect(
      messagesAfter((d) => {
        d.concepts[1]!.slug = d.concepts[0]!.slug;
      }),
    ).toContainEqual(expect.stringContaining('duplicate slug'));
    expect(
      messagesAfter((d) => {
        d.concepts[1]!.slug = 'Not_Valid';
      }),
    ).toContainEqual(expect.stringContaining('lower-case and hyphenated'));
  });

  it('requires every prerequisite to exist', () => {
    expect(messagesAfter((d) => d.concepts[2]!.prerequisites.push('ghost'))).toContainEqual(
      expect.stringContaining('"ghost" is not a concept'),
    );
  });

  it('requires an acyclic prerequisite graph', () => {
    expect(messagesAfter((d) => d.concepts[0]!.prerequisites.push('foreign-key'))).toContainEqual(
      expect.stringContaining('not acyclic'),
    );
  });

  it('requires exactly one concept without prerequisites', () => {
    expect(
      messagesAfter((d) => {
        d.concepts[1]!.prerequisites = [];
      }),
    ).toContainEqual(expect.stringContaining('exactly one concept without prerequisites'));
  });

  it('requires at least 5 puzzles with at least 6 questions each', () => {
    expect(
      messagesAfter((d) => {
        d.puzzles = d.puzzles.slice(0, 4);
      }),
    ).toContainEqual(expect.stringContaining('at least 5 puzzles'));
    expect(messagesAfter((d) => puzzle(d, 'storage-and-b-trees').questions.pop())).toContainEqual(
      expect.stringContaining('at least 6 questions'),
    );
  });

  it('requires order values 1..n without gaps', () => {
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[5]!.order = 9;
      }),
    ).toContainEqual(expect.stringContaining('1..n without gaps'));
  });

  it('requires one ___ per answer', () => {
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[0]!.answers.pop();
      }),
    ).toContainEqual(expect.stringContaining('blank(s) but'));
  });

  it('requires at least 2 distractors, none equal to an answer (any case)', () => {
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[0]!.distractors = ['rows'];
      }),
    ).toContainEqual(expect.stringContaining('at least 2 distractors'));
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[2]!.distractors = ['SORTED', 'random'];
      }),
    ).toContainEqual(expect.stringContaining('equals an answer'));
  });

  it('requires tested concepts that exist', () => {
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[2]!.tests = [];
      }),
    ).toContainEqual(expect.stringContaining('tests at least one concept'));
    expect(
      messagesAfter((d) => {
        puzzle(d, 'storage-and-b-trees').questions[2]!.tests = ['ghost'];
      }),
    ).toContainEqual(expect.stringContaining('"ghost" does not exist'));
  });

  it('checks scenario references and the word bank', () => {
    expect(
      messagesAfter((d) => {
        session(d, 'A').puzzle = 'ghost';
      }),
    ).toContainEqual(expect.stringContaining('puzzle "ghost" does not exist'));
    expect(
      messagesAfter((d) => {
        session(d, 'A').answers[0]!.order = 99;
      }),
    ).toContainEqual(expect.stringContaining('has no question 99'));
    expect(
      messagesAfter((d) => {
        session(d, 'A').answers[0]!.blank = 5;
      }),
    ).toContainEqual(expect.stringContaining('blank(s)'));
    expect(
      messagesAfter((d) => {
        session(d, 'A').answers[0]!.word = 'zebra';
      }),
    ).toContainEqual(expect.stringContaining('not in the word bank'));
  });

  it('accepts a null word for an unanswered blank, not a missing or repeated blank', () => {
    expect(
      messagesAfter((d) => {
        const a = session(d, 'A').answers[3]!;
        a.word = null;
      }),
    ).toEqual([]);
    expect(messagesAfter((d) => session(d, 'A').answers.pop())).toContainEqual(
      expect.stringContaining('is not answered'),
    );
    expect(
      messagesAfter((d) => session(d, 'A').answers.push({ ...session(d, 'A').answers[0]! })),
    ).toContainEqual(expect.stringContaining('answered twice'));
  });

  it('requires masteryChanges to name exactly the concepts of the puzzle', () => {
    expect(messagesAfter((d) => session(d, 'A').masteryChanges.pop())).toContainEqual(
      expect.stringContaining('missing concept'),
    );
    expect(
      messagesAfter((d) =>
        session(d, 'A').masteryChanges.push({ concept: 'mvcc', before: 0.5, after: 0.5 }),
      ),
    ).toContainEqual(expect.stringContaining('is not tested by the puzzle'));
  });

  it('requires the mastery chain: first before 0.5, each before equal to the previous after, last after equal to the score', () => {
    expect(
      messagesAfter((d) => {
        session(d, 'D').masteryChanges[0]!.before = 0.4;
      }),
    ).toContainEqual(expect.stringContaining('must be 0.5'));
    expect(
      messagesAfter((d) => {
        session(d, 'C').masteryChanges[0]!.before = 0.1;
      }),
    ).toContainEqual(expect.stringContaining('previous session ended'));
    expect(
      messagesAfter((d) => {
        d.scenario.mastery.find((m) => m.concept === 'indexes')!.score = 0.9;
      }),
    ).toContainEqual(expect.stringContaining('differs from the last "after"'));
  });

  it('requires the four users, all roles, unique keys and addresses in example.test', () => {
    expect(messagesAfter((d) => d.users.pop())).toContainEqual(
      expect.stringContaining('the four users'),
    );
    expect(
      messagesAfter((d) => {
        d.users[1]!.email = d.users[0]!.email;
      }),
    ).toContainEqual(expect.stringContaining('duplicate e-mail'));
    expect(
      messagesAfter((d) => {
        d.users[0]!.email = 'someone@example.com';
      }),
    ).toContainEqual(expect.stringContaining('example.test'));
    expect(
      messagesAfter((d) => {
        d.users.forEach((u) => {
          u.role = 'learner';
        });
      }),
    ).toContainEqual(expect.stringContaining('no user with role admin'));
  });

  it('refuses a password in a user and a share anywhere', () => {
    expect(
      messagesAfter((d) => {
        (d.users[0] as Record<string, unknown>).password = 'x';
      }),
    ).toContainEqual(expect.stringContaining('unexpected property "password"'));
    expect(
      messagesAfter((d) => {
        (d as Record<string, unknown>).shares = [];
      }),
    ).toContainEqual(expect.stringContaining('unexpected section "shares"'));
  });

  it('requires every source file to exist and its word count to be within 10%', () => {
    expect(
      messagesAfter((d) => {
        delete d.sources[0]!.actualWords;
      }),
    ).toContainEqual(expect.stringContaining('does not exist'));
    expect(
      messagesAfter((d) => {
        d.sources[0]!.words = 2000;
      }),
    ).toContainEqual(expect.stringContaining('more than 10% apart'));
  });
});
