// The template summary: fixed English text from the selection, the puzzle, and the flags. Pure and deterministic.
import type { CoachFlag } from '@coach/types';
import { round2 } from './risk';
import type { EvidenceItem, PuzzleChoice, SelectedConcept, Selection } from './state';

const MAX_SUMMARY = 600;
const q = (text: string): string => `"${text}"`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const practised = (c: SelectedConcept): string =>
  `mastery ${round2(c.score ?? 0).toFixed(2)}, last practised ${plural(c.daysSince ?? 0, 'day', 'days')} ago`;

export type AllowanceReason = 'no_allowance' | 'paused' | 'hourly_limit';

export interface SummaryInput {
  selection: Selection;
  puzzle: PuzzleChoice | null;
  flags: CoachFlag[];
  evidence?: EvidenceItem[];
  /** Goal stretch: the goal concepts no playable puzzle covers, and what became of the request for them. */
  missingNames?: string[];
  coverage?: { requested: true } | { requested: false; reason: AllowanceReason };
}

const NOT_REQUESTED: Record<AllowanceReason, string> = {
  no_allowance: 'you have no puzzle-creation allowance left to request more',
  paused: 'puzzle creation is paused right now, so I could not request more',
  hourly_limit:
    'you have reached the hourly limit for creating puzzles, so I could not request more',
};

export function renderSummary(input: SummaryInput): string {
  const { selection, puzzle, flags } = input;
  const target = selection.target;
  const has = (flag: CoachFlag): boolean => flags.includes(flag);
  const parts: string[] = [];

  switch (selection.kind) {
    case 'cold_start':
      parts.push(
        `You have no study history yet, so start with ${q(target.name)}, an introductory concept.`,
      );
      break;
    case 'unseen':
      parts.push(`You have not practised ${q(target.name)} yet, so try it next.`);
      break;
    case 'goal':
      parts.push(`Your goal points to ${q(target.name)}, so work on it next.`);
      break;
    case 'decayed':
      parts.push(
        `It has been a while since you practised ${q(target.name)} (${practised(target)}), so review it next.`,
      );
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
  if (has('goal_unmatched'))
    parts.push('No concept matches your goal, so this is the usual recommendation.');
  const { coverage, missingNames } = input;
  if (coverage && missingNames && missingNames.length > 0) {
    const list = missingNames.map(q).join(', ');
    parts.push(
      coverage.requested
        ? `No puzzle covers ${list} yet, so I requested new puzzles for it.`
        : `No puzzle covers ${list} yet, and ${NOT_REQUESTED[coverage.reason]}.`,
    );
  }

  return parts.join(' ').slice(0, MAX_SUMMARY);
}
