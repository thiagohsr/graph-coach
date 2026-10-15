// Flag notices (contracts/ui-screens.md "/coach"). A flag that is not listed is ignored.
export const FLAG_NOTICES: Record<string, string> = {
  cold_start: 'No history yet: this is a starting point.',
  unseen: 'You have not practised this concept yet.',
  decayed: 'You have not practised this concept for a while.',
  all_mastered: 'Nothing is weak: this is the concept you practised longest ago.',
  prerequisite_first: 'A prerequisite comes first.',
  coverage_gap: 'Content for this concept is limited.',
  no_puzzle: 'No playable puzzle covers this yet.',
  repeat: 'You played this puzzle recently.',
  goal_unmatched: 'Your goal did not match any known concept; this is the normal recommendation.',
  coverage_requested: 'New content was requested for this goal.',
};

/** The notice texts for the flags the client knows, in the order given. */
export function flagNotices(flags: readonly string[]): string[] {
  return flags.flatMap((flag) => {
    const notice = FLAG_NOTICES[flag];
    return notice ? [notice] : [];
  });
}
