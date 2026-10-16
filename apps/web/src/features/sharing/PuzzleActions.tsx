import type { Role } from '@coach/types';
import type { PuzzleSummary } from '~/lib/api/gameplay-schemas';
import { canChangeVisibility, canShare } from './share-state';
import { ShareDialog } from './ShareDialog';
import { VisibilityButton } from './VisibilityButton';

/** The owner controls of a puzzle card. Renders nothing for a puzzle the viewer does not own, whatever their role. */
export function PuzzleActions({
  puzzle,
  role,
  ownEmail,
}: {
  puzzle: PuzzleSummary;
  role: Role;
  ownEmail: string;
}) {
  const share = canShare(puzzle);
  const visibility = canChangeVisibility(puzzle, role);
  if (!share && !visibility) return null;
  return (
    <>
      {share && <ShareDialog puzzle={puzzle} ownEmail={ownEmail} />}
      {visibility && <VisibilityButton puzzle={puzzle} />}
    </>
  );
}
