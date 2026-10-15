// Flag values of contracts/coach-api.md. The same list is `CoachFlag` in @coach/types (this package does not import it).
export const COACH_FLAGS = [
  'cold_start',
  'unseen',
  'decayed',
  'all_mastered',
  'prerequisite_first',
  'coverage_gap',
  'no_puzzle',
  'repeat',
  'goal_unmatched',
  'coverage_requested',
  'coverage_not_requested',
] as const;

export type CoachFlag = (typeof COACH_FLAGS)[number];
