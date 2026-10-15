// Pure conversion of seed data to a graph fixture (data-model.md §1.1, §5). Same input and `now`, same output.
import type { FixtureEdge, FixtureNode, GraphFixture } from '../fixture';
import { deterministicId } from '../ids';
import type { ScenarioKey, SeedData, SeedUserKey } from './schema';

const DAY_MS = 86_400_000;
const SCENARIO_MINUTES_BEFORE_SUBMIT = 5;
const POINTS_PER_BLANK = 10;

/** Stable ids of seeded records, for tests and for the Coach acceptance test. */
export const seedIds = {
  user: (key: SeedUserKey): string => deterministicId('user', key),
  /** The fixed address of a demo user (data-model.md §5.1). Postgres rows and dev sign-in only, never the graph. */
  email: (key: SeedUserKey): string => `${key}@example.test`,
  concept: (slug: string): string => deterministicId('concept', slug),
  puzzle: (key: string): string => deterministicId('puzzle', key),
  question: (puzzleKey: string, order: number): string => deterministicId('question', `${puzzleKey}:${order}`),
  session: (scenarioKey: ScenarioKey): string => deterministicId('session', `scenario:${scenarioKey}`),
};

export interface SeedFixtureOptions {
  now: Date;
  /** Default true. */
  scenario?: boolean;
}

/** Content is 'update'; learners and the scenario (sessions, answers, mastery) are 'keep'. */
export function seedToFixture(data: SeedData, options: SeedFixtureOptions): GraphFixture {
  const now = options.now.getTime();
  const withScenario = options.scenario ?? true;
  const nodes: FixtureNode[] = [];
  const edges: FixtureEdge[] = [];
  const ago = (days: number): number => Math.round(now - days * DAY_MS);

  const adminKey = data.users.find((u) => u.role === 'admin')?.key ?? 'admin';
  const learnerRef = (key: string) => ({ label: 'Learner' as const, key: deterministicId('user', key) });
  const conceptRef = (slug: string) => ({ label: 'Concept' as const, key: seedIds.concept(slug) });

  // Users: only the graph part of an account.
  for (const user of data.users) {
    nodes.push({
      label: 'Learner',
      key: deterministicId('user', user.key),
      props: { displayName: user.displayName, createdAt: now },
      onMatch: 'keep',
    });
  }
  for (const name of ['Curator', 'Coach']) nodes.push({ label: 'Agent', key: name, onMatch: 'keep' });

  // Concepts and prerequisites.
  for (const concept of data.concepts) {
    nodes.push({
      label: 'Concept',
      key: seedIds.concept(concept.slug),
      props: { slug: concept.slug, name: concept.name, description: concept.description, createdAt: now },
    });
  }
  for (const concept of data.concepts) {
    for (const prerequisite of concept.prerequisites) {
      edges.push({
        type: 'PREREQUISITE_OF',
        from: conceptRef(prerequisite),
        to: conceptRef(concept.slug),
        props: { confidence: 1.0 },
      });
    }
  }

  // Puzzles, questions, ownership, review.
  for (const puzzle of data.puzzles) {
    const puzzleRef = { label: 'Puzzle' as const, key: seedIds.puzzle(puzzle.key) };
    nodes.push({
      ...puzzleRef,
      props: {
        name: puzzle.name,
        origin: 'seed',
        status: 'published',
        visibility: 'public',
        distractors: puzzle.distractors,
        createdAt: now,
      },
    });
    edges.push({ type: 'OWNS', from: learnerRef(adminKey), to: puzzleRef });
    for (const question of puzzle.questions) {
      const questionRef = { label: 'Question' as const, key: seedIds.question(puzzle.key, question.order) };
      nodes.push({
        ...questionRef,
        props: {
          sentence: question.sentence,
          answers: question.answers,
          distractors: question.distractors,
          status: 'approved',
          createdAt: now,
          reviewedAt: now,
        },
      });
      edges.push({ type: 'CONTAINS', from: puzzleRef, to: questionRef, props: { order: question.order } });
      for (const slug of question.tests) {
        edges.push({ type: 'TESTS', from: questionRef, to: conceptRef(slug) });
      }
      edges.push({
        type: 'REVIEWED',
        from: learnerRef(adminKey),
        to: questionRef,
        props: { decision: 'approved', reason: 'seed content', at: now },
      });
    }
  }

  if (withScenario) {
    const learner = learnerRef(data.scenario.learner);
    for (const session of data.scenario.sessions) {
      const sessionRef = { label: 'Session' as const, key: seedIds.session(session.key as ScenarioKey) };
      const puzzle = data.puzzles.find((p) => p.key === session.puzzle);
      const blanks = puzzle ? puzzle.questions.reduce((sum, q) => sum + q.answers.length, 0) : session.answers.length;
      const correct = session.answers.filter((a) => a.correct).length;
      const submittedAt = ago(session.submittedDaysAgo);
      nodes.push({
        ...sessionRef,
        props: {
          startedAt: submittedAt - SCENARIO_MINUTES_BEFORE_SUBMIT * 60_000,
          submittedAt,
          score: correct * POINTS_PER_BLANK,
          maxScore: blanks * POINTS_PER_BLANK,
        },
        onMatch: 'keep',
      });
      edges.push({ type: 'PLAYED', from: learner, to: sessionRef, onMatch: 'keep' });
      edges.push({
        type: 'OF',
        from: sessionRef,
        to: { label: 'Puzzle', key: seedIds.puzzle(session.puzzle) },
        onMatch: 'keep',
      });
      for (const answer of session.answers) {
        edges.push({
          type: 'ANSWERED',
          from: sessionRef,
          to: { label: 'Question', key: seedIds.question(session.puzzle, answer.order) },
          props: { blank: answer.blank, word: answer.word ?? '', correct: answer.correct },
          keyProps: ['blank'],
          onMatch: 'keep',
        });
      }
      for (const change of session.masteryChanges) {
        edges.push({
          type: 'CHANGED_MASTERY',
          from: sessionRef,
          to: conceptRef(change.concept),
          props: { before: change.before, after: change.after },
          onMatch: 'keep',
        });
      }
    }
    for (const mastery of data.scenario.mastery) {
      edges.push({
        type: 'HAS_MASTERY',
        from: learner,
        to: conceptRef(mastery.concept),
        props: { score: mastery.score, attempts: mastery.attempts, lastSeen: ago(mastery.lastSeenDaysAgo) },
        onMatch: 'keep',
      });
    }
  }

  return { nodes, edges };
}
