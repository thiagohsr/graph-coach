// Evidence items: what becomes a BECAUSE edge, with reasons and weights (data-model.md section 2). Pure.
import {
  EVIDENCE_WEIGHTS,
  MAX_ALTERNATIVES,
  MAX_ANSWER_EVIDENCE,
  MAX_PASSAGE_EVIDENCE,
  MAX_SESSION_EVIDENCE,
  UNSEEN_STRENGTH,
} from './constants';
import type { CoachFlag } from '@coach/types';
import { round2, round3 } from './risk';
import type { AnswerEvidenceRow, GoalConceptRow } from './rows';
import type { CoachSettings } from './settings';
import type { EvidenceItem, EvidenceRole, SelectedConcept, Selection } from './state';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const fmt2 = (n: number): string => round2(n).toFixed(2);

function weight(role: EvidenceRole, strength: number): number {
  return round3(EVIDENCE_WEIGHTS[role] * Math.max(0, Math.min(1, strength)));
}

function practisedClause(c: SelectedConcept): string {
  const days = c.daysSince ?? 0;
  return `mastery ${fmt2(c.score ?? 0)}, last practised ${plural(days, 'day', 'days')} ago`;
}

function targetItem(selection: Selection): EvidenceItem {
  const t = selection.target;
  const base = { label: 'Concept' as const, nodeId: t.conceptId, role: 'target' as const };
  switch (selection.kind) {
    case 'cold_start':
      return { ...base, reason: 'target: introductory concept with no prerequisites', weight: weight('target', UNSEEN_STRENGTH) };
    case 'unseen':
      return { ...base, reason: 'target: never practised', weight: weight('target', UNSEEN_STRENGTH) };
    case 'goal':
      return { ...base, reason: 'target: concept of your goal', weight: weight('target', UNSEEN_STRENGTH) };
    case 'all_mastered':
      return {
        ...base,
        reason: `target: practised longest ago (${plural(t.daysSince ?? 0, 'day', 'days')})`,
        weight: weight('target', (t.risk ?? 0) / 2),
      };
    default:
      return {
        ...base,
        reason: `target: ${practisedClause(t)}, risk ${fmt2(t.risk ?? 0)}`,
        weight: weight('target', (t.risk ?? 0) / 2),
      };
  }
}

export interface BuildEvidenceInput {
  selection: Selection;
  answers: AnswerEvidenceRow[];
  /** Goal stretch: rows of the goal query. Only `via = 'passage'` rows with a chunk become `passage` evidence. */
  passages?: GoalConceptRow[];
  flags: CoachFlag[];
}

// `_settings` is in the contract signature; weights are constants.
export function buildEvidence(input: BuildEvidenceInput, _settings?: CoachSettings): EvidenceItem[] {
  const { selection, answers } = input;
  const items: EvidenceItem[] = [targetItem(selection)];

  for (const driver of selection.drivers.slice(0, MAX_ALTERNATIVES)) {
    items.push({
      label: 'Concept',
      nodeId: driver.conceptId,
      role: 'driver',
      reason: `weak concept that depends on the target: mastery ${fmt2(driver.score ?? 0)}, risk ${fmt2(driver.risk ?? 0)}`,
      weight: weight('driver', (driver.risk ?? 0) / 2),
    });
  }

  for (const alt of selection.alternatives.slice(0, MAX_ALTERNATIVES)) {
    items.push({
      label: 'Concept',
      nodeId: alt.conceptId,
      role: 'alternative',
      reason: `also considered: risk ${fmt2(alt.risk ?? 0)}`,
      weight: weight('alternative', (alt.risk ?? 0) / 2),
    });
  }

  // One question can test both the target and a driver: count each (question, session) once.
  const perQuestionSession = new Map<string, { questionId: string; sessionId: string; submittedAt: number; misses: number }>();
  for (const row of answers) {
    const key = `${row.questionId}\u0000${row.sessionId}`;
    const existing = perQuestionSession.get(key);
    if (!existing || row.misses > existing.misses) {
      perQuestionSession.set(key, {
        questionId: row.questionId,
        sessionId: row.sessionId,
        submittedAt: row.submittedAt,
        misses: row.misses,
      });
    }
  }

  const perQuestion = new Map<string, number>();
  const perSession = new Map<string, { wrong: number; submittedAt: number }>();
  for (const entry of perQuestionSession.values()) {
    perQuestion.set(entry.questionId, (perQuestion.get(entry.questionId) ?? 0) + entry.misses);
    const session = perSession.get(entry.sessionId) ?? { wrong: 0, submittedAt: entry.submittedAt };
    session.wrong += entry.misses;
    perSession.set(entry.sessionId, session);
  }

  const questions = [...perQuestion.entries()]
    .sort(([ia, ma], [ib, mb]) => mb - ma || cmp(ia, ib))
    .slice(0, MAX_ANSWER_EVIDENCE);
  for (const [questionId, misses] of questions) {
    items.push({
      label: 'Question',
      nodeId: questionId,
      role: 'answer',
      reason: `missed ${plural(misses, 'time', 'times')}`,
      weight: weight('answer', Math.min(misses, 3) / 3),
    });
  }

  const sessions = [...perSession.entries()]
    .sort(([ia, a], [ib, b]) => b.submittedAt - a.submittedAt || cmp(ia, ib))
    .slice(0, MAX_SESSION_EVIDENCE);
  for (const [sessionId, { wrong }] of sessions) {
    items.push({
      label: 'Session',
      nodeId: sessionId,
      role: 'session',
      reason: `${plural(wrong, 'wrong answer', 'wrong answers')} on these concepts`,
      weight: weight('session', Math.min(wrong, 3) / 3),
    });
  }

  // Passages (goal stretch): the best matching chunk per goal concept, one item per chunk, best first. The rows were
  // already limited to chunks the learner may read at decision time. A name match has no chunk and gives no item.
  const bestPerChunk = new Map<string, number>();
  for (const row of input.passages ?? []) {
    if (row.via !== 'passage' || row.bestChunkId === null) continue;
    bestPerChunk.set(row.bestChunkId, Math.max(bestPerChunk.get(row.bestChunkId) ?? 0, row.score));
  }
  const chunks = [...bestPerChunk.entries()].sort(([ia, a], [ib, b]) => b - a || cmp(ia, ib)).slice(0, MAX_PASSAGE_EVIDENCE);
  for (const [chunkId, similarity] of chunks) {
    items.push({
      label: 'Chunk',
      nodeId: chunkId,
      role: 'passage',
      reason: `matched the goal (similarity ${fmt2(similarity)})`,
      weight: weight('passage', similarity),
    });
  }

  return items;
}
