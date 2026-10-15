// The template summary: fixed English text from the selection, the puzzle, and the flags. Pure and deterministic.
import type { CoachFlag } from './flags';
import { round2 } from './risk';
import type { EvidenceItem, PuzzleChoice, SelectedConcept, Selection } from './state';

const MAX_SUMMARY = 600;
const q = (text: string): string => `"${text}"`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const practised = (c: SelectedConcept): string =>
  `mastery ${round2(c.score ?? 0).toFixed(2)}, last practised ${plural(c.daysSince ?? 0, 'day', 'days')} ago`;

export interface SummaryInput {
  selection: Selection;
  puzzle: PuzzleChoice | null;
  flags: CoachFlag[];
  evidence?: EvidenceItem[];
}

export function renderSummary(input: SummaryInput): string {
  const { selection, puzzle, flags } = input;
  const target = selection.target;
  const has = (flag: CoachFlag): boolean => flags.includes(flag);
  const parts: string[] = [];

  switch (selection.kind) {
    case 'cold_start':
      parts.push(`You have no study history yet, so start with ${q(target.name)}, an introductory concept.`);
      break;
    case 'unseen':
      parts.push(`You have not practised ${q(target.name)} yet, so try it next.`);
      break;
    case 'decayed':
      parts.push(`It has been a while since you practised ${q(target.name)} (${practised(target)}), so review it next.`);
      break;
    case 'all_mastered':
      parts.push(
        `Everything you have practised looks solid, so revisit ${q(target.name)}, the concept you practised longest ago (${plural(target.daysSince ?? 0, 'day', 'days')}).`,
      );
      break;
    default: {
      const driver = selection.drivers[0];
      if (driver) {
        parts.push(
          `Practise ${q(target.name)} first. ${q(driver.name)} depends on it and is also weak, and ${q(target.name)} is the weaker of the two (${practised(target)}).`,
        );
      } else {
        parts.push(`Practise ${q(target.name)} next (${practised(target)}).`);
      }
    }
  }

  if (puzzle) {
    parts.push(`Recommended puzzle: ${q(puzzle.name)}.`);
  } else if (has('no_puzzle')) {
    parts.push('No playable puzzle covers it yet.');
  }
  if (has('coverage_gap') && puzzle) {
    parts.push(`No puzzle tests ${q(target.name)} directly yet, so this is the closest match.`);
  }
  if (has('repeat')) parts.push('You played this puzzle recently, but it is still the best fit.');

  return parts.join(' ').slice(0, MAX_SUMMARY);
}
