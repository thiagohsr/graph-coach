// Deterministic ids for goals and cover tasks (goal stretch). The same function as `deterministicId` in @coach/graph-kit
// (SHA-256 of the parts joined with ':', first 32 hex characters, formatted 8-4-4-4-12); repeated here because the Coach
// folder imports neither graph-kit nor the Curator folder.
import { createHash } from 'node:crypto';

export function deterministicId(...parts: string[]): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** `goal` id: the learner and the normalised goal text. */
export const goalId = (learnerId: string, normalisedText: string): string =>
  deterministicId('goal', `${learnerId}:${normalisedText}`);

/** `cover` task id: the learner and the sorted concept ids, so the same gap gives the same task. */
export const coverTaskId = (learnerId: string, conceptIds: string[]): string =>
  deterministicId('task', `cover:${learnerId}:${[...conceptIds].sort().join(',')}`);
