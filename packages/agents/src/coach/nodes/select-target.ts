import type { CoachNode } from '../deps';
import type { CoachFlag } from '@coach/types';
import type { CoachDeps } from '../deps';
import { goalSelection } from '../goal';
import { selectTarget } from '../select';

/** Pure rule, no I/O: picks the target and sets the tier flags. With a goal and no candidate in its scope: the goal's concept. */
export function createSelectTargetNode(deps: Pick<CoachDeps, 'settings'>): CoachNode {
  return async (state) => {
    const selection =
      (state.signals ? selectTarget(state.signals, deps.settings) : null) ??
      goalSelection(state.goal);
    if (!selection) return { selection: null };
    const flags: CoachFlag[] = [];
    if (selection.kind === 'unseen') flags.push('unseen');
    else if (selection.kind === 'decayed') flags.push('decayed');
    else if (selection.kind === 'all_mastered') flags.push('all_mastered');
    else if (selection.kind === 'weak' && selection.drivers.length > 0)
      flags.push('prerequisite_first');
    return { selection, flags };
  };
}
