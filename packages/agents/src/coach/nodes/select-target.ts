import type { CoachNode } from '../deps';
import type { CoachFlag } from '../flags';
import type { CoachDeps } from '../deps';
import { selectTarget } from '../select';

/** Pure rule, no I/O: picks the target and sets the tier flags. */
export function createSelectTargetNode(deps: Pick<CoachDeps, 'settings'>): CoachNode {
  return async (state) => {
    if (!state.signals) return { selection: null };
    const selection = selectTarget(state.signals, deps.settings);
    if (!selection) return { selection: null };
    const flags: CoachFlag[] = [];
    if (selection.kind === 'unseen') flags.push('unseen');
    else if (selection.kind === 'decayed') flags.push('decayed');
    else if (selection.kind === 'all_mastered') flags.push('all_mastered');
    else if (selection.kind === 'weak' && selection.drivers.length > 0) flags.push('prerequisite_first');
    return { selection, flags };
  };
}
