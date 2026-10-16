// Pure checks on parsed seed data (data-model.md §5.4). An empty result means the seed is valid.
import type { SeedData, SeedIssue } from './schema';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KNOWN_TOP_LEVEL = ['concepts', 'puzzles', 'users', 'scenario', 'sources'];
const KNOWN_USER_KEYS = ['key', 'email', 'displayName', 'role'];
const EXPECTED_USER_KEYS = ['learner', 'learner2', 'reviewer', 'admin'];
const EPSILON = 1e-9;

export function validateSeed(data: SeedData): SeedIssue[] {
  const issues: SeedIssue[] = [];
  const add = (file: string, path: string, message: string) => issues.push({ file, path, message });

  // Anything beyond the five known sections would be a share, a password, an identity, ...
  for (const key of Object.keys(data)) {
    if (!KNOWN_TOP_LEVEL.includes(key))
      add('seed', key, `unexpected section "${key}" (no shares or credentials in seed files)`);
  }

  // ─── Concepts ────────────────────────────────────────────────────────────
  const conceptFile = 'concepts.json';
  const slugs = new Set<string>();
  if (data.concepts.length !== 25)
    add(conceptFile, '', `expected exactly 25 concepts, found ${data.concepts.length}`);
  data.concepts.forEach((concept, i) => {
    if (!SLUG.test(concept.slug))
      add(conceptFile, `${i}.slug`, `slug "${concept.slug}" must be lower-case and hyphenated`);
    if (slugs.has(concept.slug)) add(conceptFile, `${i}.slug`, `duplicate slug "${concept.slug}"`);
    slugs.add(concept.slug);
  });
  const prereqs = new Map<string, string[]>();
  data.concepts.forEach((concept, i) => {
    prereqs.set(concept.slug, concept.prerequisites);
    concept.prerequisites.forEach((p, j) => {
      if (!slugs.has(p))
        add(conceptFile, `${i}.prerequisites.${j}`, `prerequisite "${p}" is not a concept`);
    });
  });
  const roots = data.concepts.filter((c) => c.prerequisites.length === 0);
  if (roots.length !== 1)
    add(
      conceptFile,
      '',
      `expected exactly one concept without prerequisites, found ${roots.length}`,
    );
  const cycle = findCycle(prereqs);
  if (cycle) add(conceptFile, '', `prerequisites are not acyclic: ${cycle.join(' -> ')}`);

  // ─── Puzzles ─────────────────────────────────────────────────────────────
  if (data.puzzles.length < 5)
    add('puzzles', '', `expected at least 5 puzzles, found ${data.puzzles.length}`);
  const puzzleKeys = new Set<string>();
  const wordBanks = new Map<string, Set<string>>();
  const blankCounts = new Map<string, Map<number, number>>();
  const testedBy = new Map<string, Set<string>>();
  for (const puzzle of data.puzzles) {
    const file = `puzzles/${puzzle.key}`;
    if (puzzleKeys.has(puzzle.key)) add(file, 'key', `duplicate puzzle key "${puzzle.key}"`);
    puzzleKeys.add(puzzle.key);
    if (puzzle.questions.length < 6)
      add(file, 'questions', `needs at least 6 questions, has ${puzzle.questions.length}`);
    const sorted = [...puzzle.questions].map((q) => q.order).sort((a, b) => a - b);
    if (sorted.some((order, i) => order !== i + 1))
      add(file, 'questions', 'order values must be 1..n without gaps');

    const bank = new Set<string>(puzzle.distractors);
    const blanks = new Map<number, number>();
    const tested = new Set<string>();
    puzzle.questions.forEach((q, i) => {
      const path = `questions.${i}`;
      const blanksInSentence = q.sentence.split('___').length - 1;
      if (blanksInSentence !== q.answers.length) {
        add(
          file,
          `${path}.sentence`,
          `has ${blanksInSentence} blank(s) but ${q.answers.length} answer(s)`,
        );
      }
      if (q.answers.length < 1) add(file, `${path}.answers`, 'needs at least one answer');
      if (q.distractors.length < 2)
        add(file, `${path}.distractors`, 'needs at least 2 distractors');
      const answerSet = new Set(q.answers.map((a) => a.toLowerCase()));
      for (const d of q.distractors) {
        if (answerSet.has(d.toLowerCase()))
          add(file, `${path}.distractors`, `distractor "${d}" equals an answer`);
      }
      if (q.tests.length < 1) add(file, `${path}.tests`, 'tests at least one concept');
      for (const slug of q.tests) {
        if (!slugs.has(slug)) add(file, `${path}.tests`, `tested concept "${slug}" does not exist`);
        tested.add(slug);
      }
      q.answers.forEach((a) => bank.add(a));
      q.distractors.forEach((d) => bank.add(d));
      blanks.set(q.order, q.answers.length);
    });
    wordBanks.set(puzzle.key, bank);
    blankCounts.set(puzzle.key, blanks);
    testedBy.set(puzzle.key, tested);
  }

  // ─── Users ───────────────────────────────────────────────────────────────
  const userFile = 'users.json';
  const userKeys = data.users.map((u) => u.key);
  if (data.users.length !== 4 || EXPECTED_USER_KEYS.some((k) => !userKeys.includes(k))) {
    add(userFile, '', `expected the four users ${EXPECTED_USER_KEYS.join(', ')}`);
  }
  if (new Set(userKeys).size !== userKeys.length) add(userFile, '', 'duplicate user key');
  if (new Set(data.users.map((u) => u.email.toLowerCase())).size !== data.users.length) {
    add(userFile, '', 'duplicate e-mail address');
  }
  for (const role of ['learner', 'reviewer', 'admin']) {
    if (!data.users.some((u) => u.role === role)) add(userFile, '', `no user with role ${role}`);
  }
  data.users.forEach((user, i) => {
    if (!user.email.toLowerCase().endsWith('@example.test'))
      add(userFile, `${i}.email`, 'address must be in the example.test domain');
    for (const key of Object.keys(user)) {
      if (!KNOWN_USER_KEYS.includes(key))
        add(
          userFile,
          `${i}.${key}`,
          `unexpected property "${key}" (no password or identity in seed files)`,
        );
    }
  });

  // ─── Scenario ────────────────────────────────────────────────────────────
  const scenarioFile = 'scenario.json';
  const scenario = data.scenario;
  if (!userKeys.includes(scenario.learner))
    add(scenarioFile, 'learner', `"${scenario.learner}" is not a seed user`);
  const sessionKeys = new Set<string>();
  const byConcept = new Map<
    string,
    Array<{ daysAgo: number; before: number; after: number; session: string }>
  >();
  scenario.sessions.forEach((session, si) => {
    const base = `sessions.${si}`;
    if (sessionKeys.has(session.key))
      add(scenarioFile, `${base}.key`, `duplicate session key "${session.key}"`);
    sessionKeys.add(session.key);
    const blanks = blankCounts.get(session.puzzle);
    const bank = wordBanks.get(session.puzzle);
    if (!blanks || !bank) {
      add(scenarioFile, `${base}.puzzle`, `puzzle "${session.puzzle}" does not exist`);
      return;
    }
    const answered = new Set<string>();
    session.answers.forEach((answer, ai) => {
      const path = `${base}.answers.${ai}`;
      const count = blanks.get(answer.order);
      if (count === undefined) {
        add(
          scenarioFile,
          `${path}.order`,
          `puzzle "${session.puzzle}" has no question ${answer.order}`,
        );
        return;
      }
      if (answer.blank >= count)
        add(scenarioFile, `${path}.blank`, `question ${answer.order} has ${count} blank(s)`);
      const id = `${answer.order}:${answer.blank}`;
      if (answered.has(id)) add(scenarioFile, path, `blank ${id} answered twice`);
      answered.add(id);
      if (answer.word !== null && !bank.has(answer.word))
        add(
          scenarioFile,
          `${path}.word`,
          `"${answer.word}" is not in the word bank of "${session.puzzle}"`,
        );
      const puzzle = data.puzzles.find((p) => p.key === session.puzzle);
      const expected = puzzle?.questions.find((q) => q.order === answer.order)?.answers[
        answer.blank
      ];
      if (expected !== undefined && answer.correct !== (answer.word === expected)) {
        add(
          scenarioFile,
          `${path}.correct`,
          `"correct" disagrees with the word and the answer "${expected}"`,
        );
      }
    });
    for (const [order, count] of blanks) {
      for (let blank = 0; blank < count; blank += 1) {
        if (!answered.has(`${order}:${blank}`))
          add(scenarioFile, `${base}.answers`, `blank ${order}:${blank} is not answered`);
      }
    }
    const tested = testedBy.get(session.puzzle) ?? new Set<string>();
    const changed = new Set(session.masteryChanges.map((c) => c.concept));
    if (changed.size !== session.masteryChanges.length)
      add(scenarioFile, `${base}.masteryChanges`, 'a concept is listed twice');
    for (const slug of tested) {
      if (!changed.has(slug))
        add(
          scenarioFile,
          `${base}.masteryChanges`,
          `missing concept "${slug}" tested by the puzzle`,
        );
    }
    for (const slug of changed) {
      if (!tested.has(slug))
        add(
          scenarioFile,
          `${base}.masteryChanges`,
          `concept "${slug}" is not tested by the puzzle`,
        );
    }
    for (const change of session.masteryChanges) {
      const list = byConcept.get(change.concept) ?? [];
      list.push({
        daysAgo: session.submittedDaysAgo,
        before: change.before,
        after: change.after,
        session: session.key,
      });
      byConcept.set(change.concept, list);
    }
  });
  const masteryByConcept = new Map(scenario.mastery.map((m) => [m.concept, m]));
  if (masteryByConcept.size !== scenario.mastery.length)
    add(scenarioFile, 'mastery', 'a concept has two mastery entries');
  for (const [concept, changes] of byConcept) {
    const chain = [...changes].sort((a, b) => b.daysAgo - a.daysAgo);
    if (Math.abs(chain[0]!.before - 0.5) > EPSILON)
      add(
        scenarioFile,
        `mastery.${concept}`,
        `first "before" must be 0.5, found ${chain[0]!.before}`,
      );
    for (let i = 1; i < chain.length; i += 1) {
      if (Math.abs(chain[i]!.before - chain[i - 1]!.after) > EPSILON) {
        add(
          scenarioFile,
          `mastery.${concept}`,
          `session ${chain[i]!.session} starts at ${chain[i]!.before} but the previous session ended at ${chain[i - 1]!.after}`,
        );
      }
    }
    const mastery = masteryByConcept.get(concept);
    if (!mastery)
      add(
        scenarioFile,
        `mastery.${concept}`,
        'no mastery entry for a concept the sessions changed',
      );
    else if (Math.abs(mastery.score - chain[chain.length - 1]!.after) > EPSILON) {
      add(
        scenarioFile,
        `mastery.${concept}`,
        `score ${mastery.score} differs from the last "after" ${chain[chain.length - 1]!.after}`,
      );
    }
  }
  for (const concept of masteryByConcept.keys()) {
    if (!slugs.has(concept)) add(scenarioFile, `mastery.${concept}`, 'concept does not exist');
    else if (!byConcept.has(concept))
      add(scenarioFile, `mastery.${concept}`, 'no session changed this concept');
  }

  // ─── Sources ─────────────────────────────────────────────────────────────
  data.sources.forEach((source, i) => {
    const file = 'sources/index.json';
    if (source.actualWords === undefined) {
      add(file, `${i}.file`, `file "${source.file}" does not exist`);
    } else if (Math.abs(source.actualWords - source.words) > source.words * 0.1) {
      add(
        file,
        `${i}.words`,
        `"${source.file}" has ${source.actualWords} words, stated ${source.words} (more than 10% apart)`,
      );
    }
  });

  return issues;
}

/** One cycle as a list of slugs, or null. */
function findCycle(prereqs: Map<string, string[]>): string[] | null {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];
  const visit = (slug: string): string[] | null => {
    if (state.get(slug) === 'done') return null;
    if (state.get(slug) === 'visiting') return [...stack.slice(stack.indexOf(slug)), slug];
    state.set(slug, 'visiting');
    stack.push(slug);
    for (const p of prereqs.get(slug) ?? []) {
      if (!prereqs.has(p)) continue;
      const found = visit(p);
      if (found) return found;
    }
    stack.pop();
    state.set(slug, 'done');
    return null;
  };
  for (const slug of prereqs.keys()) {
    const found = visit(slug);
    if (found) return found;
  }
  return null;
}
